import { Group, Matrix4 } from "three";
import type { vtkVolume } from "@kitware/vtk.js/Rendering/Core/Volume.js";
import { GLOBAL_UNSUPPORTED } from "./ActorMapper";
import type { ActorBuild } from "./ActorMapper";
import { BlendMode } from "./Core/constants";
import { readImageVolume } from "./Core/ImageDataMapper";
import type { ImageDataLike } from "./Core/ImageDataMapper";
import { buildVolumeMesh } from "./Core/VolumeRayMarcher";
import type { VolumePropertyLike } from "./Core/VolumeRayMarcher";
import { createV23Result } from "./v23Mapper";
import { emptyStats, resolveOptions } from "./types";
import type {
  CapabilityReport,
  ConversionStats,
  ResolvedV23Options,
  V23Options,
  V23Result,
} from "./types";

interface VolumeMapperLike {
  getInputData<T = unknown>(port?: number): T;
  getMTime(): number;
  getBlendMode?(): number;
  getSampleDistance?(): number;
}

interface VolumeLike {
  getMapper(): VolumeMapperLike | null;
  getProperty(): VolumePropertyLike;
  getVisibility(): boolean;
  getMatrix(): ArrayLike<number> | null;
  getMTime(): number;
}

function makeReport(
  warnings: string[],
  unsupported: string[],
  stats: ConversionStats
): CapabilityReport {
  return { warnings, unsupported, stats };
}

/** mtime fingerprint including the transfer functions (P5 incremental updates). */
export function volumeSignature(volume: VolumeLike): string {
  const mapper = volume.getMapper();
  const input = mapper?.getInputData() as unknown as
    | { getMTime?: () => number }
    | null
    | undefined;
  const property = volume.getProperty();
  const ctf = property.getRGBTransferFunction(0) as unknown as
    | { getMTime?: () => number }
    | null;
  const pwf = property.getScalarOpacity(0) as unknown as
    | { getMTime?: () => number }
    | null;
  return [
    volume.getMTime(),
    mapper?.getMTime() ?? 0,
    input?.getMTime?.() ?? 0,
    (property as unknown as { getMTime?: () => number }).getMTime?.() ?? 0,
    ctf?.getMTime?.() ?? 0,
    pwf?.getMTime?.() ?? 0,
  ].join(":");
}

/** Builds the three.js object graph for one vtkVolume. */
export function buildVolumeObject(
  volume: VolumeLike,
  options: ResolvedV23Options
): ActorBuild | undefined {
  const root = new Group();
  root.name = "vtkVolumeRoot";
  root.userData.vtkVolume = volume;
  root.userData.vtkProp = volume;
  root.visible = volume.getVisibility();

  const matrix = volume.getMatrix();
  if (matrix && matrix.length === 16) {
    const threeMatrix = new Matrix4().fromArray(Array.from(matrix)).transpose();
    threeMatrix.decompose(root.position, root.quaternion, root.scale);
  }

  const stats = emptyStats();
  const unsupported: string[] = [...GLOBAL_UNSUPPORTED];
  const warnings: string[] = [];

  const mapper = volume.getMapper();
  if (!mapper) {
    warnings.push("vtkVolume has no mapper; nothing to convert.");
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  const image = mapper.getInputData<ImageDataLike | null>();
  if (!image || typeof image.getDimensions !== "function") {
    warnings.push("vtkVolumeMapper input is not vtkImageData; volume was skipped.");
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  const volumeData = readImageVolume(image, options);
  if (!volumeData) {
    warnings.push(
      "vtkImageData has no usable scalar array; no 3D texture was uploaded."
    );
    return { root, report: makeReport(warnings, unsupported, stats), stats };
  }

  const built = buildVolumeMesh(volumeData, volume.getProperty(), {
    steps: options.volumeSteps,
    blendMode: mapper.getBlendMode?.() ?? BlendMode.COMPOSITE_BLEND,
    sampleDistance: mapper.getSampleDistance?.() ?? 1,
  });

  warnings.push(...built.warnings);
  unsupported.push(...built.unsupported);
  root.add(built.mesh);

  stats.voxels = volumeData.voxelCount;
  stats.volumes = 1;
  stats.primitives = 1;
  // Data3DTexture + transfer-function LUT.
  stats.textures = 2;

  return { root, report: makeReport(warnings, unsupported, stats), stats };
}

/** Converts one vtkVolume into a synchronisable, ray-marched three.js object. */
export function convertVolume(
  volume: vtkVolume,
  options: V23Options = {}
): V23Result | undefined {
  const resolved = resolveOptions(options);
  const duck = volume as unknown as VolumeLike;
  return createV23Result(
    () => buildVolumeObject(duck, resolved),
    () => volumeSignature(duck)
  );
}
