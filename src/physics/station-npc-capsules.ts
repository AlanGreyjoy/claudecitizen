import * as RAPIER from "@dimforge/rapier3d";
import type { StationLocalPoint } from "../world/station";
import {
  castRapierWorldRay,
  createNpcCapsule,
  NPC_CAPSULE_HEIGHT,
  NPC_CAPSULE_RADIUS,
  QUERY_GROUPS_EXCLUDE_NPCS,
  type NpcCapsuleHandle,
} from "./rapier-world";

/**
 * Rapier-side half of station NPC collision. Two jobs, both deliberately cheap:
 *
 * 1. `sync` parks one kinematic capsule per live NPC so the player's character
 *    controller has something to slide along. No character controller runs for
 *    the NPCs themselves — that would cost a `computeColliderMovement` per actor
 *    per frame (~1-2 ms at the 32-actor cap) to reproduce motion the analytic
 *    wander step already produces for free.
 * 2. `isPathClear` sweeps the NPC capsule along a candidate wander segment so
 *    the population can reject targets it would have to walk through a wall to
 *    reach. Validating the line up front means the walk itself needs no
 *    per-frame collision at all.
 */
export interface StationNpcBodies {
  /** Positions are station-local floor points, in the same order every frame. */
  sync(localPositions: readonly StationLocalPoint[]): void;
  /** True when a capsule can walk the straight segment `from` → `to`. */
  isPathClear(from: StationLocalPoint, to: StationLocalPoint): boolean;
  /**
   * Station-local height of the floor under `point`, or null when there is no
   * surface within reach. Roam targets are drawn on a flat disc around the spawn
   * marker, so without this every actor walks at its marker's height — over
   * steps, off mezzanine edges, and through the air past the room it started in.
   */
  sampleFloorHeight(point: StationLocalPoint): number | null;
  dispose(): void;
}

/** Below this a candidate segment is treated as a no-op and trivially clear. */
const MIN_PROBE_DISTANCE_METERS = 1e-3;
/** Parking spot for surplus capsules, far outside any authored station volume. */
const PARKED_HEIGHT_METERS = -10_000;
/**
 * How far the swept probe capsule is lifted off the floor.
 *
 * Load-bearing: the collision capsule's bottom sits exactly on the floor plane,
 * and `castShape` reports `time_of_impact = 0` for a shape already in contact at
 * the start of the sweep. A floor-hugging probe therefore reports an instant hit
 * on the floor for every candidate — which reads as either "always blocked" or,
 * with the embedded-actor escape hatch below, "always clear". Lifting the sweep
 * leaves only walls and props in its path. It doubles as the step tolerance:
 * anything shorter than this is walked over rather than treated as a wall.
 */
const PROBE_GROUND_CLEARANCE_METERS = 0.2;
const PROBE_CAPSULE_HEIGHT = NPC_CAPSULE_HEIGHT - PROBE_GROUND_CLEARANCE_METERS;
const PROBE_CAPSULE_CENTER_METERS =
  PROBE_GROUND_CLEARANCE_METERS + PROBE_CAPSULE_HEIGHT / 2;
/** Upward slack so a candidate drawn just under a step still finds its floor. */
const FLOOR_PROBE_UP_METERS = 1;
/** Downward reach; the population rejects drops it considers too steep to take. */
const FLOOR_PROBE_DOWN_METERS = 3;

// One WASM-backed shape reused for every probe; a per-call `new` would leak.
let probeShape: RAPIER.Capsule | null = null;

function npcProbeShape(): RAPIER.Capsule {
  if (!probeShape) {
    probeShape = new RAPIER.Capsule(
      PROBE_CAPSULE_HEIGHT / 2 - NPC_CAPSULE_RADIUS,
      NPC_CAPSULE_RADIUS,
    );
  }
  return probeShape;
}

export function createStationNpcBodies(
  world: RAPIER.World,
  excludeCollider?: RAPIER.Collider,
): StationNpcBodies {
  const capsules: NpcCapsuleHandle[] = [];
  // Preallocated so neither the per-frame sync nor a probe allocates.
  const origin = { x: 0, y: 0, z: 0 };
  const direction = { x: 0, y: 0, z: 0 };
  const identityRotation = { w: 1, x: 0, y: 0, z: 0 };

  function capsuleAt(index: number): NpcCapsuleHandle {
    const existing = capsules[index];
    if (existing) return existing;
    const created = createNpcCapsule(world, {
      x: 0,
      y: PARKED_HEIGHT_METERS,
      z: 0,
    });
    capsules[index] = created;
    return created;
  }

  return {
    sync(localPositions) {
      for (let index = 0; index < localPositions.length; index += 1) {
        const local = localPositions[index];
        const capsule = capsuleAt(index);
        capsule.collider.setEnabled(true);
        capsule.body.setTranslation(
          { x: local.right, y: local.up, z: local.forward },
          true,
        );
      }
      // Population shrinks on reset; leave the surplus bodies allocated but
      // inert so a later reset does not have to rebuild them.
      for (let index = localPositions.length; index < capsules.length; index += 1) {
        capsules[index].collider.setEnabled(false);
      }
    },

    isPathClear(from, to) {
      const dx = to.right - from.right;
      const dz = to.forward - from.forward;
      const distance = Math.hypot(dx, dz);
      if (distance < MIN_PROBE_DISTANCE_METERS) return true;
      origin.x = from.right;
      origin.y = from.up + PROBE_CAPSULE_CENTER_METERS;
      origin.z = from.forward;
      direction.x = dx / distance;
      direction.y = 0;
      direction.z = dz / distance;
      const hit = world.castShape(
        origin,
        identityRotation,
        direction,
        npcProbeShape(),
        0,
        distance,
        true,
        undefined,
        QUERY_GROUPS_EXCLUDE_NPCS,
        excludeCollider,
      );
      if (!hit) return true;
      // A zero time-of-impact means the lifted capsule is already embedded in
      // geometry at the start of the sweep — an NPC authored inside a wall or
      // prop. Rejecting every target from there would freeze the actor forever,
      // so accept and let it walk out.
      return hit.time_of_impact <= 0;
    },

    sampleFloorHeight(point) {
      origin.x = point.right;
      origin.y = point.up + FLOOR_PROBE_UP_METERS;
      origin.z = point.forward;
      direction.x = 0;
      direction.y = -1;
      direction.z = 0;
      const hit = castRapierWorldRay(
        world,
        origin,
        direction,
        FLOOR_PROBE_UP_METERS + FLOOR_PROBE_DOWN_METERS,
        excludeCollider,
        QUERY_GROUPS_EXCLUDE_NPCS,
      );
      return hit ? hit.point.y : null;
    },

    dispose() {
      for (const capsule of capsules) {
        world.removeCollider(capsule.collider, false);
        world.removeRigidBody(capsule.body);
      }
      capsules.length = 0;
    },
  };
}
