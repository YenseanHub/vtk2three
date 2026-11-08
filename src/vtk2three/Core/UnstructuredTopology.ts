import { CellType, Representation } from "./constants";
import type { RepresentationValue } from "./constants";
import { triangulatePolygon } from "./CellArrayReader";
import type { PrimitiveBuffer, Topology } from "./CellArrayReader";
import type { ResolvedV23Options } from "../types";

/**
 * A minimal, explicit description of an unstructured grid.
 *
 * vtk.js 38 has **no vtkUnstructuredGrid class** (HttpDataSetReader only
 * dispatches its serialized `points` / `cells` / `cellTypes` payload). P5
 * therefore accepts the data in this neutral shape: either from a serialized
 * dataset, from a duck-typed vtk-like object via `gridFromDataSet()`, or built
 * directly by the caller. `cells` uses the vtk flattened CellArray convention
 * `[n, id0, id1, ..., n, ...]` and `cellTypes` holds one vtk CellType per cell.
 */
export interface GridDataSet {
  /** Flat xyz coordinates. */
  points: ArrayLike<number>;
  /** Flattened cell connectivity. */
  cells: ArrayLike<number>;
  /** One vtk CellType value per cell. */
  cellTypes: ArrayLike<number>;
}

function toArrayLike(value: unknown): ArrayLike<number> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") return undefined;
  if ("length" in value) return value as ArrayLike<number>;
  const record = value as Record<string, unknown>;
  for (const key of ["values", "data", "getData", "getTypeArray"]) {
    const candidate = record[key];
    const resolved =
      typeof candidate === "function"
        ? (candidate as () => unknown).call(value)
        : candidate;
    if (resolved && typeof resolved === "object" && "length" in resolved) {
      return resolved as ArrayLike<number>;
    }
  }
  return undefined;
}

/**
 * Extracts grid arrays from anything that looks like a vtk data set.
 * Handles vtkCellArray / vtkDataArray wrappers and the plain serialized shape
 * produced by vtk.js HttpDataSetReader.
 */
export function gridFromDataSet(input: unknown): GridDataSet | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;

  const get = (name: string): unknown => {
    const member = source[name];
    return typeof member === "function"
      ? (member as () => unknown).call(source)
      : member;
  };

  const rawPoints = toArrayLike(get("getPoints") ?? source.points);
  const points = rawPoints ?? toArrayLike(source.points);
  const cells = toArrayLike(get("getCells") ?? source.cells);
  const cellTypes = toArrayLike(
    get("getCellTypesArray") ?? source.cellTypes ?? get("getCellTypes")
  );

  if (!points || !cells || !cellTypes) return undefined;
  return { points, cells, cellTypes };
}

type Face = number[];

/** VTK linear 3D cell -> outward face vertex ids (local cell ordering). */
function volumeFaces(type: number, ids: number[]): Face[] | undefined {
  const n = ids.length;
  switch (type) {
    case CellType.VTK_TETRA:
      if (n < 4) return undefined;
      return [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ];
    case CellType.VTK_VOXEL:
      if (n < 8) return undefined;
      return [
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
      ];
    case CellType.VTK_HEXAHEDRON:
      if (n < 8) return undefined;
      return [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ];
    case CellType.VTK_WEDGE:
      if (n < 6) return undefined;
      return [
        [0, 2, 1],
        [3, 4, 5],
        [0, 1, 4, 3],
        [1, 2, 5, 4],
        [2, 0, 3, 5],
      ];
    case CellType.VTK_PYRAMID:
      if (n < 5) return undefined;
      return [
        [0, 3, 2, 1],
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ];
    case CellType.VTK_PENTAGONAL_PRISM:
      return prismFaces(5, n);
    case CellType.VTK_HEXAGONAL_PRISM:
      return prismFaces(6, n);
    default:
      return undefined;
  }
}

function prismFaces(sides: number, n: number): Face[] | undefined {
  if (n < 2 * sides) return undefined;
  const bottom: Face = [];
  const top: Face = [];
  for (let i = 0; i < sides; ++i) {
    bottom.push(sides - 1 - i);
    top.push(sides + i);
  }
  const faces: Face[] = [bottom, top];
  for (let i = 0; i < sides; ++i) {
    const next = (i + 1) % sides;
    faces.push([i, next, sides + next, sides + i]);
  }
  return faces;
}

function surfaceFaces(type: number, ids: number[]): Face[] {
  switch (type) {
    case CellType.VTK_TRIANGLE:
      return [[0, 1, 2]];
    case CellType.VTK_QUAD:
      return [[0, 1, 2, 3]];
    case CellType.VTK_PIXEL:
      // VTK_PIXEL interleaves the axes: 0=(0,0) 1=(1,0) 2=(0,1) 3=(1,1).
      return [[0, 1, 3, 2]];
    case CellType.VTK_TRIANGLE_STRIP:
    case CellType.VTK_POLYGON:
      return [ids.map((_, index) => index)];
    default:
      return [];
  }
}

function isLineType(type: number): boolean {
  return type === CellType.VTK_LINE || type === CellType.VTK_POLY_LINE;
}

function isVertexType(type: number): boolean {
  return type === CellType.VTK_VERTEX || type === CellType.VTK_POLY_VERTEX;
}

function isVolumeType(type: number): boolean {
  return (
    type === CellType.VTK_TETRA ||
    type === CellType.VTK_VOXEL ||
    type === CellType.VTK_HEXAHEDRON ||
    type === CellType.VTK_WEDGE ||
    type === CellType.VTK_PYRAMID ||
    type === CellType.VTK_PENTAGONAL_PRISM ||
    type === CellType.VTK_HEXAGONAL_PRISM
  );
}

function makeBuffer(stride: 1 | 2 | 3): PrimitiveBuffer {
  return { indices: [], cellIds: [], stride };
}

function emit(buffer: PrimitiveBuffer, ids: number[], cellId: number): void {
  for (const id of ids) buffer.indices.push(id);
  buffer.cellIds.push(cellId);
}

/**
 * Expands a generic unstructured grid into the same Topology buffers used by
 * the PolyData pipeline, so scalar colors / normals / geometry assembly can be
 * reused verbatim.
 */
export function readGridTopology(
  grid: GridDataSet,
  positions: Float32Array,
  representation: RepresentationValue,
  options: ResolvedV23Options
): Topology {
  const surface = makeBuffer(3);
  const lines = makeBuffer(2);
  const points = makeBuffer(1);
  const warnings: string[] = [];
  const pointCount = Math.floor(positions.length / 3);

  let offset = 0;
  let cellId = 0;
  const unsupportedTypes = new Set<number>();

  while (offset < grid.cells.length) {
    const count = Number(grid.cells[offset]);
    if (!Number.isFinite(count) || count < 0 || offset + count + 1 > grid.cells.length) {
      warnings.push(
        `Malformed grid cell array at offset ${offset} (size ${count}); stopped reading.`
      );
      break;
    }
    const raw: number[] = [];
    for (let i = 0; i < count; ++i) raw.push(Number(grid.cells[offset + 1 + i]));
    const ids = raw.filter(
      (id) => Number.isInteger(id) && id >= 0 && id < pointCount
    );
    if (ids.length !== raw.length) {
      warnings.push("A grid cell referenced an out-of-range point id; it was dropped.");
    }
    const type = Number(grid.cellTypes[cellId]);
    offset += count + 1;

    if (representation === Representation.POINTS) {
      for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
      ++cellId;
      continue;
    }

    if (isVertexType(type)) {
      for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
      ++cellId;
      continue;
    }

    if (isLineType(type)) {
      for (let i = 0; i + 1 < ids.length; ++i) {
        emit(lines, [ids[i], ids[i + 1]], cellId);
      }
      ++cellId;
      continue;
    }

    const faces =
      volumeFaces(type, ids) ?? (isVolumeType(type) ? undefined : surfaceFaces(type, ids));

    if (!faces || (faces.length === 0 && !isVolumeType(type))) {
      if (isVolumeType(type) && !faces) {
        warnings.push(
          `A volume cell (type ${type}) has fewer points than required; it was skipped.`
        );
      } else if (type !== CellType.VTK_EMPTY_CELL) {
        unsupportedTypes.add(type);
      }
      ++cellId;
      continue;
    }

    if (representation === Representation.WIREFRAME) {
      const seen = new Set<string>();
      for (const face of faces) {
        for (let i = 0; i < face.length; ++i) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (seen.has(key) || ids[a] === undefined || ids[b] === undefined) continue;
          seen.add(key);
          emit(lines, [ids[a], ids[b]], cellId);
        }
      }
      ++cellId;
      continue;
    }

    if (type === CellType.VTK_TRIANGLE_STRIP) {
      for (let i = 0; i + 2 < ids.length; ++i) {
        emit(
          surface,
          [ids[i], ids[i + 1 + (i % 2)], ids[i + 1 + ((i + 1) % 2)]],
          cellId
        );
      }
      ++cellId;
      continue;
    }

    for (const face of faces) {
      const local = face.map((index) => ids[index]).filter((id) => id !== undefined);
      if (local.length < 3) continue;
      const { triangles, usedFallback } = triangulatePolygon(
        local,
        positions,
        options.triangulateConcavePolygons
      );
      if (usedFallback) {
        warnings.push("A grid face could not be ear-clipped; used a triangle fan.");
      }
      for (const triangle of triangles) emit(surface, triangle, cellId);
    }
    ++cellId;
  }

  if (unsupportedTypes.size > 0) {
    warnings.push(
      `Unsupported grid cell types were skipped: ${[...unsupportedTypes].sort((a, b) => a - b).join(", ")}.`
    );
  }

  return { surface, lines, points, cellCount: cellId, warnings };
}
