import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import { getActiveShipBody } from "../../player/world_state";
import {
  resolveBallisticHit,
  type BallisticSegment,
  type WeaponGeometryHit,
} from "../../player/weapon_ballistics";
import {
  resolveStationWalkView,
  stationWalkAimOriginWorld,
} from "../../player/weapon_shop_gaze";
import { castStationWorldRay } from "../../physics/station_physics";
import { castShipWorldRay } from "../../physics/ship_physics";
import { castTerrainPath } from "../../world/planet_surface";
import type { Vec3 } from "../../types";
import type { LoopContext } from "../loop_context";

export function fallbackWeaponPose(
  ctx: LoopContext,
): { direction: Vec3; origin: Vec3 } {
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

export function resolveWeaponWorldHit(
  ctx: LoopContext,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
): WeaponGeometryHit | null {
  if (ctx.world.mode === MODE_IN_STATION && ctx.physics) {
    const hit = castStationWorldRay(
      ctx.physics,
      ctx.stationFrame,
      origin,
      direction,
      maxDistance,
    );
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

export function resolveWeaponBallisticHit(
  ctx: LoopContext,
  path: readonly BallisticSegment[],
): WeaponGeometryHit | null {
  if (ctx.world.mode === MODE_ON_FOOT) {
    const hit = castTerrainPath(ctx.planet, ctx.seed, path);
    return hit ? { ...hit, surfaceKind: "terrain" } : null;
  }
  return resolveBallisticHit(path, (origin, direction, maxDistance) =>
    resolveWeaponWorldHit(ctx, origin, direction, maxDistance),
  );
}
