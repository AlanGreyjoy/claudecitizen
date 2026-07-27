import { CHARACTER_EYE_HEIGHT_METERS } from "../player/character-controller";
import { characterHeadLookTowardPoint } from "../player/screen-hotspot";
import type { StationNpcRenderState, Vec3 } from "../types";

/**
 * Cosmetic ambient NPC head-look toward the local player. Domain stays
 * non-authoritative — this only annotates render states.
 */

/** Engage Head-bone look inside this distance (m). */
export const NPC_PLAYER_LOOK_DISTANCE_METERS = 10;
const NPC_PLAYER_LOOK_DISTANCE_SQUARED =
  NPC_PLAYER_LOOK_DISTANCE_METERS * NPC_PLAYER_LOOK_DISTANCE_METERS;

/** Slightly wider neck than vendor-screen hotspots. */
const NPC_LOOK_MAX_YAW = (65 * Math.PI) / 180;
const NPC_LOOK_MAX_PITCH = (30 * Math.PI) / 180;

/** Scratch eye positions; this runs once per animation frame per NPC. */
const playerEye: Vec3 = { x: 0, y: 0, z: 0 };
const npcEye: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Allocation-free `position + normalize(up) * eyeHeight`, including
 * `normalize`'s straight-up fallback for a degenerate up vector.
 */
function writeEyeWorld(position: Vec3, up: Vec3, out: Vec3): Vec3 {
  const length = Math.hypot(up.x, up.y, up.z);
  const degenerate = length < 1e-9;
  const inverseLength = degenerate ? 0 : 1 / length;
  out.x = position.x + up.x * inverseLength * CHARACTER_EYE_HEIGHT_METERS;
  out.y = degenerate
    ? position.y + CHARACTER_EYE_HEIGHT_METERS
    : position.y + up.y * inverseLength * CHARACTER_EYE_HEIGHT_METERS;
  out.z = position.z + up.z * inverseLength * CHARACTER_EYE_HEIGHT_METERS;
  return out;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

/**
 * Sets each NPC's Head-bone look toward the player when in range and within the
 * neck cone, and clears it otherwise. Mutates in place: the caller owns a pooled
 * render-state array and both a copy and a fresh array would be per-frame
 * garbage on the main thread.
 */
export function annotateNpcHeadLookTowardPlayer(
  npcs: readonly StationNpcRenderState[],
  playerPosition: Vec3,
  playerUp: Vec3,
): void {
  if (npcs.length === 0) return;
  writeEyeWorld(playerPosition, playerUp, playerEye);

  for (const npc of npcs) {
    if (distanceSquared(npc.position, playerPosition) > NPC_PLAYER_LOOK_DISTANCE_SQUARED) {
      npc.headLook = null;
      continue;
    }
    npc.headLook = characterHeadLookTowardPoint(
      npc.forward,
      npc.up,
      writeEyeWorld(npc.position, npc.up, npcEye),
      playerEye,
      NPC_LOOK_MAX_YAW,
      NPC_LOOK_MAX_PITCH,
    );
  }
}
