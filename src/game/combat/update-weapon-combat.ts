import {
  itemQuantity,
  type WeaponFireMode,
} from "../../player/inventory/types";
import {
  advanceWeaponFire,
  createWeaponFireState,
  rejectWeaponReload,
  resolveWeaponReload,
  type WeaponFireState,
} from "../../player/weapon_fire";
import { buildBallisticPath } from "../../player/weapon_ballistics";
import { normalize } from "../../math/vec3";
import { playSfx } from "../../audio/sfx";
import { consumeInventoryAmmo } from "../../net/api";
import type { Vec3 } from "../../types";
import type { WeaponCombatRuntimeEvent } from "../types";
import type { LoopContext } from "../loop_context";
import type { ActiveFirearm } from "./resolve_active_firearm";
import {
  fallbackWeaponPose,
  resolveWeaponBallisticHit,
} from "./weapon_hit_resolution";

export interface WeaponCombatActions {
  cycleWeaponFireModePressed: boolean;
  primaryClickHeld: boolean;
  primaryClickPressed: boolean;
  reloadWeaponPressed: boolean;
}

type WeaponPresentation = NonNullable<
  ReturnType<NonNullable<LoopContext["renderer"]>["getActiveWeaponWorldPose"]>
>;

export function fireStateFor(
  ctx: LoopContext,
  firearm: ActiveFirearm,
): WeaponFireState {
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

function shotPathEnd(
  hitPoint: Vec3 | undefined,
  path: ReturnType<typeof buildBallisticPath>,
  origin: Vec3,
): Vec3 {
  if (hitPoint) return { ...hitPoint };
  const last = path[path.length - 1];
  if (last) return { ...last.end };
  return { ...origin };
}

function presentShot(args: {
  ctx: LoopContext;
  firearm: ActiveFirearm;
  origin: Vec3;
  direction: Vec3;
  event: { fireMode: WeaponFireMode; weaponId: string };
  presentation: WeaponPresentation | null;
}): WeaponCombatRuntimeEvent {
  const { ctx, firearm, origin, direction, event, presentation } = args;
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
  const hit = resolveWeaponBallisticHit(ctx, path);
  const pathEnd = shotPathEnd(hit?.point, path, origin);
  const combat = presentation?.combat ?? null;
  ctx.renderer?.presentWeaponShot({
    hit,
    hitDecalUrl: combat?.hitDecalUrl ?? null,
    muzzleFlash: presentation?.muzzleFlash ?? null,
    tracer: { end: pathEnd, start: origin },
  });
  if (combat?.fireSoundUrl) playSfx(combat.fireSoundUrl);
  return {
    type: "shot",
    combat,
    direction,
    fireMode: event.fireMode,
    hit,
    origin,
    pathEnd,
    weaponId: event.weaponId,
  };
}

function handleReloadRequest(
  ctx: LoopContext,
  firearm: ActiveFirearm,
  state: WeaponFireState,
  event: { quantity: number; weaponId: string },
): void {
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

function processFireEvent(args: {
  ctx: LoopContext;
  firearm: ActiveFirearm;
  state: WeaponFireState;
  event: ReturnType<typeof advanceWeaponFire>[number];
  origin: Vec3;
  direction: Vec3;
  presentation: WeaponPresentation | null;
  runtimeEvents: WeaponCombatRuntimeEvent[];
}): void {
  const {
    ctx,
    firearm,
    state,
    event,
    origin,
    direction,
    presentation,
    runtimeEvents,
  } = args;
  if (event.type === "shot") {
    runtimeEvents.push(
      presentShot({ ctx, firearm, origin, direction, event, presentation }),
    );
    return;
  }
  if (event.type === "dry-fire" || event.type === "reload-started") {
    const combat = presentation?.combat ?? null;
    const soundUrl =
      event.type === "dry-fire" ? combat?.dryFireSoundUrl : combat?.reloadSoundUrl;
    if (soundUrl) playSfx(soundUrl);
    runtimeEvents.push({
      type: event.type,
      combat,
      weaponId: event.weaponId,
    });
    return;
  }
  if (event.type === "fire-mode-changed") {
    runtimeEvents.push(event);
    return;
  }
  if (event.type === "reload-request") {
    handleReloadRequest(ctx, firearm, state, event);
  }
}

/** Advance fire state and present shot / reload / dry-fire events. */
export function updateWeaponCombat(
  ctx: LoopContext,
  firearm: ActiveFirearm,
  actions: WeaponCombatActions,
  dt: number,
): void {
  const inventory = ctx.getInventory();
  if (!inventory) return;
  const state = fireStateFor(ctx, firearm);
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
  const fallback = fallbackWeaponPose(ctx);
  const marker = presentation?.barrelEnd;
  const origin = marker?.position ?? fallback.origin;
  const direction = normalize(marker?.forward ?? fallback.direction);
  const runtimeEvents: WeaponCombatRuntimeEvent[] = [];

  for (const event of fireEvents) {
    processFireEvent({
      ctx,
      firearm,
      state,
      event,
      origin,
      direction,
      presentation,
      runtimeEvents,
    });
  }
  if (runtimeEvents.length > 0) ctx.onWeaponCombatEvents?.(runtimeEvents);
}
