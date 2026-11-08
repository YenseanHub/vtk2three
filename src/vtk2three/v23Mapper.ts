import { Mesh } from "three";
import type { Group, Object3D } from "three";
import type { vtkActor } from "@kitware/vtk.js/Rendering/Core/Actor.js";
import type { vtkMapper } from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import { GeometryMapper } from "./Core/GeometryMapper";
import { MaterialMapper } from "./Core/MaterialMapper";
import { Representation } from "./Core/constants";
import { disposeObject3D } from "./Core/dispose";
import { actorSignature, buildActorObject } from "./ActorMapper";
import type { ActorBuild } from "./ActorMapper";
import { emptyStats, resolveOptions } from "./types";
import type { V23Options, V23Result } from "./types";

/**
 * Legacy facade: one vtkActor -> one three Mesh (SURFACE representation only).
 * Prefer convertActor(), which maps transforms, visibility and all primitives.
 */
export class v23Mapper {
  private actor: vtkActor | null = null;
  private mapper: vtkMapper | null = null;
  private readonly options: V23Options;

  constructor(options: V23Options = {}) {
    this.options = options;
  }

  setActor(actor: vtkActor): void {
    this.actor = actor;
    this.mapper = actor.getMapper();
  }

  getMeshData(): Mesh | undefined {
    if (!this.mapper || !this.actor) return undefined;
    const resolved = resolveOptions(this.options);
    const set = new GeometryMapper(this.mapper, resolved).mapPrimitives(
      Representation.SURFACE
    );
    if (!set?.surface) return undefined;
    const materials = new MaterialMapper(this.actor.getProperty(), resolved).mapMaterialSet({
      hasTCoords: set.hasTCoords,
      hasAlpha: set.hasAlpha,
      representation: Representation.SURFACE,
    });
    return new Mesh(set.surface, materials.surface);
  }
}

/**
 * Wraps a rebuildable object graph with mtime-driven `update()` and `dispose()`.
 * Shared by convertActor() and convertVolume(); the root Object3D identity is
 * preserved across rebuilds so callers can keep it in their scene.
 */
export function createV23Result(
  build: () => ActorBuild | undefined,
  signatureFn: () => string
): V23Result | undefined {
  const initial = build();
  if (!initial) return undefined;

  const root: Object3D = initial.root;
  const report = initial.report;
  let signature = signatureFn();
  let disposed = false;

  const adopt = (fresh: ActorBuild | undefined): void => {
    disposeObject3D(root);
    (root as Group).clear();
    if (!fresh) {
      report.warnings.length = 0;
      report.warnings.push("The vtk object no longer has convertible input.");
      Object.assign(report.stats, emptyStats());
      return;
    }
    for (const child of [...fresh.root.children]) root.add(child);
    root.position.copy(fresh.root.position);
    root.quaternion.copy(fresh.root.quaternion);
    root.scale.copy(fresh.root.scale);
    root.visible = fresh.root.visible;
    root.userData.vtkProp = fresh.root.userData.vtkProp;
    report.warnings.length = 0;
    report.warnings.push(...fresh.report.warnings);
    report.unsupported.length = 0;
    report.unsupported.push(...fresh.report.unsupported);
    Object.assign(report.stats, fresh.report.stats);
  };

  return {
    object: root,
    report,
    update(force = false): boolean {
      if (disposed) return false;
      const next = signatureFn();
      if (!force && next === signature) return false;
      adopt(build());
      // Rebuilding can bump LUT / array mtimes; capture the final state.
      signature = signatureFn();
      return true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeObject3D(root);
      (root as Group).clear();
      root.removeFromParent();
    },
  };
}

/** Converts one vtkActor into a synchronisable three.js object graph. */
export function convertActor(
  actor: vtkActor,
  options: V23Options = {}
): V23Result | undefined {
  const resolved = resolveOptions(options);
  return createV23Result(
    () => buildActorObject(actor, resolved),
    () => actorSignature(actor)
  );
}
