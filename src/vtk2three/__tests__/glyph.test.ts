import { describe, expect, it } from "vitest";
import { InstancedMesh } from "three";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import vtkGlyph3DMapper from "@kitware/vtk.js/Rendering/Core/Glyph3DMapper.js";
import { ScaleMode } from "../Core/constants";
import { buildGlyphObject } from "../Core/GlyphMapper";
import type { Glyph3DMapperLike } from "../Core/GlyphMapper";
import { resolveOptions } from "../types";
import { convertActor } from "../v23Mapper";

function makeInput(): ReturnType<typeof vtkPolyData.newInstance> {
  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(
    new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
    3
  );
  polyData.getVerts().setData(new Uint32Array([1, 0, 1, 1, 1, 2]));
  return polyData;
}

function makeGlyph(): ReturnType<typeof vtkPolyData.newInstance> {
  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    3
  );
  polyData.getPolys().setData(new Uint32Array([3, 0, 1, 2]));
  return polyData;
}

describe("P5-B vtkGlyph3DMapper -> InstancedMesh", () => {
  it("uses vtk.js buildArrays() matrices directly", () => {
    const mapper = vtkGlyph3DMapper.newInstance();
    mapper.setInputData(makeInput(), 0);
    mapper.setInputData(makeGlyph(), 1);
    mapper.setOrient(false);
    mapper.setScaling(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper as never);

    const result = convertActor(actor)!;
    const instanced = result.object.children[0] as InstancedMesh;
    expect(instanced).toBeInstanceOf(InstancedMesh);
    expect(instanced.count).toBe(3);
    expect(result.report.stats.glyphs).toBe(3);
    expect(result.report.stats.primitives).toBe(1);

    const vtkMatrices = mapper.getMatrixArray()!;
    const threeMatrices = instanced.instanceMatrix.array as Float32Array;
    expect(Array.from(threeMatrices)).toEqual(Array.from(vtkMatrices));
    // column-major translation lives at 12/13/14
    expect(threeMatrices[12]).toBe(0);
    expect(threeMatrices[16 + 12]).toBe(1);
    expect(threeMatrices[32 + 12]).toBe(2);
    result.dispose();
  });

  it("recomputes transforms when buildArrays() is unavailable", () => {
    const input = makeInput();
    const glyph = makeGlyph();
    const fake: Glyph3DMapperLike = {
      getInputData: <T>(port?: number) => (port === 1 ? glyph : input) as T,
      getScaleArrayData: () => null,
      getOrientationArrayData: () => null,
      getScaleFactor: () => 2,
      getScaling: () => true,
      getScaleMode: () => ScaleMode.SCALE_BY_CONSTANT,
      getOrient: () => false,
    };
    const property = vtkActor.newInstance().getProperty();
    const build = buildGlyphObject(fake, property, resolveOptions())!;
    expect(build).toBeDefined();
    expect(build.count).toBe(3);
    expect(build.object).toBeInstanceOf(InstancedMesh);
    expect(
      build.warnings.some((w) => w.includes("fallback transform path"))
    ).toBe(true);
    const matrices = build.object.instanceMatrix.array as Float32Array;
    expect(matrices[12]).toBe(0);
    expect(matrices[16 + 12]).toBe(1);
    expect(matrices[32 + 12]).toBe(2);
    // SCALE_BY_CONSTANT with scaleFactor 2
    expect(matrices[0]).toBe(2);
  });

  it("scales by magnitude from the scale array", () => {
    const input = makeInput();
    const fake: Glyph3DMapperLike = {
      getInputData: <T>(port?: number) => (port === 1 ? makeGlyph() : input) as T,
      getScaleArrayData: () => ({
        getData: () => new Float32Array([1, 2, 3]),
        getNumberOfComponents: () => 1,
        getNumberOfTuples: () => 3,
      }),
      getOrientationArrayData: () => null,
      getScaleFactor: () => 1,
      getScaling: () => true,
      getScaleMode: () => ScaleMode.SCALE_BY_MAGNITUDE,
      getOrient: () => false,
    };
    const build = buildGlyphObject(
      fake,
      vtkActor.newInstance().getProperty(),
      resolveOptions()
    )!;
    const matrices = build.object.instanceMatrix.array as Float32Array;
    expect(matrices[0]).toBe(1);
    expect(matrices[16]).toBe(2);
    expect(matrices[32]).toBe(3);
  });

  it("maps per-instance LUT colors into linear instanceColor", () => {
    const fake: Glyph3DMapperLike = {
      getInputData: <T>(port?: number) => (port === 1 ? makeGlyph() : makeInput()) as T,
      getScaleArrayData: () => null,
      getOrientationArrayData: () => null,
      getScaleFactor: () => 1,
      getScaling: () => false,
      getScaleMode: () => ScaleMode.SCALE_BY_CONSTANT,
      getOrient: () => false,
      getColorArray: () => ({
        getData: () => new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]),
        getNumberOfComponents: () => 4,
        getNumberOfTuples: () => 3,
      }),
    };
    const build = buildGlyphObject(
      fake,
      vtkActor.newInstance().getProperty(),
      resolveOptions()
    )!;
    const colors = build.object.instanceColor!.array as Float32Array;
    // instance 0 = (1,0,0), instance 1 = (0,1,0), instance 2 = (1,1,1)
    expect(colors[0]).toBeCloseTo(1);
    expect(colors[1]).toBeCloseTo(0);
    expect(colors[3]).toBeCloseTo(0);
    expect(colors[4]).toBeCloseTo(1);
    expect(colors[5]).toBeCloseTo(0);
    expect(colors[6]).toBeCloseTo(1);
    expect(colors[8]).toBeCloseTo(1);
  });
});
