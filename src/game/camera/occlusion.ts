import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_RIDING_ELEVATOR,
} from "../../player/modes";
import { getActiveShipBody } from "../../player/world_state";
import { occludeStationCamera } from "../../physics/station_physics";
import { occludeShipCamera } from "../../physics/ship_physics";
import type { Vec3 } from "../../types";
import type { LoopContext } from "../loop_context";

export interface CameraOcclusion {
  resolveCameraOcclusion: (from: Vec3, to: Vec3) => Vec3;
}

/**
 * Camera-collision query handed to the renderer: sphere-cast from the look
 * pivot toward the desired camera position against every Rapier world the
 * character may be walking in, and keep the closest blocking hit.
 */
export function createCameraOcclusion(ctx: LoopContext): CameraOcclusion {
  function resolveCameraOcclusion(from: Vec3, to: Vec3): Vec3 {
    let best = to;
    let bestDistanceSq =
      (to.x - from.x) * (to.x - from.x) +
      (to.y - from.y) * (to.y - from.y) +
      (to.z - from.z) * (to.z - from.z);
    const consider = (candidate: Vec3): void => {
      const dx = candidate.x - from.x;
      const dy = candidate.y - from.y;
      const dz = candidate.z - from.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = candidate;
      }
    };
    const mode = ctx.world.mode;
    if ((mode === MODE_IN_STATION || mode === MODE_RIDING_ELEVATOR) && ctx.physics) {
      consider(occludeStationCamera(ctx.physics, ctx.stationFrame, from, to));
    }
    // Deck walking, hull/pad exterior walk, and seat/bed transitions all
    // live in the ship-local Rapier world. On foot or in a hangar the
    // parked hull can still block the orbit camera, so cast whenever the
    // ship world exists (a distant ship simply misses the cast).
    if (ctx.shipPhysics) {
      consider(occludeShipCamera(ctx.shipPhysics, getActiveShipBody(ctx.world), from, to));
    }
    if (mode === MODE_ON_FOOT && ctx.planetPhysics) {
      consider(ctx.planetPhysics.filterCamera(from, to));
    }
    return best;
  }

  return { resolveCameraOcclusion };
}
