import { describe, expect, it } from "vitest";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import {
  CellType,
  Representation,
} from "../Core/constants";
import {
  gridFromDataSet,
  readGridTopology,
} from "../Core/UnstructuredTopology";
import type { GridDataSet } from "../Core/UnstructuredTopology";
import { resolveOptions } from "../types";
import { convertActor } from "../v23Mapper";

const options = resolveOptions();

const tetraPoints = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

const hexPoints = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
]);

describe("P5-A generic unstructured grid topology", () => {
  it("expands a tetrahedron into its four outward faces", () => {
    const grid: GridDataSet = {
      points: tetraPoints,
      cells: new Uint32Array([4, 0, 1, 2, 3]),
      cellTypes: new Uint8Array([CellType.VTK_TETRA]),
    };
    const topology = readGridTopology(grid, tetraPoints, Representation.SURFACE, options);
    expect(topology.cellCount).toBe(1);
    expect(topology.surface.cellIds).toHaveLength(4);
    expect(topology.surface.indices).toHaveLength(12);
    expect(topology.lines.indices).toHaveLength(0);
    expect(topology.warnings).toHaveLength(0);
  });

  it("expands a hexahedron into 12 triangles and 12 unique wireframe edges", () => {
    const grid: GridDataSet = {
      points: hexPoints,
      cells: new Uint32Array([8, 0, 1, 2, 3, 4, 5, 6, 7]),
      cellTypes: new Uint8Array([CellType.VTK_HEXAHEDRON]),
    };
    const surface = readGridTopology(grid, hexPoints, Representation.SURFACE, options);
    expect(surface.surface.cellIds).toHaveLength(12);

    const wireframe = readGridTopology(grid, hexPoints, Representation.WIREFRAME, options);
    expect(wireframe.lines.cellIds).toHaveLength(12);
    expect(wireframe.surface.indices).toHaveLength(0);
  });

  it("expands voxel, wedge, pyramid and prism cells", () => {
    const eight = new Uint32Array([8, 0, 1, 2, 3, 4, 5, 6, 7]);
    const six = new Uint32Array([6, 0, 1, 2, 3, 4, 5]);
    for (const [type, cells, expectedTriangles] of [
      [CellType.VTK_VOXEL, eight, 12],
      [CellType.VTK_WEDGE, six, 8],
      [CellType.VTK_PYRAMID, new Uint32Array([5, 0, 1, 2, 3, 4]), 6],
    ] as const) {
      const topology = readGridTopology(
        { points: hexPoints, cells, cellTypes: new Uint8Array([type]) },
        hexPoints,
        Representation.SURFACE,
        options
      );
      expect(topology.surface.cellIds, `cell type ${type}`).toHaveLength(expectedTriangles);
    }
  });

  it("handles mixed 0D / 1D / 2D / 3D cells and preserves vtk cell ids", () => {
    const grid: GridDataSet = {
      points: hexPoints,
      cells: new Uint32Array([
        1, 0,
        2, 1, 2,
        4, 0, 1, 2, 3,
        8, 0, 1, 2, 3, 4, 5, 6, 7,
      ]),
      cellTypes: new Uint8Array([
        CellType.VTK_VERTEX,
        CellType.VTK_LINE,
        CellType.VTK_QUAD,
        CellType.VTK_HEXAHEDRON,
      ]),
    };
    const topology = readGridTopology(grid, hexPoints, Representation.SURFACE, options);
    expect(topology.cellCount).toBe(4);
    expect(topology.points.indices).toEqual([0]);
    expect(topology.lines.indices).toEqual([1, 2]);
    // quad (2) + hexahedron (12)
    expect(topology.surface.cellIds).toHaveLength(14);
    expect(new Set(topology.surface.cellIds)).toEqual(new Set([2, 3]));
  });

  it("drops out-of-range point ids and reports unsupported cell types", () => {
    const grid: GridDataSet = {
      points: tetraPoints,
      cells: new Uint32Array([3, 0, 1, 99, 3, 0, 1, 2]),
      cellTypes: new Uint8Array([CellType.VTK_TRIANGLE, 42]),
    };
    const topology = readGridTopology(grid, tetraPoints, Representation.SURFACE, options);
    // The first triangle loses a vertex and can no longer be emitted; the
    // polyhedron cell type is reported as unsupported. No invalid indices leak.
    expect(topology.surface.indices).toHaveLength(0);
    expect(topology.cellCount).toBe(2);
    expect(topology.warnings.some((w) => w.includes("out-of-range"))).toBe(true);
    expect(topology.warnings.some((w) => w.includes("Unsupported grid cell types"))).toBe(true);
  });

  it("stops safely on a malformed cell array", () => {
    const grid: GridDataSet = {
      points: tetraPoints,
      cells: new Uint32Array([99, 0, 1]),
      cellTypes: new Uint8Array([CellType.VTK_TETRA]),
    };
    const topology = readGridTopology(grid, tetraPoints, Representation.SURFACE, options);
    expect(topology.warnings.some((w) => w.includes("Malformed"))).toBe(true);
    expect(topology.cellCount).toBe(0);
  });
});

describe("P5-A grid normalisation and actor integration", () => {
  it("reads arrays from a duck-typed vtk-like data set", () => {
    const fake = {
      getPoints: () => ({ getData: () => tetraPoints }),
      getCells: () => ({ getData: () => new Uint32Array([3, 0, 1, 2]) }),
      getCellTypesArray: () => new Uint8Array([CellType.VTK_TRIANGLE]),
    };
    const grid = gridFromDataSet(fake)!;
    expect(grid).toBeDefined();
    expect(grid.points.length).toBe(12);
    expect(grid.cells.length).toBe(4);
    expect(grid.cellTypes[0]).toBe(CellType.VTK_TRIANGLE);
  });

  it("reads the serialized HttpDataSetReader shape", () => {
    const grid = gridFromDataSet({
      points: { values: tetraPoints },
      cells: { values: new Uint32Array([3, 0, 1, 2]) },
      cellTypes: { values: new Uint8Array([CellType.VTK_TRIANGLE]) },
    })!;
    expect(grid.points.length).toBe(12);
    expect(grid.cells.length).toBe(4);
  });

  it("convertActor builds a Mesh for a generic grid input", () => {
    const fake = {
      getPoints: () => ({ getData: () => tetraPoints }),
      getCells: () => ({ getData: () => new Uint32Array([4, 0, 1, 2, 3]) }),
      getCellTypesArray: () => new Uint8Array([CellType.VTK_TETRA]),
      getMTime: () => 1,
    };
    const mapper = vtkMapper.newInstance();
    mapper.setInputData(fake as never);
    mapper.setScalarVisibility(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const result = convertActor(actor)!;
    expect(result.object.children[0].type).toBe("Mesh");
    expect(result.report.stats.points).toBe(4);
    expect(result.report.stats.cells).toBe(1);
    expect(result.report.stats.triangles).toBe(4);
    expect(
      result.report.warnings.some((w) => w.includes("no vtkUnstructuredGrid class"))
    ).toBe(true);
    result.dispose();
  });
});
