import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import {
  resolveWeaponSlotPress,
  stanceIdForWeaponSlot,
} from "../../player/inventory/weapon_select";
import {
  resolveWalkAiming,
  resolveWalkInputIntent,
} from "../../player/character_locomotion";
import {
  findItemDefinition,
  itemQuantity,
  type ItemDefinition,
  type WeaponFireMode,
} from "../../player/inventory/types";
import {
  advanceWeaponFire,
  createWeaponFireState,
  currentWeaponFireMode,
  rejectWeaponReload,
  resolveWeaponReload,
  type WeaponFireState,
} from "../../player/weapon_fire";
import {
  buildBallisticPath,
  resolveBallisticHit,
  type BallisticSegment,
  type WeaponGeometryHit,
} from "../../player/weapon_ballistics";
import { getActiveShipBody } from "../../player/world_state";
import {
  resolveStationWalkView,
  stationWalkAimOriginWorld,
} from "../../player/weapon_shop_gaze";
import { castStationWorldRay } from "../../physics/station_physics";
import { castShipWorldRay } from "../../physics/ship_physics";
import { castTerrainPath } from "../../world/planet_surface";
import { normalize } from "../../math/vec3";
import { playSfx } from "../../audio/sfx";
import { consumeInventoryAmmo } from "../../net/api";
import type { HudUpdateParams } from "../../render/effects";
import type { Vec3 } from "../../types";
import type { CharacterInput, WeaponCombatRuntimeEvent } from "../types";
import type { LoopContext } from "../loop_context";
import type { EquippedInventory } from "../inventory/equipped";

interface ActiveFirearm {
  ammoItemDefinitionId: string;
  bulletGravityMps2: number;
  definition: ItemDefinition;
  fireModes: WeaponFireMode[];
  magazineSize: number;
  maxRangeMeters: number;
  muzzleVelocityMps: number;
  roundsPerMinute: number;
}

interface WeaponCombatActions {
  cycleWeaponFireModePressed: boolean;
  primaryClickHeld: boolean;
  primaryClickPressed: boolean;
  reloadWeaponPressed: boolean;
}

export interface WeaponCombat {
  currentAnimStance: () => ReturnType<typeof stanceIdForWeaponSlot>;
  currentWeaponPoseAiming: (input: CharacterInput) => boolean;
  activeFirearm: () => ActiveFirearm | null;
  updateWeaponCombat: (actions: WeaponCombatActions, dt: number) => void;
  currentCombatAmmoHud: () => HudUpdateParams["combatAmmo"];
  applyWeaponSlotPress: (press: 1 | 2 | 3 | null) => void;
}

/** On-foot / deck / station firearm selection, aiming, fire, and reload. */
export function createWeaponCombat(
  ctx: LoopContext,
  deps: { inventory: EquippedInventory },
): WeaponCombat {
  function currentAnimStance() {
    if (ctx.activeWeaponSlotId) {
      const loadout = ctx.getInventory()?.loadout ?? ctx.getInventoryLoadout() ?? {};
      if (!loadout[ctx.activeWeaponSlotId]) ctx.activeWeaponSlotId = null;
    }
    return stanceIdForWeaponSlot(ctx.activeWeaponSlotId);
  }

  /** Hard aim is held by RMB. */
  function currentWeaponAiming() {
    return ctx.activeWeaponSlotId !== null && ctx.controls.isSecondaryClickHeld();
  }

  function currentWeaponPoseAiming(input: CharacterInput) {
    return resolveWalkAiming(
      currentWeaponAiming(),
      resolveWalkInputIntent(input),
    );
  }

  function activeFirearm(): ActiveFirearm | null {
    if (
      ctx.world.mode !== MODE_ON_FOOT &&
      ctx.world.mode !== MODE_ON_SHIP_DECK &&
      ctx.world.mode !== MODE_IN_STATION
    ) {
      return null;
    }
    if (!ctx.activeWeaponSlotId) return null;
    const inventory = ctx.getInventory();
    const itemId = inventory?.loadout[ctx.activeWeaponSlotId];
    if (!inventory || !itemId) return null;
    const definition = findItemDefinition(inventory.catalog, itemId);
    const ammoDefinition = definition?.ammoItemDefinitionId
      ? findItemDefinition(inventory.catalog, definition.ammoItemDefinitionId)
      : null;
    if (
      !definition ||
      definition.itemType !== "weapon" ||
      definition.weaponSlotType === "sword" ||
      !definition.ammoItemDefinitionId ||
      ammoDefinition?.itemType !== "ammo" ||
      !Array.isArray(definition.fireModes) ||
      definition.fireModes.length === 0 ||
      !Number.isFinite(definition.magazineSize) ||
      !Number.isFinite(definition.roundsPerMinute) ||
      !Number.isFinite(definition.muzzleVelocityMps) ||
      !Number.isFinite(definition.bulletGravityMps2) ||
      !Number.isFinite(definition.maxRangeMeters)
    ) {
      return null;
    }
    const magazineSize = Math.floor(definition.magazineSize ?? 0);
    const roundsPerMinute = definition.roundsPerMinute ?? 0;
    const muzzleVelocityMps = definition.muzzleVelocityMps ?? 0;
    const bulletGravityMps2 = definition.bulletGravityMps2 ?? 0;
    const maxRangeMeters = definition.maxRangeMeters ?? 0;
    if (
      magazineSize < 1 ||
      roundsPerMinute <= 0 ||
      muzzleVelocityMps <= 0 ||
      bulletGravityMps2 < 0 ||
      maxRangeMeters <= 0
    ) {
      return null;
    }
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

  function fireStateFor(firearm: ActiveFirearm): WeaponFireState {
    const existing = ctx.weaponFireStates.get(firearm.definition.id);
    if (
      existing &&
      existing.magazineSize === firearm.magazineSize &&
      existing.roundsPerMinute === firearm.roundsPerMinute &&
      existing.fireModes.join("|") === firearm.fireModes.join("|")
    ) {
      return existing;
    }
    const created = createWeaponFireState({
      fireModes: firearm.fireModes,
      magazineSize: firearm.magazineSize,
      roundsPerMinute: firearm.roundsPerMinute,
      weaponId: firearm.definition.id,
    });
    ctx.weaponFireStates.set(firearm.definition.id, created);
    return created;
  }

  function fallbackWeaponPose(): { direction: Vec3; origin: Vec3 } {
    let basisForward = ctx.world.character.forward;
    let yawRadians = 0;
    if (ctx.world.mode === MODE_IN_STATION) {
      basisForward = ctx.stationFrame.forward;
      yawRadians = ctx.world.cameraOrbit.yawRadians;
    } else if (ctx.world.mode === MODE_ON_SHIP_DECK) {
      basisForward = getActiveShipBody(ctx.world).forward;
      yawRadians = ctx.world.cameraOrbit.yawRadians;
    }
    const view = resolveStationWalkView(
      basisForward,
      ctx.world.character.up,
      yawRadians,
      ctx.world.cameraOrbit.pitchRadians,
    );
    return {
      direction: view.forward,
      origin: stationWalkAimOriginWorld(
        ctx.world.character.position,
        ctx.world.character.up,
        view.forward,
      ),
    };
  }

  function resolveWeaponWorldHit(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
  ): WeaponGeometryHit | null {
    if (ctx.world.mode === MODE_IN_STATION && ctx.physics) {
      const hit = castStationWorldRay(ctx.physics, ctx.stationFrame, origin, direction, maxDistance);
      return hit ? { ...hit, surfaceKind: "station" } : null;
    }
    if (ctx.world.mode === MODE_ON_SHIP_DECK && ctx.shipPhysics) {
      const hit = castShipWorldRay(
        ctx.shipPhysics,
        getActiveShipBody(ctx.world),
        origin,
        direction,
        maxDistance,
      );
      return hit ? { ...hit, surfaceKind: "ship" } : null;
    }
    return null;
  }

  function resolveWeaponBallisticHit(
    path: readonly BallisticSegment[],
  ): WeaponGeometryHit | null {
    if (ctx.world.mode === MODE_ON_FOOT) {
      const hit = castTerrainPath(ctx.planet, ctx.seed, path);
      return hit ? { ...hit, surfaceKind: "terrain" } : null;
    }
    return resolveBallisticHit(path, resolveWeaponWorldHit);
  }

  function updateWeaponCombat(actions: WeaponCombatActions, dt: number): void {
    const firearm = activeFirearm();
    if (!firearm) return;
    const inventory = ctx.getInventory();
    if (!inventory) return;
    const state = fireStateFor(firearm);
    const fireEvents = advanceWeaponFire(state, {
      cycleModePressed: actions.cycleWeaponFireModePressed,
      deltaSeconds: dt,
      reloadPressed: actions.reloadWeaponPressed,
      reserveRounds: itemQuantity(inventory, firearm.ammoItemDefinitionId),
      triggerHeld: actions.primaryClickHeld,
      triggerPressed: actions.primaryClickPressed,
    });
    if (fireEvents.length === 0) return;

    const presentation = ctx.renderer?.getActiveWeaponWorldPose() ?? null;
    const fallback = fallbackWeaponPose();
    const marker = presentation?.barrelEnd;
    const origin = marker?.position ?? fallback.origin;
    const direction = normalize(marker?.forward ?? fallback.direction);
    const runtimeEvents: WeaponCombatRuntimeEvent[] = [];

    for (const event of fireEvents) {
      if (event.type === "shot") {
        const path = buildBallisticPath(
          {
            bulletGravityMps2: firearm.bulletGravityMps2,
            forward: direction,
            maxRangeMeters: firearm.maxRangeMeters,
            muzzleVelocityMps: firearm.muzzleVelocityMps,
            origin,
            worldUp: ctx.world.character.up,
          },
          ctx.ballisticSegments,
        );
        const hit = resolveWeaponBallisticHit(path);
        const pathEnd = { ...(hit?.point ?? path[path.length - 1]?.end ?? origin) };
        ctx.renderer?.presentWeaponShot({
          hit,
          hitDecalUrl: presentation?.combat?.hitDecalUrl ?? null,
          muzzleFlash: presentation?.muzzleFlash ?? null,
          tracer: { end: pathEnd, start: origin },
        });
        if (presentation?.combat?.fireSoundUrl) playSfx(presentation.combat.fireSoundUrl);
        runtimeEvents.push({
          type: "shot",
          combat: presentation?.combat ?? null,
          direction,
          fireMode: event.fireMode,
          hit,
          origin,
          pathEnd,
          weaponId: event.weaponId,
        });
        continue;
      }
      if (event.type === "dry-fire" || event.type === "reload-started") {
        const soundUrl =
          event.type === "dry-fire"
            ? presentation?.combat?.dryFireSoundUrl
            : presentation?.combat?.reloadSoundUrl;
        if (soundUrl) playSfx(soundUrl);
        runtimeEvents.push({
          type: event.type,
          combat: presentation?.combat ?? null,
          weaponId: event.weaponId,
        });
        continue;
      }
      if (event.type === "fire-mode-changed") {
        runtimeEvents.push(event);
        continue;
      }
      if (event.type === "reload-request") {
        const requestedRounds = event.quantity;
        void consumeInventoryAmmo(firearm.ammoItemDefinitionId, requestedRounds)
          .then((response) => {
            ctx.onInventoryUpdate?.(response.inventory);
            resolveWeaponReload(state, requestedRounds);
            ctx.onWeaponCombatEvents?.([
              {
                type: "reload-completed",
                roundsLoaded: requestedRounds,
                weaponId: event.weaponId,
              },
            ]);
          })
          .catch((error: unknown) => {
            rejectWeaponReload(state);
            console.warn("Weapon reload could not consume ammunition.", error);
          });
      }
    }
    if (runtimeEvents.length > 0) ctx.onWeaponCombatEvents?.(runtimeEvents);
  }

  function currentCombatAmmoHud(): HudUpdateParams["combatAmmo"] {
    const firearm = activeFirearm();
    const inventory = ctx.getInventory();
    if (!firearm || !inventory) return null;
    const state = fireStateFor(firearm);
    return {
      fireMode: currentWeaponFireMode(state),
      magazineSize: state.magazineSize,
      reserveRounds: itemQuantity(inventory, firearm.ammoItemDefinitionId),
      roundsInMagazine: state.roundsInMagazine,
    };
  }

  function applyWeaponSlotPress(press: 1 | 2 | 3 | null): void {
    if (!press) return;
    const loadout = ctx.getInventory()?.loadout ?? ctx.getInventoryLoadout() ?? {};
    ctx.activeWeaponSlotId = resolveWeaponSlotPress(press, ctx.activeWeaponSlotId, loadout);
    deps.inventory.syncEquippedInventory();
  }

  return {
    currentAnimStance,
    currentWeaponPoseAiming,
    activeFirearm,
    updateWeaponCombat,
    currentCombatAmmoHud,
    applyWeaponSlotPress,
  };
}
