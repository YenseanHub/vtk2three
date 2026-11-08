import { Group } from "three";
import type { vtkActor } from "@kitware/vtk.js/Rendering/Core/Actor.js";
import type { vtkRenderer } from "@kitware/vtk.js/Rendering/Core/Renderer.js";
import type { vtkVolume } from "@kitware/vtk.js/Rendering/Core/Volume.js";
import { GLOBAL_UNSUPPORTED } from "./ActorMapper";
import { convertActor } from "./v23Mapper";
import { convertVolume } from "./VolumeMapper";
import { emptyStats } from "./types";
import type { CapabilityReport, V23Options, V23Result, V23SceneResult } from "./types";

interface SceneSources {
  actors: () => vtkActor[];
  volumes?: () => vtkVolume[];
}

type EntryMap<T> = Map<T, V23Result>;

function createSceneResult(
  sources: SceneSources,
  options: V23Options
): V23SceneResult {
  const root = new Group();
  root.name = "vtkScene";
  const actors: EntryMap<vtkActor> = new Map();
  const volumes: EntryMap<vtkVolume> = new Map();
  const report: CapabilityReport = {
    warnings: [],
    unsupported: [...GLOBAL_UNSUPPORTED],
    stats: emptyStats(),
  };
  let disposed = false;

  const refreshReport = (): void => {
    report.warnings.length = 0;
    report.unsupported.length = 0;
    report.unsupported.push(...GLOBAL_UNSUPPORTED);
    Object.assign(report.stats, emptyStats());

    for (const entry of [...actors.values(), ...volumes.values()]) {
      report.warnings.push(...entry.report.warnings);
      for (const item of entry.report.unsupported) {
        if (!report.unsupported.includes(item)) report.unsupported.push(item);
      }
      const target = report.stats;
      const source = entry.report.stats;
      target.points += source.points;
      target.cells += source.cells;
      target.triangles += source.triangles;
      target.lineSegments += source.lineSegments;
      target.vertices += source.vertices;
      target.primitives += source.primitives;
      target.textures += source.textures;
      target.voxels += source.voxels;
      target.glyphs += source.glyphs;
      target.volumes += source.volumes;
    }
  };

  const syncMap = <T>(
    entries: EntryMap<T>,
    current: T[],
    build: (item: T) => V23Result | undefined
  ): boolean => {
    let changed = false;
    const present = new Set(current);
    for (const [item, entry] of entries) {
      if (!present.has(item)) {
        entry.dispose();
        entries.delete(item);
        changed = true;
      }
    }
    for (const item of current) {
      const existing = entries.get(item);
      if (existing) {
        if (existing.update()) changed = true;
        continue;
      }
      const converted = build(item);
      if (!converted) continue;
      entries.set(item, converted);
      root.add(converted.object);
      changed = true;
    }
    return changed;
  };

  const sync = (): boolean => {
    if (disposed) return false;
    let changed = syncMap(actors, sources.actors(), (actor) =>
      convertActor(actor, options)
    );
    if (sources.volumes) {
      changed =
        syncMap(volumes, sources.volumes(), (volume) =>
          convertVolume(volume, options)
        ) || changed;
    }
    if (changed || root.children.length === 0) refreshReport();
    return changed;
  };

  sync();

  return {
    object: root,
    report,
    sync,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of [...actors.values(), ...volumes.values()]) entry.dispose();
      actors.clear();
      volumes.clear();
      root.clear();
      root.removeFromParent();
    },
  };
}

/** Converts an explicit list of vtkActors into a synchronisable three Group. */
export function convertActors(
  actors: vtkActor[],
  options: V23Options = {}
): V23SceneResult {
  return createSceneResult({ actors: () => actors }, options);
}

/** Converts explicit actor + volume lists into a synchronisable three Group. */
export function convertProps(
  props: { actors?: vtkActor[]; volumes?: vtkVolume[] },
  options: V23Options = {}
): V23SceneResult {
  return createSceneResult(
    {
      actors: () => props.actors ?? [],
      volumes: () => props.volumes ?? [],
    },
    options
  );
}

/** Converts every actor and volume in a vtkRenderer. */
export function convertRenderer(
  renderer: vtkRenderer,
  options: V23Options = {}
): V23SceneResult {
  return createSceneResult(
    {
      actors: () => renderer.getActors() as unknown as vtkActor[],
      volumes: () => renderer.getVolumes(),
    },
    options
  );
}
