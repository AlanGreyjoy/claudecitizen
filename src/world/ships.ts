import { createFlightBody } from "../flight/flight-body";
import {
  createShipInstance,
} from "../flight/ship-instance";
import {
  getShipInstance,
  registerShipInstance,
} from "../flight/ship-world";
import type { GameBootstrap } from "../net/api";
import {
  getShipLayoutForPrefab,
  registerShipLayoutForPrefab,
  setActiveShipPrefabId,
  setShipLayoutOverride,
  type ShipLayout,
} from "../player/ship-layout";
import { PLAYER_SHIP_INSTANCE_ID } from "../player/world-state";
import { loadPrefabDocument } from "./prefabs/loader";
import { buildShipLayoutFromPrefab } from "./prefabs/ship-runtime";

/**
 * The player ship is a ship prefab: hull model, colliders, doors, pilot
 * seat, and ramp anchors all come from its components. The empty stub in
 * player/ship_layout.ts is only used before a prefab layout is loaded.
 *
 * Which hull that is belongs to the project, not the engine — a hardcoded id
 * resolved to nothing in every project but the one it was named for, and the
 * failure was silent: a hull rendered from the built-in model while the layout
 * stayed the collider-less stub, so players walked through their own ship.
 * `app/` injects the project's `defaultShipPrefab` at startup.
 */
let defaultShipPrefabId: string | null = null;

/**
 * Prefab id of the ship instance a shipless session still has to construct:
 * `WorldState` has no "no ship" state and `getActiveShip` throws on a missing
 * instance. It resolves to the collider-less stub layout, so `usesColliderDeck`
 * is false and nothing tries to board it.
 */
export const NO_SHIP_PREFAB_ID = "none";

export function setDefaultShipPrefabId(prefabId: string | null): void {
  const trimmed = prefabId?.trim();
  defaultShipPrefabId = trimmed ? trimmed : null;
}

export function getDefaultShipPrefabId(): string | null {
  return defaultShipPrefabId;
}

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
  const layout = await buildShipLayoutFromPrefab(doc);
  if (!layout) return null;
  registerShipLayoutForPrefab(prefabId, layout);
  return layout;
}

/**
 * Hull this session's world should be built from, resolved before world
 * creation so the ship instance is right the first time. A scene that places a
 * ship wins; otherwise the player's own ship; otherwise the project fallback.
 * Returns null when the session genuinely has no ship.
 */
export async function resolveSessionShipPrefabId(
  sceneShipPrefabId: string | null,
  ships: GameBootstrap["ships"] | undefined,
): Promise<string | null> {
  const prefabId = sceneShipPrefabId ?? ships?.[0]?.prefabId ?? defaultShipPrefabId;
  if (!prefabId) return null;
  // The layout must be registered before `createWorldState` reads it, or the
  // instance is built on the collider-less stub and only corrected later.
  const layout = await loadShipPrefabLayout(prefabId);
  if (!layout) {
    console.warn(`Ship prefab "${prefabId}" did not load; this session has no ship.`);
    return null;
  }
  if (layout.colliders.length === 0) {
    console.warn(
      `Ship prefab "${prefabId}" has no deck colliders; its interior is not walkable.`,
    );
  }
  setActiveShipPrefabId(prefabId);
  return prefabId;
}

/** Clears the active prefab override (dev / teardown). */
export function clearActiveShipPrefab(): void {
  setShipLayoutOverride(null);
}

export type OwnedShipRecord = GameBootstrap["ships"][number];

/** Swaps the local player ship instance to a server-owned record. */
export async function applyOwnedShipToInstance(
  owned: OwnedShipRecord,
  playerId: string,
): Promise<void> {
  await loadShipPrefabLayout(owned.prefabId);
  const instance = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
  if (!instance) {
    throw new Error(`Missing ship instance "${PLAYER_SHIP_INSTANCE_ID}".`);
  }
  instance.ownerPlayerId = playerId;
  instance.prefabId = owned.prefabId;
  instance.vitals.hp = owned.hp;
  instance.vitals.shields = owned.shields;
  instance.spec = {
    ...getShipLayoutForPrefab(owned.prefabId).spec,
    maxSpeedMps: owned.maxSpeedMps,
    throttleAccelMps2: owned.throttleAccelMps2,
    forwardThrustN:
      owned.throttleAccelMps2 *
      getShipLayoutForPrefab(owned.prefabId).spec.massKg,
    maxHp: owned.maxHp,
    maxShields: owned.maxShields,
    shieldRegenPerSec: owned.shieldRegenPerSec,
  };
  setActiveShipPrefabId(owned.prefabId);
}

/** Ensures the primary player ship instance exists, creating it if necessary. */
export async function ensurePlayerShipInstance(
  owned: OwnedShipRecord,
  playerId: string,
  hangarInstanceId: string,
): Promise<void> {
  await loadShipPrefabLayout(owned.prefabId);

  const instance = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
  if (instance) {
    await applyOwnedShipToInstance(owned, playerId);
    return;
  }

  const layout = getShipLayoutForPrefab(owned.prefabId);
  const body = createFlightBody({ x: 0, y: 0, z: 0 });
  const created = createShipInstance({
    id: PLAYER_SHIP_INSTANCE_ID,
    prefabId: owned.prefabId,
    layout,
    body,
    ownerPlayerId: playerId,
    instanceId: hangarInstanceId,
    vitals: { hp: owned.hp, shields: owned.shields },
  });
  created.spec = {
    ...created.spec,
    maxSpeedMps: owned.maxSpeedMps,
    throttleAccelMps2: owned.throttleAccelMps2,
    maxHp: owned.maxHp,
    maxShields: owned.maxShields,
    shieldRegenPerSec: owned.shieldRegenPerSec,
  };
  registerShipInstance(created);
  setActiveShipPrefabId(owned.prefabId);
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
  await ensurePlayerShipInstance(primary, playerId, hangarInstanceId);
}
