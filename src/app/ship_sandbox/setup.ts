import { loadPrefabDocument } from '../../world/prefabs/loader';
import { buildShipLayoutFromPrefab } from '../../world/prefabs/ship_runtime';
import { setShipLayoutOverride, usesColliderDeck } from '../../player/ship_layout';
import type { PrefabDocument } from '../../world/prefabs/schema';

export interface ShipSandboxPrefabLoad {
  doc: PrefabDocument | null;
  prefabApplied: boolean;
  walkable: boolean;
  hint: string;
}

export async function loadShipSandboxPrefab(prefabId: string): Promise<ShipSandboxPrefabLoad> {
  const doc = await loadPrefabDocument(prefabId);
  let prefabApplied = false;
  if (!doc) {
    console.warn(
      `Ship prefab "${prefabId}" not found; sandbox uses the built-in Starhopper.`,
    );
  } else if (doc.kind !== 'ship') {
    console.warn(
      `Prefab "${prefabId}" is kind "${doc.kind}", not ship; using the built-in layout.`,
    );
  } else {
    const layout = await buildShipLayoutFromPrefab(doc);
    if (layout) {
      setShipLayoutOverride(layout);
      prefabApplied = true;
      console.info(`Ship prefab sandbox active: "${prefabId}".`);
    }
  }
  const walkable = (prefabApplied || !doc) && usesColliderDeck();
  const hint = walkable
    ? 'Ship sandbox — WASD walk · F interact · sit pilot to fly · G gear · Esc menu'
    : prefabApplied
      ? 'Hull loaded — add a ship-controller with deck colliders to walk the interior'
      : 'Ship prefab not applied (kind must be "ship") — showing the built-in ship';
  return { doc, prefabApplied, walkable, hint };
}
