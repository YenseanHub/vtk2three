import { describe, expect, it } from "vitest";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray.js";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import type { vtkMapper as VtkMapperType } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import type { vtkPolyData as VtkPolyDataType } from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import { GeometryMapper } from "../Core/GeometryMapper";
import { resolveOptions } from "../types";

const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];

function makePipeline(options: { alphaRange?: [number, number] } = {}) {
  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(new Float32Array(square), 3);
  polyData.getPolys().setData(new Uint32Array([3, 0, 1, 2, 3, 0, 2, 3]));
  polyData
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({
        name: "height",
        numberOfComponents: 1,
        values: new Float32Array([0, 0.5, 1, 0.25]),
      })
    );

  const lut = vtkLookupTable.newInstance({
    hueRange: [0, 0.667],
    numberOfColors: 8,
    alphaRange: options.alphaRange ?? [1, 1],
  });
  lut.setRange(0, 1);

  const mapper = vtkMapper.newInstance();
  mapper.setLookupTable(lut);
  mapper.setInputData(polyData);
  mapper.setUseLookupTableScalarRange(true);
  return {
    mapper: mapper as VtkMapperType,
    polyData: polyData as VtkPolyDataType,
    lut,
  };
}

describe("P2 scalar coloring", () => {
  it("maps point scalars through the lookup table into linear vertex colors", () => {
    const { mapper } = makePipeline();
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    const color = set.surface!.getAttribute("color");
    expect(color.itemSize).toBe(3);
    expect(color.count).toBe(4);
    const values = Array.from(color.array as Float32Array);
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(values.slice(0, 3)).not.toEqual(values.slice(9, 12));
  });

  it("honours scalarVisibility=false by leaving white vertex colors", () => {
    const { mapper } = makePipeline();
    mapper.setScalarVisibility(false);
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    const values = Array.from(set.surface!.getAttribute("color").array as Float32Array);
    expect(values.every((v) => v === 1)).toBe(true);
  });

  it("honours colorByArrayName with USE_POINT_DATA", () => {
    const { mapper, polyData } = makePipeline();
    polyData
      .getPointData()
      .addArray(
        vtkDataArray.newInstance({
          name: "other",
          numberOfComponents: 1,
          values: new Float32Array([1, 1, 1, 0]),
        })
      );
    mapper.setScalarModeToUsePointData();
    mapper.setColorByArrayName("other");

    const before = new GeometryMapper(mapper).mapPrimitives()!;
    const named = Array.from(
      before.surface!.getAttribute("color").array as Float32Array
    );
    expect(named.slice(0, 3)).toEqual(named.slice(3, 6));
    expect(named.slice(0, 3)).not.toEqual(named.slice(9, 12));
  });

  it("expands cell colors by splitting vertices (no index buffer)", () => {
    const { mapper, polyData } = makePipeline();
    polyData
      .getCellData()
      .setScalars(
        vtkDataArray.newInstance({
          name: "cellId",
          numberOfComponents: 1,
          values: new Float32Array([0, 1]),
        })
      );
    mapper.setScalarModeToUseCellData();

    const set = new GeometryMapper(mapper).mapPrimitives()!;
    const geometry = set.surface!;
    expect(geometry.getIndex()).toBeNull();
    const color = geometry.getAttribute("color");
    expect(color.count).toBe(6);
    const values = Array.from(color.array as Float32Array);
    expect(values.slice(0, 3)).toEqual(values.slice(3, 6));
    expect(values.slice(0, 3)).not.toEqual(values.slice(9, 12));
  });

  it("emits RGBA vertex colors when the lookup table supplies alpha", () => {
    const { mapper } = makePipeline({ alphaRange: [0.5, 0.5] });
    const withAlpha = new GeometryMapper(mapper).mapPrimitives()!;
    expect(withAlpha.hasAlpha).toBe(true);
    expect(withAlpha.colorComponents).toBe(4);
    const color = withAlpha.surface!.getAttribute("color");
    expect(color.itemSize).toBe(4);
    expect((color.array as Float32Array)[3]).toBeLessThan(1);

    const withoutAlpha = new GeometryMapper(
      mapper,
      resolveOptions({ vertexAlpha: false })
    ).mapPrimitives()!;
    expect(withoutAlpha.hasAlpha).toBe(false);
    expect(withoutAlpha.surface!.getAttribute("color").itemSize).toBe(3);
  });

  it("supports DIRECT_SCALARS RGBA arrays", () => {
    const { mapper, polyData } = makePipeline();
    polyData
      .getPointData()
      .setScalars(
        vtkDataArray.newInstance({
          name: "rgba",
          numberOfComponents: 4,
          values: new Uint8Array([
            255, 0, 0, 128,
            0, 255, 0, 255,
            0, 0, 255, 255,
            255, 255, 255, 255,
          ]),
        })
      );
    mapper.setColorModeToDirectScalars();

    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.colorComponents).toBe(4);
    const color = set.surface!.getAttribute("color");
    expect(color.itemSize).toBe(4);
    expect((color.array as Float32Array)[3]).toBeLessThan(1);
    expect(set.warnings.some((w) => w.includes("DIRECT_SCALARS"))).toBe(true);
  });

  it("broadcasts a single field-data tuple to every point", () => {
    const { mapper, polyData } = makePipeline();
    polyData
      .getFieldData()
      .addArray(
        vtkDataArray.newInstance({
          name: "uniform",
          numberOfComponents: 1,
          values: new Float32Array([0.5]),
        })
      );
    mapper.setScalarModeToUseFieldData();
    mapper.setColorByArrayName("uniform");

    const set = new GeometryMapper(mapper).mapPrimitives()!;
    const values = Array.from(set.surface!.getAttribute("color").array as Float32Array);
    expect(values.slice(0, 3)).toEqual(values.slice(3, 6));
    expect(values.slice(0, 3)).toEqual(values.slice(9, 12));
  });
});
