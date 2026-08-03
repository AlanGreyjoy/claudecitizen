import { rotateVec3ByQuat } from '../math/quat';
import { add, normalize, scale } from '../math/vec3';
import type { Vec3 } from '../types';
import {
  stationLocalToWorld,
  type StationFrame,
  type StationHangarOpenSpaceExitMarker,
} from './station';

export interface HangarOpenSpaceExitWorldPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/**
 * World pose a ship should take when flying out of a station's hangar mouth.
 *
 * Marker rotation is in prefab/scene space (same as AVMS screens); local +Z is
 * the exit facing. Station-local axes map right = -x, up = y, forward = z.
 */
export function hangarOpenSpaceExitWorldPose(
  frame: StationFrame,
  marker: StationHangarOpenSpaceExitMarker,
): HangarOpenSpaceExitWorldPose {
  const local = rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, marker.rotation);
  const forward = normalize(
    add(
      add(scale(frame.right, -local.x), scale(frame.up, local.y)),
      scale(frame.forward, local.z),
    ),
  );
  return {
    position: stationLocalToWorld(frame, {
      right: marker.right,
      up: marker.up,
      forward: marker.forward,
    }),
    forward,
    up: frame.up,
  };
}
