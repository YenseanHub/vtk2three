/**
 * Numeric copies of vtk.js enum values.
 *
 * The library bundle must not import vtk.js at runtime: @kitware/vtk.js 38 is
 * ESM-only, so a `require()` of one of its subpaths would break the CJS entry.
 * vtk.js is a peer dependency used only through the objects callers pass in.
 */

export const ColorMode = {
  DEFAULT: 0,
  MAP_SCALARS: 1,
  DIRECT_SCALARS: 2,
} as const;

export const ScalarMode = {
  DEFAULT: 0,
  USE_POINT_DATA: 1,
  USE_CELL_DATA: 2,
  USE_POINT_FIELD_DATA: 3,
  USE_CELL_FIELD_DATA: 4,
  USE_FIELD_DATA: 5,
} as const;

export const GetArray = {
  BY_ID: 0,
  BY_NAME: 1,
} as const;

export const Representation = {
  POINTS: 0,
  WIREFRAME: 1,
  SURFACE: 2,
} as const;

/** vtkProperty.Interpolation / Shading share the same numeric values. */
export const Interpolation = {
  FLAT: 0,
  GOURAUD: 1,
  PHONG: 2,
  PBR: 3,
} as const;

/** Common/DataModel/CellTypes/Constants.js (linear cells used by P5). */
export const CellType = {
  VTK_EMPTY_CELL: 0,
  VTK_VERTEX: 1,
  VTK_POLY_VERTEX: 2,
  VTK_LINE: 3,
  VTK_POLY_LINE: 4,
  VTK_TRIANGLE: 5,
  VTK_TRIANGLE_STRIP: 6,
  VTK_POLYGON: 7,
  VTK_PIXEL: 8,
  VTK_QUAD: 9,
  VTK_TETRA: 10,
  VTK_VOXEL: 11,
  VTK_HEXAHEDRON: 12,
  VTK_WEDGE: 13,
  VTK_PYRAMID: 14,
  VTK_PENTAGONAL_PRISM: 15,
  VTK_HEXAGONAL_PRISM: 16,
} as const;

/** Rendering/Core/Glyph3DMapper/Constants.js */
export const ScaleMode = {
  SCALE_BY_CONSTANT: 0,
  SCALE_BY_MAGNITUDE: 1,
  SCALE_BY_COMPONENTS: 2,
} as const;

/** Rendering/Core/Glyph3DMapper/Constants.js */
export const OrientationMode = {
  DIRECTION: 0,
  ROTATION: 1,
  MATRIX: 2,
} as const;

/** Rendering/Core/VolumeMapper/Constants.js */
export const BlendMode = {
  COMPOSITE_BLEND: 0,
  MAXIMUM_INTENSITY_BLEND: 1,
  MINIMUM_INTENSITY_BLEND: 2,
  AVERAGE_INTENSITY_BLEND: 3,
  ADDITIVE_INTENSITY_BLEND: 4,
  RADON_TRANSFORM_BLEND: 5,
  LABELMAP_EDGE_PROJECTION_BLEND: 6,
} as const;

/** Rendering/Core/VolumeProperty/Constants.js */
export const VolumeInterpolation = {
  NEAREST: 0,
  LINEAR: 1,
  FAST_LINEAR: 2,
} as const;

export type RepresentationValue =
  (typeof Representation)[keyof typeof Representation];
