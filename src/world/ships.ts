import { createFlightBody } from "../flight/flight_body";
import {
  createShipInstance,
} from "../flight/ship_instance";
import {
  getShipInstance,
  registerShipInstance,
} from "../flight/ship_world";
import type { GameBootstrap } from "../net/api";
import {
  DEFAULT_SHIP_LAYOUT,
  getShipLayoutForPrefab,
  registerShipLayoutForPrefab,
  setActiveShipPrefabId,
  setShipLayoutOverride,
  type ShipLayout,
} from "../player/ship_layout";
import { PLAYER_SHIP_INSTANCE_ID } from "../player/world_state";
import { loadPrefabDocument } from "./prefabs/loader";
import { buildShipLayoutFromPrefab } from "./prefabs/ship_runtime";

/**
 * The player ship is a ship prefab: hull model, walk zones, doors, pilot
 * seat, and ramp anchors all come from its components. The hardcoded
 * Starhopper layout in player/ship_layout.ts remains the fallback when the
 * prefab is missing or unusable.
 */
export const DEFAULT_SHIP_PREFAB_ID = "phobos-starhopper";

registerShipLayoutForPrefab(DEFAULT_SHIP_PREFAB_ID, DEFAULT_SHIP_LAYOUT);

/** Loads a ship prefab, caches its layout, and optionally activates it. */
export async function loadShipPrefabLayout(
  prefabId: string,
): Promise<ShipLayout | null> {
  const doc = await loadPrefabDocument(prefabId);
  if (!doc) {
    console.warn(`Ship prefab "${prefabId}" not found.`);
    return null;
  }
  if (doc.kind !== "ship") {
    console.warn(`Prefab "${prefabId}" is not a ship prefab.`);
    return null;
  }
  const layout = buildShipLayoutFromPrefab(doc);
  if (!layout) return null;
  registerShipLayoutForPrefab(prefabId, layout);
  return layout;
}

/** Loads the default ship prefab and activates its gameplay layout. */
export async function applyDefaultShipPrefab(): Promise<void> {
  const layout = await loadShipPrefabLayout(DEFAULT_SHIP_PREFAB_ID);
  if (!layout || layout.walkZones.length === 0) {
    if (layout) {
      console.warn(
        `Ship prefab "${DEFAULT_SHIP_PREFAB_ID}" has no walk zones; using the built-in layout.`,
      );
    } else {
      console.warn(
        `Ship prefab "${DEFAULT_SHIP_PREFAB_ID}" not found; using the built-in ship layout.`,
      );
    }
    return;
  }
  setActiveShipPrefabId(DEFAULT_SHIP_PREFAB_ID);
}

/** Activates a cached or freshly loaded prefab layout for deck/rig helpers. */
export async function activateShipPrefab(prefabId: string): Promise<ShipLayout> {
  let layout = getShipLayoutForPrefab(prefabId);
  const cached = layout;
  const loaded = await loadShipPrefabLayout(prefabId);
  if (loaded) layout = loaded;
  else if (cached) layout = cached;
  setActiveShipPrefabId(prefabId);
  return layout;
}

/** Clears the active prefab override (dev / teardown). */
export function clearActiveShipPrefab(): void {
  setShipLayoutOverride(null);
}

/** Applies server-owned ship records to the local ship instance registry. */
export async function syncBootstrapShips(
  ships: GameBootstrap["ships"],
  playerId: string,
  hangarInstanceId: string,
): Promise<void> {
  for (const owned of ships) {
    await loadShipPrefabLayout(owned.prefabId);
  }
  const primary = ships[0];
  if (!primary) return;

  let instance = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
  if (instance) {
    instance.ownerPlayerId = playerId;
    instance.prefabId = primary.prefabId;
    instance.vitals.hp = primary.hp;
    instance.vitals.shields = primary.shields;
    instance.spec = {
      ...getShipLayoutForPrefab(primary.prefabId).spec,
      maxSpeedMps: primary.maxSpeedMps,
      throttleAccelMps2: primary.throttleAccelMps2,
      maxHp: primary.maxHp,
      maxShields: primary.maxShields,
      shieldRegenPerSec: primary.shieldRegenPerSec,
    };
    setActiveShipPrefabId(primary.prefabId);
    return;
  }

  const layout = getShipLayoutForPrefab(primary.prefabId);
  const body = createFlightBody({ x: 0, y: 0, z: 0 });
  instance = createShipInstance({
    id: PLAYER_SHIP_INSTANCE_ID,
    prefabId: primary.prefabId,
    layout,
    body,
    ownerPlayerId: playerId,
    instanceId: hangarInstanceId,
    vitals: { hp: primary.hp, shields: primary.shields },
  });
  instance.spec = {
    ...instance.spec,
    maxSpeedMps: primary.maxSpeedMps,
    throttleAccelMps2: primary.throttleAccelMps2,
    maxHp: primary.maxHp,
    maxShields: primary.maxShields,
    shieldRegenPerSec: primary.shieldRegenPerSec,
  };
  registerShipInstance(instance);
  setActiveShipPrefabId(primary.prefabId);
}
