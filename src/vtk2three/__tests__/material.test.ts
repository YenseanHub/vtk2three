import { describe, expect, it } from "vitest";
import {
  BackSide,
  FrontSide,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  Texture,
} from "three";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkTexture from "@kitware/vtk.js/Rendering/Core/Texture.js";
import type { vtkTexture as VtkTextureType } from "@kitware/vtk.js/Rendering/Core/Texture.js";
import { MaterialMapper } from "../Core/MaterialMapper";
import { resolveOptions } from "../types";

function property() {
  return vtkActor.newInstance().getProperty();
}

function mapper(prop: ReturnType<typeof property>) {
  return new MaterialMapper(prop, resolveOptions());
}

function onePixelTexture(): VtkTextureType {
  // jsdom does not expose ImageData; vtkTexture passes this object through
  // unchanged and the mapper only needs data/width/height.
  const imageData = {
    data: new Uint8ClampedArray([255, 0, 0, 255]),
    width: 1,
    height: 1,
  } as unknown as ImageData;
  return vtkTexture.newInstance({ jsImageData: imageData, imageLoaded: true });
}

describe("P3 vtkProperty -> three material", () => {
  it("maps classic lighting to Lambert / Phong", () => {
    const prop = property();
    prop.setInterpolationToPhong();
    prop.setSpecularPower(42);
    prop.setSpecular(0.8);
    prop.setSpecularColor(1, 1, 1);
    const set = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect(set.surface).toBeInstanceOf(MeshPhongMaterial);
    expect((set.surface as MeshPhongMaterial).shininess).toBe(42);
  });

  it("maps PBR parameters to MeshPhysicalMaterial", () => {
    const prop = property();
    prop.setInterpolationToPBR();
    prop.setMetallic(0.7);
    prop.setRoughness(0.2);
    prop.setCoatStrength(0.4);
    const set = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect(set.surface).toBeInstanceOf(MeshPhysicalMaterial);
    const pbr = set.surface as MeshPhysicalMaterial;
    expect(pbr.metalness).toBeCloseTo(0.7);
    expect(pbr.roughness).toBeCloseTo(0.2);
    expect(pbr.clearcoat).toBeCloseTo(0.4);
  });

  it("maps representation, point size and line width", () => {
    const prop = property();
    prop.setRepresentationToWireframe();
    prop.setPointSize(5);
    prop.setLineWidth(3);
    const set = mapper(prop).mapMaterialSet({
      hasTCoords: false,
      hasAlpha: false,
      representation: 1,
    });
    expect((set.surface as MeshBasicMaterial & { wireframe: boolean }).wireframe).toBe(true);
    expect(set.point.size).toBe(5);
    expect(set.line.linewidth).toBe(3);
    expect(set.warnings.some((w) => w.includes("lineWidth"))).toBe(true);
    expect(() => mapper(prop).mapMaterial()).not.toThrow();
  });

  it("maps lighting=false and culling / opacity", () => {
    const prop = property();
    prop.setLighting(false);
    prop.setOpacity(0.4);
    prop.setBackfaceCulling(true);
    let set = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect(set.surface).toBeInstanceOf(MeshBasicMaterial);
    expect(set.surface.transparent).toBe(true);
    expect(set.surface.side).toBe(FrontSide);

    prop.setBackfaceCulling(false);
    prop.setFrontfaceCulling(true);
    set = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect(set.surface.side).toBe(BackSide);
  });

  it("converts vtkTexture objects only when texture coordinates exist", () => {
    const prop = property();
    const texture = onePixelTexture();
    prop.setDiffuseTexture(texture);

    const withoutUv = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect((withoutUv.surface as unknown as { map?: Texture | null }).map).toBeFalsy();
    expect(withoutUv.warnings.some((w) => w.includes("no texture coordinates"))).toBe(true);

    const withUv = mapper(prop).mapMaterialSet({ hasTCoords: true, hasAlpha: false });
    const map = (withUv.surface as unknown as { map?: Texture }).map;
    expect(map).toBeInstanceOf(Texture);
    expect(map!.userData.v23Owned).toBe(true);
    expect(withUv.textures).toHaveLength(1);
  });

  it("maps edge visibility to a wireframe overlay", () => {
    const prop = property();
    prop.setEdgeVisibility(true);
    const set = mapper(prop).mapMaterialSet({ hasTCoords: false, hasAlpha: false });
    expect(set.edge).toBeDefined();
    expect((set.edge as unknown as { wireframe: boolean }).wireframe).toBe(true);
  });
});
