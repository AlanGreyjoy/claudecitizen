import { getActiveShipBody } from "../../player/world_state";
import { worldToShipLocal } from "../../player/ship_interaction";
import {
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  teleportShipPlayerLocal,
} from "../../physics/ship_physics";
import { sampleFootPlanetSurface } from "../../world/planet_surface";
import { radialUp, surfacePointFromPosition } from "../../world/coordinates";
import { CHARACTER_GROUND_OFFSET_METERS } from "../../player/character_controller";
import { dot, sub } from "../../math/vec3";
import type { DeckCharacterState } from "../../player/ship_deck";
import type { Vec3 } from "../../types";
import type { LoopContext } from "../loop_context";

/** Height above planet foot surface along radial up (meters). */
export function planetFeetHeightAbove(
  ctx: LoopContext,
  position: Vec3,
): number {
  const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, position);
  const groundWorld = surfacePointFromPosition(
    position,
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
  return dot(sub(position, groundWorld), radialUp(position));
}

export function isPlanetFeetGrounded(
  ctx: LoopContext,
  position: Vec3,
  verticalVelocity: number,
): boolean {
  if (verticalVelocity > 0.15) return false;
  return planetFeetHeightAbove(ctx, position) <= 0.22;
}

/**
 * Exterior near-ship: keep Rapier XY (hull collision), stick to / land on
 * planet terrain. Does not kill jumps mid-air.
 */
export function syncShipExteriorFeetToPlanet(ctx: LoopContext): void {
  if (!ctx.shipPhysics) return;
  const ship = getActiveShipBody(ctx.world);
  const deck = ctx.world.character as DeckCharacterState;
  const verticalVel = deck.shipVerticalVelocity ?? 0;
  const local = getShipPlayerLocal(ctx.shipPhysics);
  const approxWorld = getShipPlayerWorldPosition(ctx.shipPhysics, ship);
  const up = radialUp(approxWorld);
  const heightAbove = planetFeetHeightAbove(ctx, approxWorld);

  if (verticalVel > 0.15 || heightAbove > 0.35) {
    ctx.world.character = {
      ...deck,
      position: approxWorld,
      up,
      grounded: false,
      airborneOffDeckFrames: 0,
      shipVerticalVelocity: verticalVel,
    };
    return;
  }

  const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, approxWorld);
  const groundWorld = surfacePointFromPosition(
    approxWorld,
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
  const groundLocal = worldToShipLocal(ship, groundWorld);
  teleportShipPlayerLocal(ctx.shipPhysics, {
    right: local.right,
    up: groundLocal.up,
    forward: local.forward,
  });
  const position = getShipPlayerWorldPosition(ctx.shipPhysics, ship);
  ctx.world.character = {
    ...deck,
    position,
    up: radialUp(position),
    grounded: true,
    jumpPhase: "grounded",
    airborneOffDeckFrames: 0,
    shipVerticalVelocity: 0,
  };
}
