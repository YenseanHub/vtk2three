import { describe, expect, it } from "vitest";
import { Data3DTexture, MeshBasicMaterial } from "three";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData.js";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray.js";
import { readImageSlice, readImageVolume } from "../Core/ImageDataMapper";
import type { ImageDataLike } from "../Core/ImageDataMapper";
import { resolveOptions } from "../types";
import { convertActor } from "../v23Mapper";

function makeImage(dims: [number, number, number] = [4, 4, 4]): ImageDataLike {
  const image = vtkImageData.newInstance();
  image.setDimensions(...dims);
  const count = dims[0] * dims[1] * dims[2];
  const values = new Float32Array(count);
  for (let i = 0; i < count; ++i) values[i] = i;
  const scalars = vtkDataArray.newInstance({
    name: "scalars",
    values,
    numberOfComponents: 1,
  });
  image.getPointData().setScalars(scalars);
  image.computeTransforms();
  return image as unknown as ImageDataLike;
}

describe("P5-A vtkImageData -> three textures", () => {
  it("uploads scalars into a RedFormat Data3DTexture", () => {
    const volume = readImageVolume(makeImage(), resolveOptions())!;
    expect(volume).toBeDefined();
    expect(volume.texture).toBeInstanceOf(Data3DTexture);
    expect(volume.dimensions).toEqual([4, 4, 4]);
    expect(volume.sourceDimensions).toEqual([4, 4, 4]);
    expect(volume.voxelCount).toBe(64);
    const voxels = volume.texture.image.data as Uint8Array;
    expect(voxels).toHaveLength(64);
    expect(voxels[0]).toBe(0);
    expect(voxels[63]).toBe(255);
    expect(volume.scalarRange).toEqual([0, 63]);
    expect(volume.texture.userData.v23Owned).toBe(true);
  });

  it("honours origin / spacing / direction through indexToWorld", () => {
    const image = vtkImageData.newInstance();
    image.setDimensions(2, 2, 2);
    image.setSpacing([2, 3, 4]);
    image.setOrigin([10, 20, 30]);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        name: "scalars",
        values: new Float32Array(8),
        numberOfComponents: 1,
      })
    );
    image.computeTransforms();
    const volume = readImageVolume(image as unknown as ImageDataLike, resolveOptions())!;
    const m = volume.indexToWorld.elements;
    expect(m[0]).toBe(2);
    expect(m[5]).toBe(3);
    expect(m[10]).toBe(4);
    expect(m[12]).toBe(10);
    expect(m[13]).toBe(20);
    expect(m[14]).toBe(30);
  });

  it("downsamples volumes exceeding maxVolumeSize", () => {
    const volume = readImageVolume(
      makeImage([8, 8, 8]),
      resolveOptions({ maxVolumeSize: 4 })
    )!;
    expect(volume.dimensions).toEqual([4, 4, 4]);
    expect(volume.sourceDimensions).toEqual([8, 8, 8]);
    expect(volume.voxelCount).toBe(64);
    expect(volume.warnings.some((w) => w.includes("downsampled by 2"))).toBe(true);
  });

  it("builds a textured centre slice plus a bounding box", () => {
    const slice = readImageSlice(makeImage(), null, resolveOptions())!;
    expect(slice).toBeDefined();
    expect(slice.geometry.getAttribute("position").count).toBe(4);
    expect(slice.geometry.getIndex()!.count).toBe(6);
    expect(slice.texture.image.data).toHaveLength(4 * 4 * 4);
    expect(slice.outline.getAttribute("position").count).toBe(24);
    expect(slice.texture.userData.v23Owned).toBe(true);
  });

  it("convertActor emits a slice Mesh and an outline LineSegments", () => {
    const mapper = vtkMapper.newInstance();
    mapper.setInputData(makeImage() as never);
    mapper.setScalarVisibility(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const result = convertActor(actor)!;
    expect(result.object.children.map((child) => child.name)).toEqual([
      "vtkImageSlice",
      "vtkImageOutline",
    ]);
    const sliceMesh = result.object.children[0] as unknown as {
      material: MeshBasicMaterial;
    };
    expect(sliceMesh.material.map).toBeTruthy();
    expect(result.report.stats.triangles).toBe(2);
    expect(result.report.stats.textures).toBe(1);
    expect(
      result.report.warnings.some((w) => w.includes("centre") && w.includes("slice"))
    ).toBe(true);
    result.dispose();
  });

  it("imageDataSlice:false emits only the bounding box", () => {
    const mapper = vtkMapper.newInstance();
    mapper.setInputData(makeImage() as never);
    mapper.setScalarVisibility(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const result = convertActor(actor, { imageDataSlice: false })!;
    expect(result.object.children).toHaveLength(1);
    expect(result.object.children[0].name).toBe("vtkImageOutline");
    expect(result.report.warnings.some((w) => w.includes("imageDataSlice is disabled"))).toBe(true);
    result.dispose();
  });
});
