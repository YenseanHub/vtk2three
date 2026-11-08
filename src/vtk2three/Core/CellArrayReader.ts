import type { vtkCellArray } from "@kitware/vtk.js/Common/Core/CellArray.js";
import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import { Representation } from "./constants";
import type { RepresentationValue } from "./constants";
import type { ResolvedV23Options } from "../types";

/** Flat point ids plus the vtk cell id that produced each primitive. */
export interface PrimitiveBuffer {
  indices: number[];
  /** One entry per primitive (triangle / segment / vertex), not per point id. */
  cellIds: number[];
  readonly stride: 1 | 2 | 3;
}

export interface Topology {
  /** Triangles from polys + triangle strips. */
  surface: PrimitiveBuffer;
  /** Line segments from lines / polygon edges / strip edges. */
  lines: PrimitiveBuffer;
  /** Individual points from verts (or every cell point in POINTS rep). */
  points: PrimitiveBuffer;
  /** Number of vtk cells across verts + lines + polys + strips. */
  cellCount: number;
  warnings: string[];
}

type CellVisitor = (ids: number[], cellId: number) => void;

function forEachCell(
  cellArray: vtkCellArray | null | undefined,
  baseCellId: number,
  warnings: string[],
  visit: CellVisitor
): number {
  if (!cellArray) return baseCellId;
  const data = cellArray.getData();
  if (!data || data.length === 0) return baseCellId;

  let offset = 0;
  let cellId = baseCellId;
  while (offset < data.length) {
    const count = Number(data[offset]);
    if (!Number.isFinite(count) || count < 0 || offset + count + 1 > data.length) {
      warnings.push(
        `Malformed cell array at offset ${offset} (size ${count}); stopped reading it.`
      );
      break;
    }
    const ids: number[] = [];
    for (let i = 0; i < count; ++i) ids.push(Number(data[offset + 1 + i]));
    visit(ids, cellId);
    offset += count + 1;
    ++cellId;
  }
  return cellId;
}

/** Newell normal of a polygon, used to pick the best 2D projection plane. */
function polygonNormal(ids: number[], positions: Float32Array): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ids.length; ++i) {
    const a = 3 * ids[i];
    const b = 3 * ids[(i + 1) % ids.length];
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const bx = positions[b];
    const by = positions[b + 1];
    const bz = positions[b + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  return [nx, ny, nz];
}

interface Projected {
  u: number[];
  v: number[];
  sign: number;
}

function projectPolygon(ids: number[], positions: Float32Array): Projected {
  const [nx, ny, nz] = polygonNormal(ids, positions);
  const axis =
    Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz)
      ? 0
      : Math.abs(ny) >= Math.abs(nz)
        ? 1
        : 2;
  const u: number[] = [];
  const v: number[] = [];
  for (const id of ids) {
    const x = positions[3 * id];
    const y = positions[3 * id + 1];
    const z = positions[3 * id + 2];
    if (axis === 0) {
      u.push(y);
      v.push(z);
    } else if (axis === 1) {
      u.push(z);
      v.push(x);
    } else {
      u.push(x);
      v.push(y);
    }
  }
  let area = 0;
  for (let i = 0; i < u.length; ++i) {
    const j = (i + 1) % u.length;
    area += u[i] * v[j] - u[j] * v[i];
  }
  return { u, v, sign: area >= 0 ? 1 : -1 };
}

function cross2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Ear clipping for arbitrary (possibly concave) simple polygons.
 * Falls back to vtk.js's triangle fan when the polygon is degenerate or
 * self-intersecting, so we never emit fewer triangles than vtk would.
 */
export function triangulatePolygon(
  ids: number[],
  positions: Float32Array,
  enabled: boolean
): { triangles: number[][]; usedFallback: boolean } {
  const fan = (): number[][] => {
    const out: number[][] = [];
    for (let i = 1; i < ids.length - 1; ++i) out.push([ids[0], ids[i], ids[i + 1]]);
    return out;
  };
  if (ids.length < 3) return { triangles: [], usedFallback: false };
  if (ids.length === 3) return { triangles: [[ids[0], ids[1], ids[2]]], usedFallback: false };
  if (!enabled) return { triangles: fan(), usedFallback: false };

  const { u, v, sign } = projectPolygon(ids, positions);
  const remaining = ids.map((_, index) => index);
  const triangles: number[][] = [];
  const EPS = 1e-12;
  let guard = ids.length * ids.length + 8;

  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < remaining.length; ++k) {
      const n = remaining.length;
      const ia = remaining[(k - 1 + n) % n];
      const ib = remaining[k];
      const ic = remaining[(k + 1) % n];
      const convex = sign * cross2(u[ia], v[ia], u[ib], v[ib], u[ic], v[ic]);
      if (convex <= EPS) continue;

      let containsPoint = false;
      for (const ip of remaining) {
        if (ip === ia || ip === ib || ip === ic) continue;
        const d1 = sign * cross2(u[ia], v[ia], u[ib], v[ib], u[ip], v[ip]);
        const d2 = sign * cross2(u[ib], v[ib], u[ic], v[ic], u[ip], v[ip]);
        const d3 = sign * cross2(u[ic], v[ic], u[ia], v[ia], u[ip], v[ip]);
        if (d1 >= -EPS && d2 >= -EPS && d3 >= -EPS) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;

      triangles.push([ids[ia], ids[ib], ids[ic]]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }

  if (remaining.length !== 3) return { triangles: fan(), usedFallback: true };
  triangles.push([ids[remaining[0]], ids[remaining[1]], ids[remaining[2]]]);
  return { triangles, usedFallback: false };
}

function makeBuffer(stride: 1 | 2 | 3): PrimitiveBuffer {
  return { indices: [], cellIds: [], stride };
}

function emit(buffer: PrimitiveBuffer, ids: number[], cellId: number): void {
  for (const id of ids) buffer.indices.push(id);
  buffer.cellIds.push(cellId);
}

/** Mirrors vtkOpenGLCellArrayBufferObject's primitive ordering and cell ids. */
export function readTopology(
  polyData: vtkPolyData,
  positions: Float32Array,
  representation: RepresentationValue,
  options: ResolvedV23Options
): Topology {
  const surface = makeBuffer(3);
  const lines = makeBuffer(2);
  const points = makeBuffer(1);
  const warnings: string[] = [];
  const pointCount = polyData.getNumberOfPoints();

  const validate = (ids: number[]): number[] => {
    const safe = ids.filter((id) => Number.isInteger(id) && id >= 0 && id < pointCount);
    if (safe.length !== ids.length) {
      warnings.push("A cell referenced an out-of-range point id; those references were dropped.");
    }
    return safe;
  };

  const isPointsRep = representation === Representation.POINTS;
  const isWireframeRep = representation === Representation.WIREFRAME;

  // vtk cell ids are assigned in this exact order: verts, lines, polys, strips.
  let nextCellId = 0;

  nextCellId = forEachCell(polyData.getVerts(), nextCellId, warnings, (raw, cellId) => {
    const ids = validate(raw);
    for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
  });

  nextCellId = forEachCell(polyData.getLines(), nextCellId, warnings, (raw, cellId) => {
    const ids = validate(raw);
    if (isPointsRep) {
      for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
      return;
    }
    for (let i = 0; i + 1 < ids.length; ++i) emit(lines, [ids[i], ids[i + 1]], cellId);
  });

  nextCellId = forEachCell(polyData.getPolys(), nextCellId, warnings, (raw, cellId) => {
    const ids = validate(raw);
    if (isPointsRep) {
      for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
      return;
    }
    if (isWireframeRep) {
      for (let i = 0; i < ids.length && ids.length > 2; ++i) {
        emit(lines, [ids[i], ids[(i + 1) % ids.length]], cellId);
      }
      return;
    }
    const { triangles, usedFallback } = triangulatePolygon(
      ids,
      positions,
      options.triangulateConcavePolygons
    );
    if (usedFallback) {
      warnings.push("A concave/degenerate polygon could not be ear-clipped; used a triangle fan.");
    }
    for (const triangle of triangles) emit(surface, triangle, cellId);
  });

  nextCellId = forEachCell(polyData.getStrips(), nextCellId, warnings, (raw, cellId) => {
    const ids = validate(raw);
    if (isPointsRep) {
      for (const id of ids) points.indices.push(id), points.cellIds.push(cellId);
      return;
    }
    if (isWireframeRep) {
      for (let i = 0; i + 1 < ids.length; ++i) emit(lines, [ids[i], ids[i + 1]], cellId);
      for (let i = 0; i + 2 < ids.length; ++i) emit(lines, [ids[i], ids[i + 2]], cellId);
      return;
    }
    for (let i = 0; i + 2 < ids.length; ++i) {
      emit(
        surface,
        [ids[i], ids[i + 1 + (i % 2)], ids[i + 1 + ((i + 1) % 2)]],
        cellId
      );
    }
  });

  return { surface, lines, points, cellCount: nextCellId, warnings };
}
