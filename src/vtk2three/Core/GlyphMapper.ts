import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import type { BufferGeometry, Material, Texture } from "three";
import type { vtkProperty } from "@kitware/vtk.js/Rendering/Core/Property.js";
import { OrientationMode, Representation, ScaleMode } from "./constants";
import { buildGeometrySet, readGeometrySource } from "./GeometryMapper";
import { MaterialMapper } from "./MaterialMapper";
import { sRGBToLinear } from "./ScalarColorMapper";
import type { ResolvedV23Options } from "../types";

interface ArrayLikeVtk {
  getData(): ArrayLike<number>;
  getNumberOfComponents(): number;
  getNumberOfTuples(): number;
}

/** Structural view of vtkGlyph3DMapper (P5). */
export interface Glyph3DMapperLike {
  buildArrays?(): void;
  getMatrixArray?(): Float32Array | null;
  getColorArray?(): ArrayLikeVtk | null;
  getInputData?<T>(port?: number): T;
  getScaleArrayData?(): ArrayLikeVtk | null;
  getOrientationArrayData?(): ArrayLikeVtk | null;
  getScaleMode?(): number;
  getScaleFactor?(): number;
  getScaling?(): boolean;
  getOrientationMode?(): number;
  getOrient?(): boolean;
}

export interface GlyphBuild {
  object: InstancedMesh;
  count: number;
  textures: Texture[];
  warnings: string[];
  unsupported: string[];
}

function tupleAt(array: ArrayLikeVtk, index: number): number[] {
  const components = array.getNumberOfComponents();
  const data = array.getData();
  const out: number[] = [];
  for (let c = 0; c < components; ++c) {
    out.push(Number(data[components * index + c]) || 0);
  }
  return out;
}

/**
 * Reproduces vtkGlyph3DMapper.buildArrays() when it is unavailable (e.g. a
 * duck-typed mapper or an input without getPoints()). Matrices are written in
 * column-major order, matching three.js InstancedMesh.instanceMatrix.
 */
function fallbackMatrices(
  mapper: Glyph3DMapperLike,
  input: unknown
): { matrices: Float32Array; count: number; warnings: string[] } | undefined {
  const source = input as { getPoints?: () => { getData(): ArrayLike<number> } } | null;
  const points = source?.getPoints?.()?.getData();
  if (!points) return undefined;
  const count = Math.floor(points.length / 3);
  if (count === 0) return undefined;

  const warnings = [
    "vtkGlyph3DMapper.buildArrays() was unavailable; glyph transforms were recomputed from the input arrays.",
  ];
  const scaleArray = mapper.getScaleArrayData?.() ?? null;
  const orientationArray = mapper.getOrientationArrayData?.() ?? null;
  const scaleMode = mapper.getScaleMode?.() ?? ScaleMode.SCALE_BY_MAGNITUDE;
  const scaleFactor = mapper.getScaleFactor?.() ?? 1;
  const scaling = mapper.getScaling?.() ?? true;
  const orientationMode = mapper.getOrientationMode?.() ?? OrientationMode.DIRECTION;
  const orient = mapper.getOrient?.() ?? true;

  const matrices = new Float32Array(16 * count);
  const translation = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3();
  const matrix = new Matrix4();
  const scratch = new Matrix4();

  for (let i = 0; i < count; ++i) {
    translation.set(Number(points[3 * i]), Number(points[3 * i + 1]), Number(points[3 * i + 2]));
    rotation.identity();

    if (orient && orientationArray && i < orientationArray.getNumberOfTuples()) {
      const o = tupleAt(orientationArray, i);
      if (orientationMode === OrientationMode.MATRIX && o.length >= 9) {
        const m = new Matrix4().set(
          o[0], o[3], o[6], 0,
          o[1], o[4], o[7], 0,
          o[2], o[5], o[8], 0,
          0, 0, 0, 1
        );
        rotation.setFromRotationMatrix(m);
      } else if (orientationMode === OrientationMode.ROTATION) {
        // vtk.js passes these straight to gl-matrix (radians), so keep radians.
        scratch.makeRotationZ(o[2] ?? 0);
        matrix.copy(scratch);
        scratch.makeRotationX(o[0] ?? 0);
        matrix.multiply(scratch);
        scratch.makeRotationY(o[1] ?? 0);
        matrix.multiply(scratch);
        rotation.setFromRotationMatrix(matrix);
      } else {
        const [ox, oy, oz] = o;
        const mag = Math.hypot(ox, oy, oz);
        if (mag > 0) {
          if (oy === 0 && oz === 0) {
            if (ox < 0) rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
          } else {
            axis.set((ox + mag) / 2, oy / 2, oz / 2).normalize();
            rotation.setFromAxisAngle(axis, Math.PI);
          }
        }
      }
    }

    scale.setScalar(scaleFactor);
    if (scaling && scaleArray && i < scaleArray.getNumberOfTuples()) {
      const tuple = tupleAt(scaleArray, i);
      if (scaleMode === ScaleMode.SCALE_BY_MAGNITUDE) {
        const magnitude = Math.hypot(...tuple);
        scale.setScalar(scaleFactor * magnitude);
      } else if (scaleMode === ScaleMode.SCALE_BY_COMPONENTS) {
        if (tuple.length !== 3) {
          warnings.push("SCALE_BY_COMPONENTS needs a 3-component scale array; ignored.");
        } else {
          scale.set(scaleFactor * tuple[0], scaleFactor * tuple[1], scaleFactor * tuple[2]);
        }
      }
    }
    scale.set(
      scale.x === 0 ? 1e-10 : scale.x,
      scale.y === 0 ? 1e-10 : scale.y,
      scale.z === 0 ? 1e-10 : scale.z
    );

    matrix.compose(translation, rotation, scale);
    for (let e = 0; e < 16; ++e) matrices[16 * i + e] = matrix.elements[e];
  }

  return { matrices, count, warnings };
}

/** Converts a vtkGlyph3DMapper into one InstancedMesh sharing the glyph geometry. */
export function buildGlyphObject(
  mapper: Glyph3DMapperLike,
  property: vtkProperty,
  options: ResolvedV23Options
): GlyphBuild | undefined {
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const source = mapper.getInputData?.<unknown>(1);
  const input = mapper.getInputData?.<unknown>(0);
  if (!source || !input) {
    warnings.push("vtkGlyph3DMapper is missing its input data or glyph source (port 1).");
    return undefined;
  }

  const geometrySource = readGeometrySource(
    source,
    null,
    Representation.SURFACE,
    options
  );
  const set = geometrySource
    ? buildGeometrySet(geometrySource, options, Representation.SURFACE)
    : undefined;
  const geometry: BufferGeometry | undefined = set?.surface ?? set?.lines ?? set?.points;
  if (!geometry) {
    warnings.push("The glyph source produced no renderable geometry.");
    return undefined;
  }
  warnings.push(...(set?.warnings ?? []));
  // Per-instance colors come from getColorArray(); keep the glyph geometry pure.
  geometry.deleteAttribute("color");

  if (typeof mapper.buildArrays === "function") {
    try {
      mapper.buildArrays();
    } catch {
      warnings.push("vtkGlyph3DMapper.buildArrays() threw; used the fallback transform path.");
    }
  } else {
    warnings.push(
      "vtkGlyph3DMapper.buildArrays() was unavailable; used the fallback transform path."
    );
  }

  let matrices = mapper.getMatrixArray?.() ?? null;
  let count = matrices ? Math.floor(matrices.length / 16) : 0;
  if (!matrices || count === 0) {
    const fallback = fallbackMatrices(mapper, input);
    if (!fallback) {
      warnings.push("No glyph instance transforms could be produced.");
      return undefined;
    }
    matrices = fallback.matrices;
    count = fallback.count;
    warnings.push(...fallback.warnings);
  }
  if (count > 200000) {
    warnings.push(`${count} glyph instances may be too many for one InstancedMesh draw call.`);
  }

  const materials = new MaterialMapper(property, options).mapMaterialSet({
    hasTCoords: false,
    hasAlpha: false,
    representation: Representation.SURFACE,
  });
  const surface = materials.surface as Material & { vertexColors: boolean };
  surface.vertexColors = false;
  surface.needsUpdate = true;
  warnings.push(...materials.warnings);
  unsupported.push(...materials.unsupported);

  const instanced = new InstancedMesh(geometry, surface, count);
  instanced.name = "vtkGlyphs";
  (instanced.instanceMatrix.array as Float32Array).set(
    matrices.subarray(0, 16 * count)
  );
  instanced.instanceMatrix.needsUpdate = true;

  const colorArray = mapper.getColorArray?.();
  if (colorArray) {
    const data = colorArray.getData();
    const components = colorArray.getNumberOfComponents();
    const colors = new Float32Array(3 * count);
    for (let i = 0; i < count; ++i) {
      const src = components * Math.min(i, Math.max(0, colorArray.getNumberOfTuples() - 1));
      colors[3 * i] = sRGBToLinear(Number(data[src]) / 255);
      colors[3 * i + 1] = sRGBToLinear(Number(data[src + 1]) / 255);
      colors[3 * i + 2] = sRGBToLinear(Number(data[src + 2]) / 255);
    }
    instanced.instanceColor = new InstancedBufferAttribute(colors, 3);
    instanced.instanceColor.needsUpdate = true;
  } else {
    warnings.push("vtkGlyph3DMapper produced no per-instance colors; used the actor color.");
  }

  instanced.computeBoundingSphere();
  return { object: instanced, count, textures: materials.textures, warnings, unsupported };
}
