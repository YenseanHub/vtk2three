import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
} from "three";
import type { Texture as ThreeTexture, Wrapping } from "three";
import type { vtkTexture } from "@kitware/vtk.js/Rendering/Core/Texture.js";
import type { TextureWrap } from "@kitware/vtk.js/Rendering/Core/Texture.js";

function toWrapping(
  mode: TextureWrap | null | undefined,
  repeat: boolean,
  clamp: boolean
): Wrapping {
  if (mode === "clamp-to-edge") return ClampToEdgeWrapping;
  if (mode === "mirror-repeat") return MirroredRepeatWrapping;
  if (mode === "repeat") return RepeatWrapping;
  return clamp ? ClampToEdgeWrapping : repeat ? RepeatWrapping : RepeatWrapping;
}

/** Converts a vtkTexture into a three Texture. Returns undefined when the
 *  texture has no usable pixel source (e.g. an image that has not loaded). */
export function mapVtkTexture(
  vtkTexture: vtkTexture | null | undefined,
  srgb: boolean
): ThreeTexture | undefined {
  if (!vtkTexture) return undefined;
  const source = vtkTexture.getInputAsJsImageData();
  if (!source) return undefined;

  let texture: ThreeTexture;
  if ("data" in source && "width" in source && "height" in source) {
    const imageData = source as ImageData;
    texture = new DataTexture(
      new Uint8Array(imageData.data.buffer.slice(0)),
      imageData.width,
      imageData.height,
      RGBAFormat
    );
  } else if ("getContext" in source) {
    texture = new CanvasTexture(source as HTMLCanvasElement);
  } else {
    texture = new Texture(source as HTMLImageElement | ImageBitmap);
  }

  const interpolate = vtkTexture.getInterpolate();
  texture.magFilter = interpolate ? LinearFilter : NearestFilter;
  texture.minFilter = interpolate ? LinearFilter : NearestFilter;
  texture.wrapS = toWrapping(
    vtkTexture.getWrapS(),
    vtkTexture.getRepeat(),
    vtkTexture.getEdgeClamp()
  );
  texture.wrapT = toWrapping(
    vtkTexture.getWrapT(),
    vtkTexture.getRepeat(),
    vtkTexture.getEdgeClamp()
  );
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  texture.userData.v23Owned = true;
  texture.needsUpdate = true;
  return texture;
}
