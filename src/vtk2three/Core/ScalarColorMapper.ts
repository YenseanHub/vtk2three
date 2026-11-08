import type { vtkMapper } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import { ColorMode, GetArray } from "./constants";
import type { ResolvedV23Options } from "../types";

/** Linear-space vertex colors ready to be uploaded as a three color attribute. */
export interface ScalarColors {
  /** Tuple-wise linear RGB(A). Point association: one tuple per vtk point.
   *  Cell association: one tuple per vtk cell (verts+lines+polys+strips). */
  data: Float32Array;
  components: 3 | 4;
  association: "none" | "point" | "cell";
  hasAlpha: boolean;
  warnings: string[];
}

type MapperWithArrayId = vtkMapper & { getArrayId?: () => number | undefined };

export function sRGBToLinear(c: number): number {
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function white(pointCount: number): ScalarColors {
  return {
    data: new Float32Array(3 * pointCount).fill(1),
    components: 3,
    association: "none",
    hasAlpha: false,
    warnings: [],
  };
}

/**
 * Reproduces vtkMapper::mapScalars' scalar-array selection and LUT lookup, but
 * always materialises RGBA tuples. vtk.js switches to a texture-based coloring
 * path for cell data / interpolateScalarsBeforeMapping, which leaves
 * getColorMapColors() null; three.js needs concrete vertex colors instead.
 */
export function resolveScalarColors(
  mapper: vtkMapper | null,
  polyData: vtkPolyData,
  pointCount: number,
  cellCount: number,
  options: ResolvedV23Options
): ScalarColors {
  const warnings: string[] = [];
  if (!mapper || !mapper.getScalarVisibility()) return white(pointCount);

  type AbstractArgs = Parameters<vtkMapper["getAbstractScalars"]>;
  const arrayId = (mapper as MapperWithArrayId).getArrayId?.();
  const args: AbstractArgs = [
    polyData,
    mapper.getScalarMode() as AbstractArgs[1],
    mapper.getArrayAccessMode(),
    arrayId,
    mapper.getColorByArrayName(),
  ];
  if (mapper.getArrayAccessMode() === GetArray.BY_ID && arrayId === undefined) {
    warnings.push(
      "Array access mode BY_ID has no public arrayId getter in vtk.js 38; active scalars were used."
    );
  }

  const { scalars, cellFlag } = mapper.getAbstractScalars(...args);
  if (!scalars) return { ...white(pointCount), warnings };

  const lut = mapper.getLookupTable();
  if (!lut) return { ...white(pointCount), warnings };

  if (mapper.getInterpolateScalarsBeforeMapping()) {
    warnings.push(
      "interpolateScalarsBeforeMapping is on: vtk interpolates scalar values, this converter bakes per-point colors."
    );
  }

  // vtkMapper::mapScalars overrides the LUT range unless the mapper opts out.
  // Only touch mutable LUT state when the value actually differs, so the
  // mapper's mtime (used for incremental updates) stays stable.
  const mapperRange = mapper.getScalarRange();
  const previousRange = lut.getRange().slice();
  const previousAlpha = lut.getAlpha();
  const needsRange =
    !mapper.getUseLookupTableScalarRange() &&
    (previousRange[0] !== mapperRange[0] || previousRange[1] !== mapperRange[1]);
  const needsAlpha = previousAlpha !== options.scalarAlpha;
  if (needsRange) lut.setRange(mapperRange[0], mapperRange[1]);
  if (needsAlpha) lut.setAlpha(options.scalarAlpha);
  lut.build();

  let mapped;
  try {
    mapped = lut.mapScalars(
      scalars,
      mapper.getColorMode(),
      mapper.getFieldDataTupleId()
    );
  } finally {
    if (needsAlpha) lut.setAlpha(previousAlpha);
    if (needsRange) lut.setRange(previousRange[0], previousRange[1]);
    if (needsAlpha || needsRange) lut.build();
  }

  if (!mapped) return { ...white(pointCount), warnings };

  const src = mapped.getData();
  const srcComponents = mapped.getNumberOfComponents();
  const tupleCount = mapped.getNumberOfTuples();
  if (tupleCount === 0 || srcComponents < 3) {
    return { ...white(pointCount), warnings };
  }

  let hasAlpha = false;
  if (srcComponents >= 4 && options.vertexAlpha) {
    for (let i = 0; i < tupleCount; ++i) {
      if (src[srcComponents * i + 3] < 255) {
        hasAlpha = true;
        break;
      }
    }
  }
  const components: 3 | 4 = hasAlpha ? 4 : 3;

  const isCell = cellFlag && tupleCount === cellCount;
  if (cellFlag && !isCell && tupleCount !== 1) {
    warnings.push(
      `Cell scalar array has ${tupleCount} tuples but the data set has ${cellCount} cells; colors were broadcast.`
    );
  }
  if (!cellFlag && tupleCount !== pointCount && tupleCount !== 1) {
    warnings.push(
      `Point scalar array has ${tupleCount} tuples but the data set has ${pointCount} points; colors were broadcast.`
    );
  }

  const outputCount = isCell ? cellCount : pointCount;
  const data = new Float32Array(components * outputCount);
  for (let index = 0; index < outputCount; ++index) {
    const sourceTuple = tupleCount === 1 ? 0 : Math.min(index, tupleCount - 1);
    const srcOffset = srcComponents * sourceTuple;
    const dstOffset = components * index;
    data[dstOffset] = sRGBToLinear(Number(src[srcOffset]) / 255);
    data[dstOffset + 1] = sRGBToLinear(Number(src[srcOffset + 1]) / 255);
    data[dstOffset + 2] = sRGBToLinear(Number(src[srcOffset + 2]) / 255);
    if (components === 4) {
      data[dstOffset + 3] = Number(src[srcOffset + 3]) / 255;
    }
  }

  if (mapper.getColorMode() === ColorMode.DIRECT_SCALARS) {
    warnings.push("DIRECT_SCALARS colors are treated as sRGB and linearised for three.js.");
  }

  return {
    data,
    components,
    association: isCell ? "cell" : "point",
    hasAlpha,
    warnings,
  };
}
