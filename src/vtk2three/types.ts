import type { Group, Object3D } from "three";

/** Options controlling a vtk.js -> three.js conversion. */
export interface V23Options {
  /**
   * Multiplier applied to point coordinates. Defaults to 1 so the generated
   * geometry keeps the exact vtk coordinates (data-level equivalence).
   */
  scale?: number;
  /** Alpha handed to the lookup table while mapping scalars. Defaults to 1. */
  scalarAlpha?: number;
  /** Compute vertex normals when the vtk data set provides none. Defaults to true. */
  computeNormals?: boolean;
  /** Emit 4-component vertex colors when the lookup table supplies alpha. Defaults to true. */
  vertexAlpha?: boolean;
  /** Convert vtkTexture objects attached to vtkProperty into three textures. Defaults to true. */
  mapTextures?: boolean;
  /** Ear-clip concave polygons instead of using a triangle fan. Defaults to true. */
  triangulateConcavePolygons?: boolean;
  /** Ray-marching sample count for vtkVolume conversion. Defaults to 256. */
  volumeSteps?: number;
  /** Longest-axis voxel limit; larger volumes are stride-downsampled. Defaults to 256. */
  maxVolumeSize?: number;
  /** Emit a textured centre slice when a vtkImageData is an actor's mapper input. Defaults to true. */
  imageDataSlice?: boolean;
}

export interface ResolvedV23Options {
  readonly scale: number;
  readonly scalarAlpha: number;
  readonly computeNormals: boolean;
  readonly vertexAlpha: boolean;
  readonly mapTextures: boolean;
  readonly triangulateConcavePolygons: boolean;
  readonly volumeSteps: number;
  readonly maxVolumeSize: number;
  readonly imageDataSlice: boolean;
}

/** Counts of what the converter actually produced, for diagnostics. */
export interface ConversionStats {
  points: number;
  cells: number;
  triangles: number;
  lineSegments: number;
  vertices: number;
  primitives: number;
  textures: number;
  /** Voxels uploaded to a 3D texture (volume rendering). */
  voxels: number;
  /** Instances emitted by a vtkGlyph3DMapper. */
  glyphs: number;
  /** Converted vtkVolume objects. */
  volumes: number;
}

export interface CapabilityReport {
  /** vtk features that are detected but only partially mapped. */
  readonly warnings: string[];
  /** vtk features with no three.js counterpart in this version. */
  readonly unsupported: string[];
  readonly stats: ConversionStats;
}

export interface V23Result {
  /** Group containing Mesh / LineSegments / Points objects. */
  readonly object: Object3D;
  readonly report: CapabilityReport;
  /**
   * Rebuilds geometry and materials in place when vtk pipeline mtimes changed.
   * Returns true when something was rebuilt. Object identity is preserved.
   */
  update(force?: boolean): boolean;
  /** Releases geometry, material and texture GPU resources owned by this conversion. */
  dispose(): void;
}

export interface V23SceneResult {
  readonly object: Group;
  readonly report: CapabilityReport;
  /** Adds, removes and updates actor objects to match the current vtk scene. */
  sync(): boolean;
  dispose(): void;
}

export function emptyStats(): ConversionStats {
  return {
    points: 0,
    cells: 0,
    triangles: 0,
    lineSegments: 0,
    vertices: 0,
    primitives: 0,
    textures: 0,
    voxels: 0,
    glyphs: 0,
    volumes: 0,
  };
}

export function resolveOptions(options: V23Options = {}): ResolvedV23Options {
  return {
    scale: options.scale ?? 1,
    scalarAlpha: options.scalarAlpha ?? 1,
    computeNormals: options.computeNormals ?? true,
    vertexAlpha: options.vertexAlpha ?? true,
    mapTextures: options.mapTextures ?? true,
    triangulateConcavePolygons: options.triangulateConcavePolygons ?? true,
    volumeSteps: Math.max(8, Math.min(2048, Math.round(options.volumeSteps ?? 256))),
    maxVolumeSize: Math.max(2, Math.round(options.maxVolumeSize ?? 256)),
    imageDataSlice: options.imageDataSlice ?? true,
  };
}
