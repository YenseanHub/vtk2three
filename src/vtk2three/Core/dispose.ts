import type { BufferGeometry, Material, Object3D, Texture } from "three";

type Renderable = Object3D & {
  geometry?: BufferGeometry;
  material?: Material | Material[];
};

/** Releases every GPU resource created by a conversion, exactly once. */
export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((child) => {
    const candidate = child as Renderable;
    if (candidate.geometry) geometries.add(candidate.geometry);
    const material = candidate.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item));
    else if (material) materials.add(material);
  });

  const collect = (value: unknown): void => {
    const texture = value as Texture | null;
    if (texture && typeof texture === "object" && texture.isTexture) {
      if ((texture.userData as { v23Owned?: boolean } | undefined)?.v23Owned) {
        textures.add(texture);
      }
    }
  };

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material)) collect(value);
    // ShaderMaterial keeps volume / transfer-function textures in uniforms,
    // not on direct material properties.
    const uniforms = (material as unknown as {
      uniforms?: Record<string, { value?: unknown }>;
    }).uniforms;
    if (uniforms) {
      for (const uniform of Object.values(uniforms)) collect(uniform?.value);
    }
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
}
