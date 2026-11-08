import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  LinearFilter,
  Matrix4,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import type { Texture } from "three";
import type { vtkImageData } from "@kitware/vtk.js/Common/DataModel/ImageData.js";
import type { vtkMapper } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import { ColorMode } from "./constants";
import type { ResolvedV23Options } from "../types";

/** Minimal structural view of vtkImageData, kept duck-typed for portability. */
export interface ImageDataLike {
  getDimensions(): [number, number, number];
  getSpacing(): [number, number, number];
  getOrigin(): [number, number, number];
  getIndexToWorld(): ArrayLike<number>;
  computeTransforms?(): void;
  indexToWorld?(ijk: Readonly<[number, number, number]>, out?: number[]): number[];
  getPointData(): {
    getScalars(): {
      getData(): ArrayLike<number>;
      getNumberOfComponents(): number;
      getNumberOfTuples(): number;
      getRange(): [number, number];
    } | null;
  } | null;
}

export interface ImageVolume {
  /** Single-channel normalised voxel data, x fastest, then y, then z. */
  texture: Data3DTexture;
  /** Uploaded (possibly downsampled) texture resolution. */
  dimensions: [number, number, number];
  /** Original vtk dimensions; the geometry box must use these, not the texture size. */
  sourceDimensions: [number, number, number];
  /** column-major index -> world transform (gl-matrix / three compatible). */
  indexToWorld: Matrix4;
  scalarRange: [number, number];
  /** Number of voxels actually uploaded after optional downsampling. */
  voxelCount: number;
  warnings: string[];
}

function markOwned(texture: Texture): void {
  texture.userData.v23Owned = true;
}

/** Extracts the scalar array of a vtkImageData, warning on multi-component data. */
function scalarSource(image: ImageDataLike): {
  data: ArrayLike<number>;
  components: number;
  dims: [number, number, number];
  range: [number, number];
  warnings: string[];
} | undefined {
  const dims = image.getDimensions();
  if (dims.some((value) => !Number.isFinite(value) || value <= 0)) return undefined;
  const scalars = image.getPointData()?.getScalars();
  if (!scalars) return undefined;

  const warnings: string[] = [];
  const components = scalars.getNumberOfComponents();
  if (components !== 1) {
    warnings.push(
      `ImageData scalars have ${components} components; only component 0 was uploaded.`
    );
  }
  const expected = dims[0] * dims[1] * dims[2] * components;
  const data = scalars.getData();
  if (data.length < expected) {
    warnings.push(
      `ImageData scalars have ${data.length} values but ${expected} were expected; volume was skipped.`
    );
    return undefined;
  }
  let range = scalars.getRange();
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[1] <= range[0]) {
    range = [0, 1];
    warnings.push("ImageData scalar range is degenerate; used [0, 1].");
  }
  return { data, components, dims, range, warnings };
}

/**
 * Uploads image scalars into a three.js Data3DTexture for ray marching.
 * Volumes whose longest axis exceeds `maxVolumeSize` are stride-downsampled.
 */
export function readImageVolume(
  image: ImageDataLike,
  options: ResolvedV23Options
): ImageVolume | undefined {
  const source = scalarSource(image);
  if (!source) return undefined;

  image.computeTransforms?.();
  const { data, components, dims, range } = source;
  const warnings = [...source.warnings];
  const longest = Math.max(dims[0], dims[1], dims[2]);
  const stride = Math.max(1, Math.ceil(longest / options.maxVolumeSize));
  const outDims: [number, number, number] = [
    Math.max(1, Math.ceil(dims[0] / stride)),
    Math.max(1, Math.ceil(dims[1] / stride)),
    Math.max(1, Math.ceil(dims[2] / stride)),
  ];
  if (stride > 1) {
    warnings.push(
      `Volume ${dims.join("x")} exceeded maxVolumeSize ${options.maxVolumeSize}; downsampled by ${stride} to ${outDims.join("x")}.`
    );
  }

  const voxels = new Uint8Array(outDims[0] * outDims[1] * outDims[2]);
  const [min, max] = range;
  const inverse = 255 / (max - min);
  for (let z = 0; z < outDims[2]; ++z) {
    for (let y = 0; y < outDims[1]; ++y) {
      for (let x = 0; x < outDims[0]; ++x) {
        const sx = Math.min(dims[0] - 1, x * stride);
        const sy = Math.min(dims[1] - 1, y * stride);
        const sz = Math.min(dims[2] - 1, z * stride);
        const srcIndex = components * (sx + dims[0] * (sy + dims[1] * sz));
        const value = Number(data[srcIndex]);
        const normalised = (value - min) * inverse;
        voxels[x + outDims[0] * (y + outDims[1] * z)] = Math.max(
          0,
          Math.min(255, Math.round(normalised))
        );
      }
    }
  }

  const texture = new Data3DTexture(voxels, outDims[0], outDims[1], outDims[2]);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.wrapR = ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  markOwned(texture);

  const indexToWorld = new Matrix4().fromArray(
    Array.from(image.getIndexToWorld() as ArrayLike<number>)
  );

  return {
    texture,
    dimensions: outDims,
    sourceDimensions: [dims[0], dims[1], dims[2]],
    indexToWorld,
    scalarRange: range,
    voxelCount: voxels.length,
    warnings,
  };
}

export interface ImageSlice {
  geometry: BufferGeometry;
  texture: DataTexture;
  outline: BufferGeometry;
  warnings: string[];
}

function corner(
  image: ImageDataLike,
  ijk: [number, number, number]
): [number, number, number] {
  // vtkImageData.computeTransforms() builds a column-major mat4; use it when
  // available so direction / spacing / origin are all honoured.
  const m = Array.from(image.getIndexToWorld() as ArrayLike<number>);
  const [i, j, k] = ijk;
  const out: [number, number, number] = [
    m[0] * i + m[4] * j + m[8] * k + m[12],
    m[1] * i + m[5] * j + m[9] * k + m[13],
    m[2] * i + m[6] * j + m[10] * k + m[14],
  ];
  if (image.indexToWorld) {
    const computed = image.indexToWorld(ijk);
    if (computed && computed.length >= 3) return [computed[0], computed[1], computed[2]];
  }
  return out;
}

/**
 * Fallback representation for a vtkImageData used as a regular actor's mapper
 * input: a textured centre slice (shortest axis normal) plus a bounding box.
 * vtk.js normally renders ImageData through vtkImageSlice / vtkVolume; this
 * keeps data-level equivalence without a second renderer.
 */
export function readImageSlice(
  image: ImageDataLike,
  mapper: vtkMapper | null | undefined,
  options: ResolvedV23Options
): ImageSlice | undefined {
  const source = scalarSource(image);
  if (!source) return undefined;
  image.computeTransforms?.();
  const { data, components, dims, range } = source;
  const warnings = [...source.warnings];

  const axis = dims[0] <= dims[1] && dims[0] <= dims[2] ? 0 : dims[1] <= dims[2] ? 1 : 2;
  const uAxis = axis === 0 ? 1 : 0;
  const vAxis = axis === 2 ? 1 : 2;
  const sizeU = dims[uAxis];
  const sizeV = dims[vAxis];
  const slice = Math.floor(dims[axis] / 2);
  warnings.push(
    `vtkImageData mapped as an actor: emitted the centre ${["I", "J", "K"][axis]} slice (${slice}) as a textured quad.`
  );

  // Ask the vtk LUT to color the whole volume, then extract one slice.
  let mapped: ArrayLike<number> | undefined;
  let mappedComponents = 4;
  const lut = mapper?.getLookupTable?.();
  const scalars = image.getPointData()?.getScalars();
  if (lut && scalars) {
    try {
      const result = lut.mapScalars(
        scalars as Parameters<typeof lut.mapScalars>[0],
        mapper?.getColorMode?.() ?? ColorMode.MAP_SCALARS,
        0
      );
      if (result) {
        mapped = result.getData();
        mappedComponents = result.getNumberOfComponents();
      }
    } catch {
      mapped = undefined;
    }
  }
  if (!mapped) {
    warnings.push("No usable lookup table colors for the ImageData slice; used grayscale.");
  }

  const pixels = new Uint8Array(4 * sizeU * sizeV);
  const [min, max] = range;
  const inverse = 255 / (max - min);
  for (let v = 0; v < sizeV; ++v) {
    for (let u = 0; u < sizeU; ++u) {
      const ijk: [number, number, number] = [0, 0, 0];
      ijk[axis] = slice;
      ijk[uAxis] = u;
      ijk[vAxis] = v;
      const voxel = ijk[0] + dims[0] * (ijk[1] + dims[1] * ijk[2]);
      const dst = 4 * (u + sizeU * v);
      if (mapped && mappedComponents >= 3) {
        const src = mappedComponents * voxel;
        pixels[dst] = Number(mapped[src]);
        pixels[dst + 1] = Number(mapped[src + 1]);
        pixels[dst + 2] = Number(mapped[src + 2]);
        pixels[dst + 3] = mappedComponents >= 4 ? Number(mapped[src + 3]) : 255;
      } else {
        const grey = Math.max(0, Math.min(255, Math.round((Number(data[components * voxel]) - min) * inverse)));
        pixels[dst] = grey;
        pixels[dst + 1] = grey;
        pixels[dst + 2] = grey;
        pixels[dst + 3] = 255;
      }
    }
  }

  const texture = new DataTexture(pixels, sizeU, sizeV, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  markOwned(texture);

  const ijkAt = (u: number, v: number): [number, number, number] => {
    const ijk: [number, number, number] = [0, 0, 0];
    ijk[axis] = slice;
    ijk[uAxis] = u;
    ijk[vAxis] = v;
    return ijk;
  };
  const c0 = corner(image, ijkAt(0, 0));
  const c1 = corner(image, ijkAt(sizeU, 0));
  const c2 = corner(image, ijkAt(sizeU, sizeV));
  const c3 = corner(image, ijkAt(0, sizeV));
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([...c0, ...c1, ...c2, ...c3]), 3)
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Bounding box in world space, accounting for direction / spacing / origin.
  const corners: Array<[number, number, number]> = [];
  for (const k of [0, dims[2]]) {
    for (const j of [0, dims[1]]) {
      for (const i of [0, dims[0]]) corners.push(corner(image, [i, j, k]));
    }
  }
  const edges = [
    0, 1, 1, 3, 3, 2, 2, 0,
    4, 5, 5, 7, 7, 6, 6, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const outlinePositions = new Float32Array(3 * edges.length);
  edges.forEach((index, output) => {
    outlinePositions.set(corners[index], 3 * output);
  });
  const outline = new BufferGeometry();
  outline.setAttribute("position", new BufferAttribute(outlinePositions, 3));
  outline.computeBoundingSphere();

  if (options.scale !== 1) {
    for (const target of [geometry, outline]) {
      const attribute = target.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < attribute.count; ++i) {
        attribute.setXYZ(
          i,
          attribute.getX(i) * options.scale,
          attribute.getY(i) * options.scale,
          attribute.getZ(i) * options.scale
        );
      }
      attribute.needsUpdate = true;
      target.computeBoundingBox();
      target.computeBoundingSphere();
    }
  }

  return { geometry, texture, outline, warnings };
}

/** Sets nearest filtering on a volume texture (vtkVolumeProperty.NEAREST). */
export function setVolumeNearestFilter(texture: Data3DTexture): void {
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
}
