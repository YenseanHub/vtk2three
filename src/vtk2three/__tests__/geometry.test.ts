import { describe, expect, it } from "vitest";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkPlaneSource from "@kitware/vtk.js/Filters/Sources/PlaneSource.js";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import { GeometryMapper } from "../Core/GeometryMapper";
import { convertActor } from "../v23Mapper";
import { resolveOptions } from "../types";

function makePipeline(xResolution = 1, yResolution = 1) {
  const source = vtkPlaneSource.newInstance({ xResolution, yResolution });
  const data = source.getOutputData() as vtkPolyData;
  const lookupTable = vtkLookupTable.newInstance({ hueRange: [0, 0.667] });
  lookupTable.setNumberOfColors(10);
  const mapper = vtkMapper.newInstance();
  mapper.setLookupTable(lookupTable);
  mapper.setInputConnection(source.getOutputPort());
  return { mapper, data };
}

describe("resolveOptions", () => {
  it("defaults to identity scale for data-level equivalence", () => {
    expect(resolveOptions()).toEqual({
      scale: 1,
      scalarAlpha: 1,
      computeNormals: true,
      vertexAlpha: true,
      mapTextures: true,
      triangulateConcavePolygons: true,
      volumeSteps: 256,
      maxVolumeSize: 256,
      imageDataSlice: true,
    });
  });

  it("accepts explicit overrides", () => {
    expect(
      resolveOptions({
        scale: 2,
        scalarAlpha: 0.5,
        computeNormals: false,
        vertexAlpha: false,
        mapTextures: false,
        triangulateConcavePolygons: false,
        volumeSteps: 64,
        maxVolumeSize: 128,
        imageDataSlice: false,
      })
    ).toEqual({
      scale: 2,
      scalarAlpha: 0.5,
      computeNormals: false,
      vertexAlpha: false,
      mapTextures: false,
      triangulateConcavePolygons: false,
      volumeSteps: 64,
      maxVolumeSize: 128,
      imageDataSlice: false,
    });
  });

  it("clamps volume ray-marching options", () => {
    const resolved = resolveOptions({ volumeSteps: 9999, maxVolumeSize: 1 });
    expect(resolved.volumeSteps).toBe(2048);
    expect(resolved.maxVolumeSize).toBe(2);
  });
});

describe("GeometryMapper", () => {
  it("keeps vtk point coordinates verbatim at scale 1", () => {
    const { mapper, data } = makePipeline();
    const geometry = new GeometryMapper(mapper).mapGeometry();
    expect(geometry).toBeDefined();
    const position = geometry!.getAttribute("position").array;
    expect(Array.from(position)).toEqual(
      Array.from(data.getPoints().getData())
    );
  });

  it("applies scale without mutating the vtk data", () => {
    const { mapper, data } = makePipeline();
    const original = Array.from(data.getPoints().getData());
    const geometry = new GeometryMapper(
      mapper,
      resolveOptions({ scale: 2 })
    ).mapGeometry();
    expect(Array.from(geometry!.getAttribute("position").array)).toEqual(
      original.map((value) => value * 2)
    );
    expect(Array.from(data.getPoints().getData())).toEqual(original);
  });

  it("triangulates one quad into six valid indices", () => {
    const { mapper, data } = makePipeline();
    const geometry = new GeometryMapper(mapper).mapGeometry()!;
    expect(geometry.getAttribute("position").count).toBe(
      data.getNumberOfPoints()
    );
    expect(geometry.getIndex()!.count).toBe(6);
    for (const value of geometry.getIndex()!.array) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(data.getNumberOfPoints());
    }
  });

  it("provides normals, colors and bounds", () => {
    const { mapper, data } = makePipeline();
    const geometry = new GeometryMapper(mapper).mapGeometry()!;
    const pointCount = data.getNumberOfPoints();
    expect(geometry.getAttribute("normal").count).toBe(pointCount);
    expect(geometry.getAttribute("color").count).toBe(pointCount);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
    for (const value of geometry.getAttribute("color").array) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("returns undefined when the mapper has no input", () => {
    expect(new GeometryMapper(vtkMapper.newInstance()).mapGeometry()).toBeUndefined();
  });
});

describe("convertActor", () => {
  it("returns a group, a capability report, stats and a disposer", () => {
    const { mapper } = makePipeline();
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const result = convertActor(actor);
    expect(result).toBeDefined();
    expect(result!.object.type).toBe("Group");
    expect(result!.object.children.length).toBe(1);
    expect(result!.report.unsupported.length).toBeGreaterThan(0);
    expect(result!.report.warnings.length).toBeGreaterThan(0);
    expect(result!.report.stats.triangles).toBe(2);
    expect(result!.report.stats.points).toBe(4);
    expect(() => result!.dispose()).not.toThrow();
  });
});
