import {
  cloneColliderWithTransform,
  placementMatrix,
  type GameplayCollider,
} from "../../physics/colliders";
import type { HangarPlacementEntry } from "../../net/api";
import { loadPrefabDocument } from "../../world/prefabs/loader";
import { buildPrefabColliders } from "../../physics/prefab_colliders";

export function createBuildPropColliderRuntime() {
  const prefabColliders = new Map<string, Promise<GameplayCollider[]>>();
  let colliders: GameplayCollider[] = [];
  let generation = 0;

  function loadPrefabColliders(prefabId: string): Promise<GameplayCollider[]> {
    let pending = prefabColliders.get(prefabId);
    if (!pending) {
      pending = loadPrefabDocument(prefabId).then(async (doc) =>
        doc ? await buildPrefabColliders(doc) : [],
      );
      prefabColliders.set(prefabId, pending);
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
        const matrix = placementMatrix(placement);
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
    getColliders(): GameplayCollider[] {
      return colliders;
    },
    dispose(): void {
      colliders = [];
      prefabColliders.clear();
    },
  };
}

export type BuildPropColliderRuntime = ReturnType<
  typeof createBuildPropColliderRuntime
>;
