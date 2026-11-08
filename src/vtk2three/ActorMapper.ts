import {
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
} from "three";
import type { Object3D } from "three";
import type { vtkActor } from "@kitware/vtk.js/Rendering/Core/Actor.js";
import type { vtkMapper } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import { GeometryMapper } from "./Core/GeometryMapper";
import { MaterialMapper } from "./Core/MaterialMapper";
import { Representation } from "./Core/constants";
import { readImageSlice } from "./Core/ImageDataMapper";
import type { ImageDataLike } from "./Core/ImageDataMapper";
import { buildGlyphObject } from "./Core/GlyphMapper";
import type { Glyph3DMapperLike } from "./Core/GlyphMapper";
import { gridFromDataSet } from "./Core/UnstructuredTopology";
import { emptyStats } from "./types";
import type {
  CapabilityReport,
  ConversionStats,
  ResolvedV23Options,
} from "./types";

export interface ActorBuild {
  root: Group;
  report: CapabilityReport;
  stats: ConversionStats;
}

export const GLOBAL_UNSUPPORTED = [
  "Camera / light synchronization (out of scope by design: data-level equivalence)",
  "vtkActor2D, text and annotation props",
  "Volume shading (multi-light / ambient / specular), gradient opacity and label-map edge projection",
  "Non-linear (quadratic / higher-order / polyhedron) vtk cells",
];

function makeReport(
  warnings: string[],
  unsupported: string[],
  stats: ConversionStats
): CapabilityReport {
  return { warnings, unsupported, stats };
}

function isImageData(input: object): input is ImageDataLike {
  return (
    typeof (input as { getDimensions?: unknown }).getDimensions === "function" &&
    typeof (input as { getVerts?: unknown }).getVerts !== "function" &&
    typeof (input as { getPointData?: unknown }).getPointData === "function"
  );
}

function isGlyphMapper(mapper: object): mapper is Glyph3DMapperLike {
  const candidate = mapper as {
    getMatrixArray?: unknown;
    isA?: (name: string) => boolean;
  };
  return (
    typeof candidate.getMatrixArray === "function" ||
    (typeof candidate.isA === "function" && candidate.isA("vtkGlyph3DMapper"))
  );
}

/** Builds a complete three.js object graph for one vtkActor. */
export function buildActorObject(
  actor: vtkActor,
  options: ResolvedV23Options
): ActorBuild | undefined {
  const mapper = actor.getMapper();
  if (!mapper) {
    return {
      root: emptyRoot(actor),
      report: makeReport(
        ["vtkActor has no mapper; nothing to convert."],
        GLOBAL_UNSUPPORTED,
        emptyStats()
      ),
      stats: emptyStats(),
    };
  }
  const property = actor.getProperty();
  const root = emptyRoot(actor);
  root.visible = actor.getVisibility();
  applyActorMatrix(root, actor);

  const input = mapper.getInputData() as unknown as object | null;
  const stats = emptyStats();
  const warnings: string[] = [];
  const unsupported: string[] = [...GLOBAL_UNSUPPORTED];

  if (!input) {
    warnings.push("Mapper has no input data; nothing to convert.");
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  // ---- P5-B: vtkGlyph3DMapper -> InstancedMesh ----------------------------
  if (isGlyphMapper(mapper as object)) {
    const glyph = buildGlyphObject(
      mapper as unknown as Glyph3DMapperLike,
      property,
      options
    );
    if (!glyph) {
      warnings.push("The vtkGlyph3DMapper could not be converted.");
      return { root, report: makeReport(warnings, unsupported, stats), stats };
    }
    warnings.push(...glyph.warnings);
    unsupported.push(...glyph.unsupported);
    root.add(glyph.object);
    stats.points = glyph.count;
    stats.glyphs = glyph.count;
    stats.primitives = 1;
    stats.textures = glyph.textures.length;
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  // ---- P5-A: vtkImageData -> textured centre slice + bounding box ---------
  if (isImageData(input)) {
    const slice = readImageSlice(input, mapper as vtkMapper, options);
    if (!slice) {
      warnings.push(
        "vtkImageData has no usable scalar array; no slice or bounding box was emitted."
      );
      return { root, report: makeReport(warnings, unsupported, stats), stats };
    }
    warnings.push(...slice.warnings);
    warnings.push(
      "vtkImageData as an actor input is a fallback representation; use convertVolume() / convertRenderer() for volume rendering."
    );
    if (options.imageDataSlice) {
      const mesh = new Mesh(
        slice.geometry,
        new MeshBasicMaterial({
          map: slice.texture,
          side: DoubleSide,
          transparent: true,
        })
      );
      mesh.name = "vtkImageSlice";
      root.add(mesh);
      stats.triangles = 2;
      stats.textures = 1;
    } else {
      warnings.push("imageDataSlice is disabled; only the bounding box was emitted.");
    }
    const outline = new LineSegments(
      slice.outline,
      new LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.6 })
    );
    outline.name = "vtkImageOutline";
    root.add(outline);
    stats.primitives = root.children.length;
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  // ---- P5-A: generic unstructured grid (vtk.js 38 has no vtkUnstructuredGrid) --
  const isPolyData = typeof (input as { getVerts?: unknown }).getVerts === "function";
  if (!isPolyData && !gridFromDataSet(input)) {
    warnings.push(
      "Mapper input is neither vtkPolyData, vtkImageData nor a readable grid; nothing to convert."
    );
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }
  if (!isPolyData) {
    warnings.push(
      "Generic grid input: vtk.js 38 has no vtkUnstructuredGrid class; connectivity came from points/cells/cellTypes arrays."
    );
  }

  const representation = property.getRepresentation();
  const geometrySet = new GeometryMapper(mapper, options).mapPrimitives(representation);
  if (!geometrySet) {
    warnings.push("The vtk data set has no points; nothing to convert.");
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  const materials = new MaterialMapper(property, options).mapMaterialSet({
    hasTCoords: geometrySet.hasTCoords,
    hasAlpha: geometrySet.hasAlpha,
    representation,
  });

  warnings.push(...geometrySet.warnings, ...materials.warnings);
  unsupported.push(...materials.unsupported);

  const children: Object3D[] = [];
  if (representation === Representation.POINTS) {
    const geometry = geometrySet.points ?? geometrySet.surface ?? geometrySet.lines;
    if (geometry) children.push(new Points(geometry, materials.point));
  } else {
    if (geometrySet.surface) {
      children.push(new Mesh(geometrySet.surface, materials.surface));
      if (materials.edge) {
        const overlay = new Mesh(geometrySet.surface, materials.edge);
        overlay.name = "vtkEdges";
        children.push(overlay);
      }
    }
    if (geometrySet.lines) {
      children.push(new LineSegments(geometrySet.lines, materials.line));
    }
    if (geometrySet.points) {
      children.push(new Points(geometrySet.points, materials.point));
    }
  }

  if (children.length === 0) {
    warnings.push("No renderable primitives were produced.");
  }
  children.forEach((child, index) => {
    child.name = child.name || `vtkPrimitive${index}`;
    root.add(child);
  });

  stats.points = geometrySet.pointCount;
  stats.cells = geometrySet.cellCount;
  stats.triangles = geometrySet.counts.triangles;
  stats.lineSegments = geometrySet.counts.lineSegments;
  stats.vertices = geometrySet.counts.vertices;
  stats.primitives = children.length;
  stats.textures = materials.textures.length;

  return { root, report: makeReport(warnings, unsupported, stats), stats };
}

function emptyRoot(actor: vtkActor): Group {
  const root = new Group();
  root.name = "vtkActor";
  root.userData.vtkActor = actor;
  root.userData.vtkProp = actor;
  return root;
}

function applyActorMatrix(root: Group, actor: vtkActor): void {
  const matrix = actor.getMatrix() as ArrayLike<number> | null | undefined;
  if (!matrix || matrix.length !== 16) return;
  // vtk.js stores getMatrix() transposed (row-vector convention); three.js
  // Matrix4 elements are column-major, so undo the transpose first.
  const threeMatrix = new Matrix4().fromArray(Array.from(matrix)).transpose();
  threeMatrix.decompose(root.position, root.quaternion, root.scale);
}

/** Cheap mtime fingerprint used by V23Result.update() and V23SceneResult.sync(). */
export function actorSignature(actor: vtkActor): string {
  const mapper = actor.getMapper();
  const input = mapper?.getInputData() as unknown as
    | { getMTime?: () => number }
    | null
    | undefined;
  const property = actor.getProperty();
  let lookupTableTime = 0;
  if (mapper) {
    const lut = mapper.getLookupTable();
    if (lut) lookupTableTime = lut.getMTime();
  }
  return [
    actor.getMTime(),
    mapper?.getMTime() ?? 0,
    input?.getMTime?.() ?? 0,
    property.getMTime(),
    lookupTableTime,
  ].join(":");
}
