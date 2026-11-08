import { describe, expect, it } from "vitest";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import type { vtkMapper as VtkMapperType } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import type { vtkCellArray } from "@kitware/vtk.js/Common/Core/CellArray.js";
import type { BufferGeometry } from "three";
import { GeometryMapper } from "../Core/GeometryMapper";
import { Representation } from "../Core/constants";
import { resolveOptions } from "../types";

type CellKey = "verts" | "lines" | "polys" | "strips";

function makeMapper(points: number[], cells: Partial<Record<CellKey, number[]>>) {
  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(new Float32Array(points), 3);
  const accessors: Record<CellKey, () => vtkCellArray> = {
    verts: () => polyData.getVerts(),
    lines: () => polyData.getLines(),
    polys: () => polyData.getPolys(),
    strips: () => polyData.getStrips(),
  };
  for (const key of Object.keys(cells) as CellKey[]) {
    const values = cells[key];
    if (values) accessors[key]().setData(new Uint32Array(values));
  }
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);
  return { mapper: mapper as VtkMapperType, polyData };
}

const squarePoints = [
  0, 0, 0,
  1, 0, 0,
  1, 1, 0,
  0, 1, 0,
];

function indicesOf(geometry: BufferGeometry | undefined): number[] {
  if (!geometry) return [];
  const index = geometry.getIndex();
  if (index) return Array.from(index.array);
  return Array.from(geometry.getAttribute("position").array as Float32Array).map(
    (_, i) => i
  );
}

describe("P1 generic PolyData topology", () => {
  it("triangulates triangles, quads and convex n-gons", () => {
    const pentagon = [
      0, 0, 0,
      2, 0, 0,
      3, 1, 0,
      1.5, 2, 0,
      0, 1, 0,
    ];
    const { mapper } = makeMapper(pentagon, { polys: [5, 0, 1, 2, 3, 4] });
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.counts.triangles).toBe(3);
    expect(set.surface!.getIndex()!.count).toBe(9);
  });

  it("ear-clips concave polygons instead of fanning through the hole", () => {
    // C-shaped polygon: (x>1, 1<y<3) is outside the polygon.
    const points = [
      0, 0, 0,
      4, 0, 0,
      4, 1, 0,
      1, 1, 0,
      1, 3, 0,
      4, 3, 0,
      4, 4, 0,
      0, 4, 0,
    ];
    const { mapper } = makeMapper(points, { polys: [8, 0, 1, 2, 3, 4, 5, 6, 7] });
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.counts.triangles).toBe(6);
    expect(set.warnings).toEqual([]);

    const index = Array.from(set.surface!.getIndex()!.array);
    for (let i = 0; i < index.length; i += 3) {
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < 3; ++k) {
        cx += points[3 * index[i + k]];
        cy += points[3 * index[i + k] + 1];
      }
      cx /= 3;
      cy /= 3;
      expect(cx > 1 && cy > 1 && cy < 3).toBe(false);
    }
  });

  it("expands triangle strips using the vtk.js winding rule", () => {
    const { mapper } = makeMapper(squarePoints, { strips: [4, 0, 1, 2, 3] });
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.counts.triangles).toBe(2);
    expect(indicesOf(set.surface)).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it("handles lines, verts and mixed cell arrays", () => {
    const { mapper } = makeMapper(squarePoints, {
      verts: [1, 0],
      lines: [3, 1, 2, 3],
      polys: [3, 0, 1, 2],
      strips: [4, 0, 1, 2, 3],
    });
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.cellCount).toBe(4);
    expect(set.counts.vertices).toBe(1);
    expect(set.counts.lineSegments).toBe(2);
    expect(set.counts.triangles).toBe(3);
    expect(indicesOf(set.points)).toEqual([0]);
    expect(indicesOf(set.lines)).toEqual([1, 2, 2, 3]);
    expect(set.surface!.getIndex()!.count).toBe(9);
  });

  it("produces closed polygon edges for WIREFRAME", () => {
    const { mapper } = makeMapper(squarePoints, { polys: [4, 0, 1, 2, 3] });
    const set = new GeometryMapper(mapper).mapPrimitives(Representation.WIREFRAME)!;
    expect(set.surface).toBeUndefined();
    expect(indicesOf(set.lines)).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
  });

  it("emits every cell point for POINTS representation", () => {
    const { mapper } = makeMapper(squarePoints, { polys: [4, 0, 1, 2, 3] });
    const set = new GeometryMapper(mapper).mapPrimitives(Representation.POINTS)!;
    expect(set.surface).toBeUndefined();
    expect(set.lines).toBeUndefined();
    expect(indicesOf(set.points)).toEqual([0, 1, 2, 3]);
  });

  it("falls back to a point cloud when a data set has no cells", () => {
    const { mapper } = makeMapper(squarePoints, {});
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.counts.vertices).toBe(4);
    expect(set.warnings.some((w) => w.includes("point cloud"))).toBe(true);
  });

  it("drops out-of-range point ids and reports it", () => {
    const { mapper } = makeMapper(squarePoints, { polys: [4, 0, 1, 2, 99] });
    const set = new GeometryMapper(mapper).mapPrimitives()!;
    expect(set.warnings.some((w) => w.includes("out-of-range"))).toBe(true);
    expect(set.counts.triangles).toBe(1);
  });

  it("uses Uint32 indices beyond 65535 points", () => {
    const polyData = vtkPolyData.newInstance();
    polyData.getPoints().setData(new Float32Array(65536 * 3), 3);
    const mapper = vtkMapper.newInstance();
    mapper.setInputData(polyData);
    const set = new GeometryMapper(
      mapper,
      resolveOptions({ computeNormals: false })
    ).mapPrimitives()!;
    expect(set.pointCount).toBe(65536);
    expect(set.points!.getIndex()!.array).toBeInstanceOf(Uint32Array);
  });
});
