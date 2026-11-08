import {
  BackSide,
  BoxGeometry,
  DataTexture,
  GLSL3,
  LinearFilter,
  Matrix4,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from "three";
import type { vtkVolumeProperty } from "@kitware/vtk.js/Rendering/Core/VolumeProperty.js";
import { BlendMode, VolumeInterpolation } from "./constants";
import { setVolumeNearestFilter } from "./ImageDataMapper";
import type { ImageVolume } from "./ImageDataMapper";
import { sRGBToLinear } from "./ScalarColorMapper";

const TF_SIZE = 256;

/** Structural view of the pieces of vtkVolumeProperty that P5 consumes. */
export interface VolumePropertyLike {
  getRGBTransferFunction(index: number): {
    getTable(start: number, end: number, size: number, table: number[]): void;
  } | null;
  getScalarOpacity(index: number): {
    getTable(start: number, end: number, size: number, table: number[], stride?: number): void;
  } | null;
  getScalarOpacityUnitDistance(index: number): number;
  getShade(): boolean;
  getAmbient(): number;
  getDiffuse(): number;
  getSpecular(): number;
  getInterpolationType(): number;
  getUseGradientOpacity?(index: number): boolean;
  getGradientOpacityMinimumValue?(index: number): number;
  getGradientOpacityMinimumOpacity?(index: number): number;
  getGradientOpacityMaximumValue?(index: number): number;
  getGradientOpacityMaximumOpacity?(index: number): number;
}

export interface VolumeMaterialSet {
  mesh: Mesh;
  material: ShaderMaterial;
  textures: DataTexture[];
  warnings: string[];
  unsupported: string[];
}

export interface VolumeBuildOptions {
  steps: number;
  blendMode: number;
  sampleDistance: number;
}

const VERTEX_SHADER = /* glsl */ `
out vec3 vLocalPos;
out vec3 vRayOrigin;

void main() {
  vLocalPos = position;
  // three injects modelMatrix / cameraPosition into the VERTEX prefix only,
  // so the world -> local transform has to be computed here.
  vRayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vLocalPos;
in vec3 vRayOrigin;
layout(location = 0) out vec4 fragColor;

uniform highp sampler3D uVolume;
uniform sampler2D uTransfer;
uniform float uSteps;
uniform float uOpacityScale;
uniform int uBlendMode;
uniform float uShade;
uniform vec3 uLightDir;

vec2 intersectBox(vec3 origin, vec3 dir) {
  vec3 invDir = 1.0 / dir;
  vec3 tA = (vec3(-0.5) - origin) * invDir;
  vec3 tB = (vec3(0.5) - origin) * invDir;
  vec3 tMin = min(tA, tB);
  vec3 tMax = max(tA, tB);
  return vec2(max(max(tMin.x, tMin.y), tMin.z), min(min(tMax.x, tMax.y), tMax.z));
}

float sampleVolume(vec3 p) {
  return texture(uVolume, clamp(p, vec3(0.0), vec3(1.0))).r;
}

vec3 gradient(vec3 p, float stepSize) {
  vec3 e = vec3(stepSize, 0.0, 0.0);
  return normalize(vec3(
    sampleVolume(p + e.xyy) - sampleVolume(p - e.xyy),
    sampleVolume(p + e.yxy) - sampleVolume(p - e.yxy),
    sampleVolume(p + e.yyx) - sampleVolume(p - e.yyx)
  ) + vec3(1e-5));
}

void main() {
  vec3 rayOrigin = vRayOrigin;
  vec3 rayDir = normalize(vLocalPos - rayOrigin);
  vec2 hit = intersectBox(rayOrigin, rayDir);
  if (hit.x > hit.y || hit.y < 0.0) discard;

  float tStart = max(hit.x, 0.0);
  float dt = (hit.y - tStart) / uSteps;
  if (dt <= 0.0) discard;

  vec4 accumulated = vec4(0.0);
  float maxValue = 0.0;
  float minValue = 1.0;
  float sumValue = 0.0;
  vec3 additive = vec3(0.0);

  for (int i = 0; i < 2048; ++i) {
    if (float(i) >= uSteps) break;
    vec3 local = rayOrigin + rayDir * (tStart + (float(i) + 0.5) * dt);
    vec3 texCoord = local + 0.5;
    float value = sampleVolume(texCoord);
    vec4 transfer = texture(uTransfer, vec2(value, 0.5));

    maxValue = max(maxValue, value);
    minValue = min(minValue, value);
    sumValue += value;

    if (uBlendMode == 0) {
      float alpha = 1.0 - pow(1.0 - clamp(transfer.a, 0.0, 1.0), uOpacityScale);
      vec3 color = transfer.rgb * alpha;
      if (uShade > 0.5) {
        vec3 normal = gradient(texCoord, dt);
        float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
        color *= 0.35 + 0.65 * diffuse;
      }
      accumulated.rgb += (1.0 - accumulated.a) * color;
      accumulated.a += (1.0 - accumulated.a) * alpha;
      if (accumulated.a >= 0.995) break;
    } else if (uBlendMode == 4) {
      additive += transfer.rgb * transfer.a;
    }
  }

  if (uBlendMode == 0) {
    fragColor = accumulated;
  } else if (uBlendMode == 1 || uBlendMode == 2) {
    float v = uBlendMode == 1 ? maxValue : minValue;
    fragColor = texture(uTransfer, vec2(v, 0.5));
    fragColor.a = 1.0;
  } else if (uBlendMode == 3) {
    float v = sumValue / max(uSteps, 1.0);
    fragColor = texture(uTransfer, vec2(v, 0.5));
    fragColor.a = 1.0;
  } else {
    fragColor = vec4(clamp(additive, 0.0, 1.0), 1.0);
  }

  if (fragColor.a <= 0.001) discard;
  // Manual linear -> sRGB output: three only applies output conversion to
  // built-in materials; a raw ShaderMaterial must do it itself.
  fragColor.rgb = mix(
    fragColor.rgb * 12.92,
    1.055 * pow(max(fragColor.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
    step(vec3(0.0031308), fragColor.rgb)
  );
}
`;

/** Bakes vtk color / opacity transfer functions into a 256x1 RGBA LUT. */
export function buildTransferFunction(
  property: VolumePropertyLike,
  range: [number, number]
): { texture: DataTexture; warnings: string[] } {
  const warnings: string[] = [];
  const [min, max] = range;
  const pixels = new Uint8Array(4 * TF_SIZE);

  const colorTable: number[] = [];
  const ctf = property.getRGBTransferFunction(0);
  if (ctf) {
    try {
      ctf.getTable(min, max, TF_SIZE, colorTable);
    } catch {
      colorTable.length = 0;
    }
  }
  if (!ctf || colorTable.length < 3 * TF_SIZE) {
    warnings.push("No usable RGB transfer function; used a grayscale ramp.");
  }

  const opacityTable: number[] = [];
  const pwf = property.getScalarOpacity(0);
  if (pwf) {
    try {
      pwf.getTable(min, max, TF_SIZE, opacityTable);
    } catch {
      opacityTable.length = 0;
    }
  }
  if (!pwf || opacityTable.length < TF_SIZE) {
    warnings.push("No usable scalar opacity function; used a linear ramp.");
  }

  for (let i = 0; i < TF_SIZE; ++i) {
    const src = 3 * i;
    const r = colorTable.length >= 3 * TF_SIZE ? colorTable[src] : i / (TF_SIZE - 1);
    const g = colorTable.length >= 3 * TF_SIZE ? colorTable[src + 1] : i / (TF_SIZE - 1);
    const b = colorTable.length >= 3 * TF_SIZE ? colorTable[src + 2] : i / (TF_SIZE - 1);
    const a = opacityTable.length >= TF_SIZE ? opacityTable[i] : i / (TF_SIZE - 1);
    pixels[4 * i] = Math.round(255 * sRGBToLinear(Math.max(0, Math.min(1, r))));
    pixels[4 * i + 1] = Math.round(255 * sRGBToLinear(Math.max(0, Math.min(1, g))));
    pixels[4 * i + 2] = Math.round(255 * sRGBToLinear(Math.max(0, Math.min(1, b))));
    pixels[4 * i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
  }

  const texture = new DataTexture(pixels, TF_SIZE, 1, RGBAFormat);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  texture.userData.v23Owned = true;
  return { texture, warnings };
}

const SUPPORTED_BLEND_MODES = new Set<number>([
  BlendMode.COMPOSITE_BLEND,
  BlendMode.MAXIMUM_INTENSITY_BLEND,
  BlendMode.MINIMUM_INTENSITY_BLEND,
  BlendMode.AVERAGE_INTENSITY_BLEND,
  BlendMode.ADDITIVE_INTENSITY_BLEND,
]);

/**
 * Builds a ray-marched Mesh for one vtkVolume. The unit cube is placed in vtk
 * index space via indexToWorld, so origin / spacing / direction are preserved.
 */
export function buildVolumeMesh(
  volume: ImageVolume,
  property: VolumePropertyLike,
  options: VolumeBuildOptions
): VolumeMaterialSet {
  const warnings = [...volume.warnings];
  const unsupported: string[] = [];

  if (property.getInterpolationType() === VolumeInterpolation.NEAREST) {
    setVolumeNearestFilter(volume.texture);
  }
  if (property.getInterpolationType() === VolumeInterpolation.FAST_LINEAR) {
    warnings.push("vtk FAST_LINEAR interpolation is mapped to hardware linear filtering.");
  }

  let blendMode = options.blendMode;
  if (!SUPPORTED_BLEND_MODES.has(blendMode)) {
    unsupported.push(
      `vtkVolumeMapper blend mode ${blendMode} (Radon / label-map edge projection)`
    );
    warnings.push(`Blend mode ${blendMode} is unsupported; used COMPOSITE_BLEND.`);
    blendMode = BlendMode.COMPOSITE_BLEND;
  }

  const transfer = buildTransferFunction(property, volume.scalarRange);
  warnings.push(...transfer.warnings);

  const unitDistance = property.getScalarOpacityUnitDistance(0);
  const opacityScale =
    Number.isFinite(unitDistance) && unitDistance > 0
      ? Math.max(0.001, options.sampleDistance / unitDistance)
      : 1;

  const shade = property.getShade();
  if (shade) {
    unsupported.push("Full vtk volume shading (ambient / specular / multiple lights)");
    warnings.push("vtkVolumeProperty.shade is approximated with a single directional gradient light.");
  }
  if (property.getUseGradientOpacity?.(0)) {
    unsupported.push("Gradient opacity modulation");
  }

  const geometry = new BoxGeometry(1, 1, 1);
  const [dx, dy, dz] = volume.sourceDimensions;
  const indexToWorld = volume.indexToWorld.clone();
  const placement = new Matrix4()
    .makeTranslation(dx / 2, dy / 2, dz / 2)
    .multiply(new Matrix4().makeScale(dx, dy, dz));
  indexToWorld.multiply(placement);

  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: BackSide,
    uniforms: {
      uVolume: { value: volume.texture },
      uTransfer: { value: transfer.texture },
      uSteps: { value: options.steps },
      uOpacityScale: { value: opacityScale },
      uBlendMode: { value: blendMode },
      uShade: { value: shade ? 1 : 0 },
      uLightDir: { value: new Vector3(0.4, 0.7, 1).normalize() },
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = "vtkVolume";
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(indexToWorld);
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    textures: [transfer.texture],
    warnings,
    unsupported,
  };
}
