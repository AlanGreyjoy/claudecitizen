import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import {
  findItemDefinition,
  type ItemDefinition,
  type WeaponFireMode,
} from "../../player/inventory/types";
import type { LoopContext } from "../loop_context";

export interface ActiveFirearm {
  ammoItemDefinitionId: string;
  bulletGravityMps2: number;
  definition: ItemDefinition;
  fireModes: WeaponFireMode[];
  magazineSize: number;
  maxRangeMeters: number;
  muzzleVelocityMps: number;
  roundsPerMinute: number;
}

function isCombatWalkMode(mode: string): boolean {
  return (
    mode === MODE_ON_FOOT ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_IN_STATION
  );
}

function hasWeaponShape(definition: ItemDefinition): boolean {
  return (
    definition.itemType === "weapon" &&
    definition.weaponSlotType !== "sword" &&
    Boolean(definition.ammoItemDefinitionId) &&
    Array.isArray(definition.fireModes) &&
    definition.fireModes.length > 0
  );
}

function hasFiniteWeaponStats(definition: ItemDefinition): boolean {
  return (
    Number.isFinite(definition.magazineSize) &&
    Number.isFinite(definition.roundsPerMinute) &&
    Number.isFinite(definition.muzzleVelocityMps) &&
    Number.isFinite(definition.bulletGravityMps2) &&
    Number.isFinite(definition.maxRangeMeters)
  );
}

function buildActiveFirearm(definition: ItemDefinition): ActiveFirearm | null {
  if (!hasWeaponShape(definition) || !hasFiniteWeaponStats(definition)) {
    return null;
  }
  if (!definition.ammoItemDefinitionId || !definition.fireModes) return null;
  const magazineSize = Math.floor(definition.magazineSize ?? 0);
  const roundsPerMinute = definition.roundsPerMinute ?? 0;
  const muzzleVelocityMps = definition.muzzleVelocityMps ?? 0;
  const bulletGravityMps2 = definition.bulletGravityMps2 ?? 0;
  const maxRangeMeters = definition.maxRangeMeters ?? 0;
  const statsOk =
    magazineSize >= 1 &&
    roundsPerMinute > 0 &&
    muzzleVelocityMps > 0 &&
    bulletGravityMps2 >= 0 &&
    maxRangeMeters > 0;
  if (!statsOk) return null;
  return {
    ammoItemDefinitionId: definition.ammoItemDefinitionId,
    bulletGravityMps2,
    definition,
    fireModes: [...definition.fireModes],
    magazineSize,
    maxRangeMeters,
    muzzleVelocityMps,
    roundsPerMinute,
  };
}

/** Resolve the currently equipped, fireable weapon for walk modes. */
export function resolveActiveFirearm(ctx: LoopContext): ActiveFirearm | null {
  if (!isCombatWalkMode(ctx.world.mode)) return null;
  if (!ctx.activeWeaponSlotId) return null;
  const inventory = ctx.getInventory();
  const itemId = inventory?.loadout[ctx.activeWeaponSlotId];
  if (!inventory || !itemId) return null;
  const definition = findItemDefinition(inventory.catalog, itemId);
  if (!definition) return null;
  const ammoDefinition = definition.ammoItemDefinitionId
    ? findItemDefinition(inventory.catalog, definition.ammoItemDefinitionId)
    : null;
  if (ammoDefinition?.itemType !== "ammo") return null;
  return buildActiveFirearm(definition);
}
