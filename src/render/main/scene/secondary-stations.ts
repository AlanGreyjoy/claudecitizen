import type * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { distance } from '../../../math/vec3';
import type { StationFrame } from '../../../world/station';
import type { PrefabDocument } from '../../../world/prefabs/schema';
import type { ParticleMaterialFactory } from '../../particles/material';
import { createPrefabStationGroup } from '../../prefabs/prefab-renderer';

/**
 * Brings secondary station prefabs online ahead of arrival, one at a time.
 *
 * `createPrefabStationGroup` walks and clones a whole prefab tree in one
 * synchronous call, and it used to run in the first frame inside the load
 * distance — a hitch landing exactly as the player closes on something worth
 * looking at.
 */

// Distant stations already have System Map/nav markers, so their detailed
// prefab only loads once the player is close enough for the mesh to matter.
const LOAD_DISTANCE_METERS = 75_000;
/**
 * Where the deferred build starts. Far enough out that its cost lands during
 * cruise rather than on approach; purely a scheduling hint, since crossing
 * `LOAD_DISTANCE_METERS` without a finished mesh still builds synchronously.
 */
const PREPARE_DISTANCE_METERS = 220_000;

export interface SecondaryStationEntry {
  prefab: PrefabDocument;
  frame: StationFrame;
  mesh: THREE.Group | null;
  buildScheduled: boolean;
}

export interface SecondaryStationLoader {
  entries: SecondaryStationEntry[];
  /** Returns the station's group, building or scheduling it as distance allows. */
  ensure: (entry: SecondaryStationEntry, focusPosition: Vec3) => THREE.Group | null;
  dispose: () => void;
}

export interface SecondaryStationLoaderOptions {
  scene: THREE.Scene;
  renderScale: number;
  stations: ReadonlyArray<{ prefab: PrefabDocument; frame: StationFrame }>;
  /** Read at build time, so a live quality change applies to stations not yet built. */
  getShadowSettings: () => {
    localLightShadowMapSize: number;
    localLightShadowsEnabled: boolean;
  };
  particleMaterialFactory: ParticleMaterialFactory;
}

export function createSecondaryStationLoader(
  options: SecondaryStationLoaderOptions,
): SecondaryStationLoader {
  const entries: SecondaryStationEntry[] = options.stations.map((station) => ({
    ...station,
    mesh: null,
    buildScheduled: false,
  }));
  /** Serialises deferred builds so two cannot land in one macrotask. */
  let buildInFlight = false;
  let disposed = false;

  function build(entry: SecondaryStationEntry): THREE.Group {
    const shadows = options.getShadowSettings();
    const mesh = createPrefabStationGroup(entry.prefab, options.renderScale, {
      localLightShadowMapSize: shadows.localLightShadowMapSize,
      localLightShadowsEnabled: shadows.localLightShadowsEnabled,
      particleMaterialFactory: options.particleMaterialFactory,
    });
    entry.mesh = mesh;
    options.scene.add(mesh);
    return mesh;
  }

  return {
    entries,
    ensure(entry, focusPosition) {
      if (entry.mesh) return entry.mesh;
      const distanceMeters = distance(entry.frame.origin, focusPosition);

      // Synchronous backstop. Arriving this close without a mesh — a teleport,
      // or a timer starved by a long frame — must still produce a station
      // rather than empty space.
      if (distanceMeters <= LOAD_DISTANCE_METERS) return build(entry);

      if (
        entry.buildScheduled ||
        buildInFlight ||
        distanceMeters > PREPARE_DISTANCE_METERS
      ) {
        return null;
      }

      entry.buildScheduled = true;
      buildInFlight = true;
      // `setTimeout`, not `requestIdleCallback`: a continuous Play RAF loop
      // never goes idle, so idle callbacks never fire here — the same trap that
      // left the atmosphere LUTs unfilled (see `post/webgpu-atmosphere.ts`).
      // This does not make the build cheaper; it moves it out of the render
      // callback and keeps several stations from stacking into one frame.
      setTimeout(() => {
        buildInFlight = false;
        // The scene may have been torn down, or the backstop may have won the
        // race, between scheduling and running.
        if (disposed || entry.mesh) return;
        build(entry);
      }, 0);
      return null;
    },
    dispose() {
      disposed = true;
    },
  };
}
