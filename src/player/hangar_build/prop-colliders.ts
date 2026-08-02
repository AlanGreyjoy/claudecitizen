import {
  cloneColliderWithTransform,
  placementMatrix,
  preloadMeshColliders,
  type GameplayCollider,
} from "../../physics/colliders";
import type { HangarPlacementEntry } from "../../net/api";
import { loadPrefabDocument } from "../../world/prefabs/loader";
import { buildPrefabColliders } from "../../physics/prefab-colliders";
import type { BuildPlacementFrame } from "./placement-frame";
import type { PlacementTransform } from "./validation";

export function createBuildPropColliderRuntime(options: {
  placementFrame?: BuildPlacementFrame;
} = {}) {
  const prefabColliderPromises = new Map<string, Promise<GameplayCollider[]>>();
  const prefabColliderCache = new Map<string, GameplayCollider[]>();
  let colliders: GameplayCollider[] = [];
  let generation = 0;

  function loadPrefabColliders(prefabId: string): Promise<GameplayCollider[]> {
    let pending = prefabColliderPromises.get(prefabId);
    if (!pending) {
      pending = loadPrefabDocument(prefabId).then(async (doc) => {
        const baked = doc ? await buildPrefabColliders(doc) : [];
        await preloadMeshColliders(baked);
        prefabColliderCache.set(prefabId, baked);
        return baked;
      });
      prefabColliderPromises.set(prefabId, pending);
    }
    return pending;
  }

  async function setPlacements(placements: HangarPlacementEntry[]): Promise<void> {
    const currentGeneration = generation + 1;
    generation = currentGeneration;
    const next: GameplayCollider[] = [];
    await Promise.all(
      placements.map(async (placement) => {
        const source = await loadPrefabColliders(placement.prefabId);
        const runtimePlacement =
          options.placementFrame?.toRuntime(placement) ?? placement;
        const matrix = placementMatrix(runtimePlacement);
        for (const collider of source) {
          next.push(cloneColliderWithTransform(collider, matrix, placement.id));
        }
      }),
    );
    if (generation !== currentGeneration) return;
    colliders = next;
    console.debug(
      `[collider] setPlacements: ${placements.length} placements -> ${colliders.length} colliders`,
      colliders.map((c) => ({
        id: c.id,
        kind: c.kind,
        ...(c.kind === 'box' ? { halfSize: c.halfSize } : {}),
      })),
    );
  }

  return {
    setPlacements,
    ensurePrefabColliders(prefabId: string): Promise<GameplayCollider[]> {
      return loadPrefabColliders(prefabId);
    },
    getPrefabColliders(prefabId: string): GameplayCollider[] | null {
      return prefabColliderCache.get(prefabId) ?? null;
    },
    /**
     * Bake source prefab colliders at a runtime station-local placement.
     * Returns null when the prefab has not been loaded yet.
     */
    collidersAtRuntimeTransform(
      prefabId: string,
      runtimeTransform: PlacementTransform,
      idPrefix = "ghost",
    ): GameplayCollider[] | null {
      const source = prefabColliderCache.get(prefabId);
      if (!source) return null;
      const matrix = placementMatrix(runtimeTransform);
      return source.map((collider) =>
        cloneColliderWithTransform(collider, matrix, idPrefix),
      );
    },
    getColliders(): GameplayCollider[] {
      return colliders;
    },
    dispose(): void {
      colliders = [];
      prefabColliderPromises.clear();
      prefabColliderCache.clear();
    },
  };
}

export type BuildPropColliderRuntime = ReturnType<
  typeof createBuildPropColliderRuntime
>;
