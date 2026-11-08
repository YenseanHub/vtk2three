import { BufferAttribute, BufferGeometry } from "three";
import type { vtkMapper } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import type { vtkDataArray } from "@kitware/vtk.js/Common/Core/DataArray.js";
import { readTopology } from "./CellArrayReader";
import type { PrimitiveBuffer, Topology } from "./CellArrayReader";
import { Representation } from "./constants";
import type { RepresentationValue } from "./constants";
import { resolveScalarColors } from "./ScalarColorMapper";
import type { ScalarColors } from "./ScalarColorMapper";
import { gridFromDataSet, readGridTopology } from "./UnstructuredTopology";
import { resolveOptions } from "../types";
import type { ResolvedV23Options } from "../types";

export interface GeometrySet {
  surface?: BufferGeometry;
  lines?: BufferGeometry;
  points?: BufferGeometry;
  hasTCoords: boolean;
  hasVertexColors: boolean;
  colorComponents: 3 | 4;
  hasAlpha: boolean;
  pointCount: number;
  cellCount: number;
  counts: {
    triangles: number;
    lineSegments: number;
    vertices: number;
  };
  warnings: string[];
}

/** Normal / texture-coordinate source, duck-typed so grids work too. */
export interface PointDataLike {
  getNormals?: () => vtkDataArray | null;
  getTCoords?: () => vtkDataArray | null;
}

export interface GeometrySource {
  positions: Float32Array;
  pointCount: number;
  topology: Topology;
  pointData?: PointDataLike | null;
  mapper: vtkMapper | null;
  /** The vtk data object, forwarded to scalar-array selection. */
  dataSet: unknown;
}

function buildGeometry(
  buffer: PrimitiveBuffer,
  positions: Float32Array,
  normals: Float32Array | null,
  uv: Float32Array | null,
  colors: ScalarColors,
  pointCount: number,
  options: ResolvedV23Options,
  isSurface: boolean
): BufferGeometry | undefined {
  const vertexCount = buffer.indices.length;
  if (vertexCount === 0) return undefined;

  const geometry = new BufferGeometry();
  const { components } = colors;

  if (colors.association === "cell") {
    // Cell colors require vertex splitting: one vtk point can belong to cells
    // with different colors, so an indexed geometry cannot represent them.
    const expandedPositions = new Float32Array(3 * vertexCount);
    const expandedColors = new Float32Array(components * vertexCount);
    const expandedNormals = normals ? new Float32Array(3 * vertexCount) : null;
    const expandedUv = uv ? new Float32Array(2 * vertexCount) : null;

    for (let index = 0; index < vertexCount; ++index) {
      const pointId = buffer.indices[index];
      const cellId = buffer.cellIds[Math.floor(index / buffer.stride)] ?? 0;
      const colorOffset = components * cellId;
      expandedPositions.set(positions.subarray(3 * pointId, 3 * pointId + 3), 3 * index);
      for (let c = 0; c < components; ++c) {
        expandedColors[components * index + c] = colors.data[colorOffset + c] ?? 1;
      }
      if (expandedNormals && normals) {
        expandedNormals.set(normals.subarray(3 * pointId, 3 * pointId + 3), 3 * index);
      }
      if (expandedUv && uv) {
        expandedUv.set(uv.subarray(2 * pointId, 2 * pointId + 2), 2 * index);
      }
    }

    geometry.setAttribute("position", new BufferAttribute(expandedPositions, 3));
    geometry.setAttribute("color", new BufferAttribute(expandedColors, components));
    if (expandedNormals) geometry.setAttribute("normal", new BufferAttribute(expandedNormals, 3));
    if (expandedUv) geometry.setAttribute("uv", new BufferAttribute(expandedUv, 2));
  } else {
    const IndexArray = pointCount > 65535 ? Uint32Array : Uint16Array;
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(IndexArray.from(buffer.indices), 1));
    geometry.setAttribute("color", new BufferAttribute(colors.data, components));
    if (normals) geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    if (uv) geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  }

  if (!geometry.getAttribute("normal") && isSurface && options.computeNormals) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function pointAttribute(
  array: vtkDataArray | null | undefined,
  pointCount: number,
  components: number
): Float32Array | null {
  if (!array || array.getNumberOfTuples() < pointCount) return null;
  if (array.getNumberOfComponents() < components) return null;
  const src = array.getData();
  const stride = array.getNumberOfComponents();
  const out = new Float32Array(components * pointCount);
  for (let index = 0; index < pointCount; ++index) {
    for (let c = 0; c < components; ++c) {
      out[components * index + c] = Number(src[stride * index + c]);
    }
  }
  return out;
}

/**
 * Assembles three.js geometries from an already-read topology. Shared by the
 * PolyData path, the generic grid path and the glyph-source path.
 */
export function buildGeometrySet(
  source: GeometrySource,
  options: ResolvedV23Options,
  representation: RepresentationValue
): GeometrySet | undefined {
  const { positions, pointCount, topology } = source;
  if (pointCount === 0) return undefined;

  const colors = resolveScalarColors(
    source.mapper,
    source.dataSet as vtkPolyData,
    pointCount,
    topology.cellCount,
    options
  );

  const normals = pointAttribute(source.pointData?.getNormals?.(), pointCount, 3);
  const uv = pointAttribute(source.pointData?.getTCoords?.(), pointCount, 2);

  const warnings = [...topology.warnings, ...colors.warnings];
  if (
    topology.surface.indices.length === 0 &&
    topology.lines.indices.length === 0 &&
    topology.points.indices.length === 0 &&
    colors.association !== "cell"
  ) {
    for (let index = 0; index < pointCount; ++index) {
      topology.points.indices.push(index);
      topology.points.cellIds.push(0);
    }
    warnings.push("No cells found; emitted all vtk points as a point cloud.");
  }

  const surface = buildGeometry(
    topology.surface, positions, normals, uv, colors, pointCount, options, true
  );
  const lines = buildGeometry(
    topology.lines, positions, normals, uv, colors, pointCount, options, false
  );
  const points = buildGeometry(
    topology.points, positions, normals, uv, colors, pointCount, options, false
  );

  void representation;
  return {
    surface,
    lines,
    points,
    hasTCoords: uv !== null,
    hasVertexColors: true,
    colorComponents: colors.components,
    hasAlpha: colors.hasAlpha,
    pointCount,
    cellCount: topology.cellCount,
    counts: {
      triangles: topology.surface.cellIds.length,
      lineSegments: topology.lines.cellIds.length,
      vertices: topology.points.indices.length,
    },
    warnings,
  };
}

/** Reads points + topology from a PolyData or a generic unstructured grid. */
export function readGeometrySource(
  dataSet: unknown,
  mapper: vtkMapper | null,
  representation: RepresentationValue,
  options: ResolvedV23Options
): GeometrySource | undefined {
  if (!dataSet || typeof dataSet !== "object") return undefined;
  const input = dataSet as Record<string, unknown>;
  const call = <T>(name: string): T | undefined => {
    const member = input[name];
    return typeof member === "function" ? (member as () => T).call(input) : undefined;
  };

  const isPolyData = typeof input.getVerts === "function";
  let rawPoints: ArrayLike<number> | undefined;
  let pointCount = 0;
  let topology: Topology | undefined;
  let pointData: PointDataLike | null = null;

  if (isPolyData) {
    const polyData = dataSet as vtkPolyData;
    pointCount = polyData.getNumberOfPoints();
    if (pointCount === 0) return undefined;
    rawPoints = polyData.getPoints().getData();
    pointData = polyData.getPointData() as unknown as PointDataLike;
    // positions are needed for ear clipping, so read topology after scaling.
    const positions = new Float32Array(rawPoints);
    if (options.scale !== 1) {
      for (let index = 0; index < positions.length; ++index) positions[index] *= options.scale;
    }
    topology = readTopology(polyData, positions, representation, options);
    return { positions, pointCount, topology, pointData, mapper, dataSet };
  }

  const grid = gridFromDataSet(dataSet);
  if (!grid) return undefined;
  pointCount = Math.floor(grid.points.length / 3);
  if (pointCount === 0) return undefined;
  const positions = new Float32Array(grid.points.length);
  for (let index = 0; index < positions.length; ++index) {
    positions[index] = options.scale === 1 ? Number(grid.points[index]) : Number(grid.points[index]) * options.scale;
  }
  topology = readGridTopology(grid, positions, representation, options);
  pointData = call<PointDataLike>("getPointData") ?? null;
  return { positions, pointCount, topology, pointData, mapper, dataSet };
}

export class GeometryMapper {
  private readonly vtkMapper: vtkMapper;
  private readonly options: ResolvedV23Options;

  constructor(vtkMapper: vtkMapper, options: ResolvedV23Options = resolveOptions()) {
    this.vtkMapper = vtkMapper;
    this.options = options;
  }

  /**
   * Legacy single-geometry entry point. Uses SURFACE representation and
   * returns the first non-empty primitive (normally the triangulated surface).
   */
  mapGeometry(): BufferGeometry | undefined {
    const set = this.mapPrimitives(Representation.SURFACE);
    return set?.surface ?? set?.lines ?? set?.points;
  }

  /** Full conversion: PolyData or generic grid, all primitives, scalar colors. */
  mapPrimitives(
    representation: RepresentationValue = Representation.SURFACE
  ): GeometrySet | undefined {
    const source = readGeometrySource(
      this.vtkMapper.getInputData(),
      this.vtkMapper,
      representation,
      this.options
    );
    if (!source) return undefined;
    return buildGeometrySet(source, this.options, representation);
  }
}
