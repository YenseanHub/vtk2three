import { describe, expect, it, vi } from "vitest";
import { Data3DTexture, DataTexture, GLSL3, Mesh, ShaderMaterial } from "three";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData.js";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray.js";
import vtkVolume from "@kitware/vtk.js/Rendering/Core/Volume.js";
import vtkVolumeMapper from "@kitware/vtk.js/Rendering/Core/VolumeMapper.js";
import vtkRenderer from "@kitware/vtk.js/Rendering/Core/Renderer.js";
import { BlendMode } from "../Core/constants";
import { buildTransferFunction } from "../Core/VolumeRayMarcher";
import { convertVolume } from "../VolumeMapper";
import { convertRenderer } from "../SceneMapper";

function makeImage(): ReturnType<typeof vtkImageData.newInstance> {
  const image = vtkImageData.newInstance();
  image.setDimensions(4, 4, 4);
  const values = new Float32Array(64);
  for (let i = 0; i < 64; ++i) values[i] = i;
  image.getPointData().setScalars(
    vtkDataArray.newInstance({ name: "scalars", values, numberOfComponents: 1 })
  );
  image.computeTransforms();
  return image;
}

function makeVolume(blendMode?: number) {
  const mapper = vtkVolumeMapper.newInstance();
  mapper.setInputData(makeImage());
  if (blendMode !== undefined) mapper.setBlendMode(blendMode as never);
  const volume = vtkVolume.newInstance();
  volume.setMapper(mapper);
  const property = volume.getProperty();
  const ctf = property.getRGBTransferFunction(0);
  ctf.addRGBPoint(0, 0, 0, 0);
  ctf.addRGBPoint(63, 1, 1, 1);
  const pwf = property.getScalarOpacity(0);
  pwf.removeAllPoints();
  pwf.addPoint(0, 0);
  pwf.addPoint(63, 1);
  return volume;
}

describe("P5-C volume rendering", () => {
  it("builds a GLSL3 ray-marching mesh with 3D + transfer-function textures", () => {
    const result = convertVolume(makeVolume())!;
    expect(result).toBeDefined();
    expect(result.object.children).toHaveLength(1);
    const mesh = result.object.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    const material = mesh.material as ShaderMaterial;
    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material.glslVersion).toBe(GLSL3);
    expect(material.fragmentShader).toContain("sampler3D");
    // three only injects modelMatrix into the vertex prefix, so the
    // world -> local camera transform must live in the vertex shader.
    expect(material.vertexShader).toContain("inverse(modelMatrix)");
    expect(material.fragmentShader).toContain("vRayOrigin");
    expect(material.fragmentShader).not.toContain("inverse(modelMatrix)");
    expect(material.uniforms.uVolume.value).toBeInstanceOf(Data3DTexture);
    expect(material.uniforms.uTransfer.value).toBeInstanceOf(DataTexture);
    expect(material.uniforms.uTransfer.value.image.data).toHaveLength(256 * 4);
    expect(material.uniforms.uSteps.value).toBe(256);
    expect(material.uniforms.uBlendMode.value).toBe(BlendMode.COMPOSITE_BLEND);
    expect(result.report.stats.voxels).toBe(64);
    expect(result.report.stats.volumes).toBe(1);
    expect(result.report.stats.textures).toBe(2);
    result.dispose();
  });

  it("honours volumeSteps and MIP blend mode", () => {
    const result = convertVolume(makeVolume(BlendMode.MAXIMUM_INTENSITY_BLEND), {
      volumeSteps: 64,
    })!;
    const material = (result.object.children[0] as Mesh).material as ShaderMaterial;
    expect(material.uniforms.uSteps.value).toBe(64);
    expect(material.uniforms.uBlendMode.value).toBe(BlendMode.MAXIMUM_INTENSITY_BLEND);
    result.dispose();
  });

  it("falls back to COMPOSITE for unsupported blend modes", () => {
    const result = convertVolume(makeVolume(BlendMode.RADON_TRANSFORM_BLEND))!;
    const material = (result.object.children[0] as Mesh).material as ShaderMaterial;
    expect(material.uniforms.uBlendMode.value).toBe(BlendMode.COMPOSITE_BLEND);
    expect(result.report.warnings.some((w) => w.includes("unsupported"))).toBe(true);
    expect(result.report.unsupported.some((u) => u.includes("Radon"))).toBe(true);
    result.dispose();
  });

  it("bakes color and opacity transfer functions into one RGBA LUT", () => {
    const property = makeVolume().getProperty();
    const { texture } = buildTransferFunction(property as never, [0, 63]);
    const data = texture.image.data as Uint8Array;
    expect(data).toHaveLength(256 * 4);
    expect(data[3]).toBe(0);
    expect(data[255 * 4 + 3]).toBe(255);
    // Linearised color: full white at the high end.
    expect(data[255 * 4]).toBe(255);
  });

  it("updates in place when the transfer function changes", () => {
    const volume = makeVolume();
    const result = convertVolume(volume)!;
    const root = result.object;
    expect(result.update()).toBe(false);

    volume.getProperty().getRGBTransferFunction(0).addRGBPoint(30, 1, 0, 0);
    expect(result.update()).toBe(true);
    expect(result.object).toBe(root);
    expect(result.update()).toBe(false);
    result.dispose();
  });

  it("disposes uniform-owned textures", () => {
    const result = convertVolume(makeVolume())!;
    const material = (result.object.children[0] as Mesh).material as ShaderMaterial;
    const volumeTexture = material.uniforms.uVolume.value as Data3DTexture;
    const transferTexture = material.uniforms.uTransfer.value as DataTexture;
    const volumeSpy = vi.spyOn(volumeTexture, "dispose");
    const transferSpy = vi.spyOn(transferTexture, "dispose");
    result.dispose();
    expect(volumeSpy).toHaveBeenCalled();
    expect(transferSpy).toHaveBeenCalled();
    expect(() => result.dispose()).not.toThrow();
  });

  it("convertRenderer includes volumes instead of skipping them", () => {
    const renderer = vtkRenderer.newInstance();
    const volume = makeVolume();
    renderer.addVolume(volume);

    const scene = convertRenderer(renderer);
    expect(scene.object.children).toHaveLength(1);
    expect(scene.object.children[0].name).toBe("vtkVolumeRoot");
    expect(scene.report.stats.volumes).toBe(1);
    expect(scene.report.stats.voxels).toBe(64);
    expect(scene.report.warnings.some((w) => w.includes("were skipped"))).toBe(false);

    renderer.removeVolume(volume);
    expect(scene.sync()).toBe(true);
    expect(scene.object.children).toHaveLength(0);
    scene.dispose();
  });
});
