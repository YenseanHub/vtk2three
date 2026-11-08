import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  PointsMaterial,
  SRGBColorSpace,
  Vector2,
} from "three";
import type { Material, Side, Texture } from "three";
import type { vtkProperty } from "@kitware/vtk.js/Rendering/Core/Property.js";
import { Interpolation, Representation } from "./constants";
import type { RepresentationValue } from "./constants";
import { mapVtkTexture } from "./TextureMapper";
import { resolveOptions } from "../types";
import type { ResolvedV23Options } from "../types";

export interface MaterialContext {
  hasTCoords: boolean;
  hasAlpha: boolean;
  representation?: RepresentationValue;
}

export interface MaterialSet {
  surface: Material;
  line: LineBasicMaterial;
  point: PointsMaterial;
  /** Wireframe overlay used when vtkProperty.edgeVisibility is on. */
  edge?: Material;
  textures: Texture[];
  warnings: string[];
  unsupported: string[];
}

function toColor(rgb: number[]): Color {
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class MaterialMapper {
  private readonly vtkProperty: vtkProperty;
  private readonly options: ResolvedV23Options;

  constructor(
    vtkProperty: vtkProperty,
    options: ResolvedV23Options = resolveOptions()
  ) {
    this.vtkProperty = vtkProperty;
    this.options = options;
  }

  /** Legacy single-material entry point (SURFACE representation). */
  mapMaterial(): Material {
    return this.mapMaterialSet({ hasTCoords: false, hasAlpha: false }).surface;
  }

  mapMaterialSet(context: MaterialContext): MaterialSet {
    const property = this.vtkProperty;
    const warnings: string[] = [];
    const unsupported: string[] = [];
    const textures: Texture[] = [];
    const representation = context.representation ?? Representation.SURFACE;

    const baseColor = toColor(property.getColor());
    const opacity = clamp01(property.getOpacity());
    const transparent = opacity < 1 || context.hasAlpha;
    const flatShading = property.getInterpolation() === Interpolation.FLAT;
    const lighting = property.getLighting();

    const backface = property.getBackfaceCulling();
    const frontface = property.getFrontfaceCulling();
    let side: Side = DoubleSide;
    if (backface && frontface) {
      warnings.push("Both backface and frontface culling are on; kept DoubleSide.");
    } else if (backface) {
      side = FrontSide;
    } else if (frontface) {
      side = BackSide;
    }

    const common = {
      color: baseColor,
      vertexColors: true,
      transparent,
      opacity,
      side,
    };

    let surface: Material;
    const interpolation = property.getInterpolation();
    const ambientColor = toColor(property.getAmbientColor()).multiplyScalar(
      clamp01(property.getAmbient())
    );

    if (!lighting) {
      surface = new MeshBasicMaterial({ ...common, wireframe: representation === Representation.WIREFRAME });
      warnings.push("vtkProperty.lighting is off; used MeshBasicMaterial.");
    } else if (interpolation === Interpolation.PBR) {
      const ior = property.getBaseIOR();
      const attenuationDistance = property.getAttenuationDistance();
      surface = new MeshPhysicalMaterial({
        ...common,
        wireframe: representation === Representation.WIREFRAME,
        flatShading,
        metalness: clamp01(property.getMetallic()),
        roughness: clamp01(property.getRoughness()),
        ior: ior > 0 ? Math.max(1, Math.min(2.333, ior)) : 1.5,
        emissive: ambientColor,
        clearcoat: clamp01(property.getCoatStrength()),
        clearcoatRoughness: clamp01(property.getCoatRoughness()),
        transmission: clamp01(property.getTransmissionFactor()),
        thickness: Math.max(0, property.getThicknessFactor()),
        attenuationColor: toColor(property.getAttenuationColor()),
        attenuationDistance:
          Number.isFinite(attenuationDistance) && attenuationDistance > 0
            ? attenuationDistance
            : Infinity,
        iridescence: clamp01(property.getIridescenceFactor()),
        iridescenceIOR: property.getIridescenceIOR() || 1.3,
        iridescenceThicknessMinimum: property.getIridescenceThicknessMinimum(),
        iridescenceThicknessMaximum: property.getIridescenceThicknessMaximum(),
        specularIntensity: clamp01(property.getSpecularFactor()),
        specularColor: toColor(property.getSpecularColorFactor()),
        anisotropy: clamp01(property.getAnisotropy()),
        anisotropyRotation: property.getAnisotropyRotation(),
        sheenRoughness: clamp01(property.getSheenRoughnessFactor()),
      });
      warnings.push(
        "PBR ambient/emission coefficients are approximated by three emissive color."
      );
    } else if (interpolation === Interpolation.PHONG) {
      surface = new MeshPhongMaterial({
        ...common,
        wireframe: representation === Representation.WIREFRAME,
        flatShading,
        specular: toColor(property.getSpecularColor()).multiplyScalar(
          clamp01(property.getSpecular())
        ),
        shininess: Math.max(0, property.getSpecularPower()),
        emissive: ambientColor,
      });
    } else {
      surface = new MeshLambertMaterial({
        ...common,
        wireframe: representation === Representation.WIREFRAME,
        flatShading,
        emissive: ambientColor,
      });
      warnings.push(
        "vtk ambient/diffuse/specular coefficients are approximated by three emissive + Lambert shading."
      );
    }

    if (property.getAlphaCutoff() > 0 || property.getAlphaMode() !== 0) {
      unsupported.push("vtkProperty alphaMode / alphaCutoff masking");
    }

    const lineWidth = property.getLineWidth();
    const line = new LineBasicMaterial({
      ...common,
      linewidth: lineWidth,
    });
    if (lineWidth > 1) {
      warnings.push(
        `lineWidth ${lineWidth} is ignored by WebGL line primitives (always 1px).`
      );
    }

    const point = new PointsMaterial({
      ...common,
      size: Math.max(1, property.getPointSize()),
      sizeAttenuation: false,
    });

    if (property.getEdgeVisibility() && representation === Representation.SURFACE) {
      // Handled by ActorMapper as a separate wireframe overlay.
    } else if (property.getEdgeVisibility()) {
      warnings.push("Edge visibility is only mapped for SURFACE representation.");
    }

    if (this.options.mapTextures && !context.hasTCoords) {
      if (
        property.getDiffuseTexture() ||
        property.getNormalTexture() ||
        property.getRoughnessTexture() ||
        property.getMetallicTexture() ||
        property.getEmissionTexture() ||
        property.getAmbientOcclusionTexture()
      ) {
        warnings.push("Textures were skipped: the data set has no texture coordinates.");
      }
    }

    if (this.options.mapTextures && context.hasTCoords) {
      const slots: Array<{
        get: () => Parameters<typeof mapVtkTexture>[0];
        key: string;
        srgb: boolean;
      }> = [
        { get: () => property.getDiffuseTexture(), key: "map", srgb: true },
        { get: () => property.getNormalTexture(), key: "normalMap", srgb: false },
        {
          get: () => property.getAmbientOcclusionTexture(),
          key: "aoMap",
          srgb: false,
        },
        { get: () => property.getEmissionTexture(), key: "emissiveMap", srgb: true },
        { get: () => property.getMetallicTexture(), key: "metalnessMap", srgb: false },
        { get: () => property.getRoughnessTexture(), key: "roughnessMap", srgb: false },
      ];
      const target = surface as unknown as Record<string, unknown>;
      for (const slot of slots) {
        const mapped = mapVtkTexture(slot.get(), slot.srgb);
        if (!mapped) continue;
        if (slot.key === "aoMap") {
          (mapped as unknown as { channel: number }).channel = 0;
        }
        target[slot.key] = mapped;
        textures.push(mapped);
      }
      if (target.normalMap) {
        const strength = property.getNormalStrength();
        target.normalScale = new Vector2(strength, strength);
      }
      if (textures.length > 0) {
        warnings.push("Texture Y orientation may differ from the vtk.js renderer.");
        surface.needsUpdate = true;
      }
      if (property.getORMTexture() || property.getRMTexture()) {
        unsupported.push("packed ORM / RM textures (channel packing differs)");
      }
    }

    let edge: Material | undefined;
    if (property.getEdgeVisibility() && representation === Representation.SURFACE) {
      edge = new MeshBasicMaterial({
        color: toColor(property.getEdgeColor()),
        transparent,
        opacity: property.getEdgeOpacity(),
        wireframe: true,
        side,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    }

    return { surface, line, point, edge, textures, warnings, unsupported };
  }
}
