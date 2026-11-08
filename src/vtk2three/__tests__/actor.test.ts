import { describe, expect, it } from "vitest";
import { Group } from "three";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import vtkRenderer from "@kitware/vtk.js/Rendering/Core/Renderer.js";
import type { vtkActor as VtkActorType } from "@kitware/vtk.js/Rendering/Core/Actor.js";
import { convertActor } from "../v23Mapper";
import { convertActors, convertRenderer } from "../SceneMapper";

function makeActor(): VtkActorType {
  const polyData = vtkPolyData.newInstance();
  polyData
    .getPoints()
    .setData(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0]), 3);
  polyData.getVerts().setData(new Uint32Array([2, 0, 1]));
  polyData.getLines().setData(new Uint32Array([3, 1, 2, 3]));
  polyData.getPolys().setData(new Uint32Array([3, 2, 3, 4]));
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  return actor;
}

describe("P4 actor / scene mapping", () => {
  it("builds one object per primitive type", () => {
    const result = convertActor(makeActor())!;
    expect(result.object.type).toBe("Group");
    expect(result.object.children.map((child) => child.type)).toEqual([
      "Mesh",
      "LineSegments",
      "Points",
    ]);
    expect(result.object.userData.vtkActor).toBeDefined();
    expect(result.report.stats.primitives).toBe(3);
    expect(result.report.stats.points).toBe(5);
    expect(result.report.stats.cells).toBe(3);
    result.dispose();
  });

  it("applies actor matrix and visibility", () => {
    const actor = makeActor();
    actor.setPosition(1, 2, 3);
    actor.setScale(2, 2, 2);
    actor.setVisibility(false);
    const result = convertActor(actor)!;
    expect(result.object.position.toArray()).toEqual([1, 2, 3]);
    expect(result.object.scale.toArray()).toEqual([2, 2, 2]);
    expect(result.object.visible).toBe(false);
    result.dispose();
  });

  it("updates in place only when vtk mtimes changed", () => {
    const actor = makeActor();
    const result = convertActor(actor)!;
    const root = result.object;
    expect(result.update()).toBe(false);

    actor.setPosition(5, 0, 0);
    expect(result.update()).toBe(true);
    expect(result.object).toBe(root);
    expect(root.position.x).toBe(5);
    expect(result.update()).toBe(false);
    expect(result.update(true)).toBe(true);
    result.dispose();
  });

  it("dispose detaches the object and is idempotent", () => {
    const result = convertActor(makeActor())!;
    const parent = new Group();
    parent.add(result.object);
    result.dispose();
    expect(parent.children).toHaveLength(0);
    expect(() => result.dispose()).not.toThrow();
    expect(result.update()).toBe(false);
  });

  it("convertRenderer syncs actor add / remove / update", () => {
    const renderer = vtkRenderer.newInstance();
    const first = makeActor();
    const second = makeActor();
    renderer.addActor(first);
    renderer.addActor(second);

    const scene = convertRenderer(renderer);
    expect(scene.object.children).toHaveLength(2);
    expect(scene.report.stats.primitives).toBe(6);

    renderer.removeActor(second);
    expect(scene.sync()).toBe(true);
    expect(scene.object.children).toHaveLength(1);

    first.setPosition(3, 0, 0);
    expect(scene.sync()).toBe(true);
    expect(scene.object.children[0].position.x).toBe(3);

    renderer.addActor(makeActor());
    expect(scene.sync()).toBe(true);
    expect(scene.object.children).toHaveLength(2);

    scene.dispose();
    expect(scene.object.children).toHaveLength(0);
    expect(() => scene.dispose()).not.toThrow();
  });

  it("convertActors works without a renderer", () => {
    const scene = convertActors([makeActor(), makeActor()]);
    expect(scene.object.children).toHaveLength(2);
    expect(scene.sync()).toBe(false);
    scene.dispose();
  });
});
