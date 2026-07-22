import { CHARACTER_EYE_HEIGHT_METERS } from "../player/character_controller";
import { characterHeadLookTowardPoint } from "../player/screen_hotspot";
import { add, normalize, scale } from "../math/vec3";
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

function eyeWorld(position: Vec3, up: Vec3): Vec3 {
  return add(position, scale(normalize(up), CHARACTER_EYE_HEIGHT_METERS));
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

/**
 * Annotates each NPC with a Head-bone look toward the player when in range
 * and within the neck cone. Returns the input array unchanged when nobody
 * needs a look (avoids a copy on the quiet path).
 */
export function annotateNpcHeadLookTowardPlayer(
  npcs: readonly StationNpcRenderState[],
  playerPosition: Vec3,
  playerUp: Vec3,
): StationNpcRenderState[] {
  if (npcs.length === 0) return npcs as StationNpcRenderState[];

  const playerEye = eyeWorld(playerPosition, playerUp);
  let anyLook = false;
  const out: StationNpcRenderState[] = new Array(npcs.length);

  for (let i = 0; i < npcs.length; i += 1) {
    const npc = npcs[i]!;
    if (distanceSquared(npc.position, playerPosition) > NPC_PLAYER_LOOK_DISTANCE_SQUARED) {
      out[i] = npc;
      continue;
    }

    const headLook = characterHeadLookTowardPoint(
      npc.forward,
      npc.up,
      eyeWorld(npc.position, npc.up),
      playerEye,
      NPC_LOOK_MAX_YAW,
      NPC_LOOK_MAX_PITCH,
    );
    if (!headLook) {
      out[i] = npc;
      continue;
    }

    out[i] = { ...npc, headLook };
    anyLook = true;
  }

  return anyLook ? out : (npcs as StationNpcRenderState[]);
}
