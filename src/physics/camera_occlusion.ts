import * as RAPIER from "@dimforge/rapier3d";

/**
 * Third-person camera collision via a sphere cast against a Rapier world.
 *
 * The cast runs from the camera's look pivot toward the desired camera
 * position; the first blocking collider pulls the camera in front of it so
 * the rendered eye never ends up inside geometry. All coordinates are in
 * the Rapier world's own space (station-local, ship-local, or the planet
 * world's floating origin) — callers transform in and back out.
 */

/** Camera collision sphere radius. Keeps the near plane out of walls. */
const CAMERA_OCCLUSION_RADIUS_METERS = 0.22;
/** Extra pull-in past the first hit so the sphere never touches geometry. */
const CAMERA_OCCLUSION_MARGIN_METERS = 0.05;
/** Closest the occlusion clamp may bring the camera to the look pivot. */
const CAMERA_OCCLUSION_MIN_DISTANCE_METERS = 0.35;
/**
 * Rapier's `castShape` target distance is a proximity threshold: a hit is
 * reported as soon as the swept shape comes within this distance of any
 * collider (toi = 0 when already within at the start). It must be 0 here —
 * passing the camera distance makes the nearby floor/walls "hit" instantly
 * every frame and pins the camera against the pivot. Zero reports actual
 * contact only; `maxToi` below limits the travel distance instead.
 */
const CAMERA_OCCLUSION_TARGET_DISTANCE_METERS = 0;

export interface CameraOcclusionCastOptions {
  /** Collider to ignore — typically the player capsule at the look pivot. */
  excludeCollider?: RAPIER.Collider;
}

// One WASM-backed shape reused for every cast (per-frame `new` would leak).
let cameraShape: RAPIER.Ball | null = null;

function cameraOcclusionShape(): RAPIER.Ball {
  if (!cameraShape) {
    cameraShape = new RAPIER.Ball(CAMERA_OCCLUSION_RADIUS_METERS);
  }
  return cameraShape;
}

/**
 * Returns `to` pulled in front of the first collider hit along the segment
 * `from` → `to`, or `to` unchanged when the line of sight is clear.
 */
export function castCameraOcclusion(
  world: RAPIER.World,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  options: CameraOcclusionCastOptions = {},
): { x: number; y: number; z: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= CAMERA_OCCLUSION_MIN_DISTANCE_METERS) return to;

  const invDistance = 1 / distance;
  const direction = {
    x: dx * invDistance,
    y: dy * invDistance,
    z: dz * invDistance,
  };
  const hit = world.castShape(
    from,
    { w: 1, x: 0, y: 0, z: 0 },
    direction,
    cameraOcclusionShape(),
    CAMERA_OCCLUSION_TARGET_DISTANCE_METERS,
    distance,
    true,
    undefined,
    undefined,
    options.excludeCollider,
  );
  if (!hit || !Number.isFinite(hit.time_of_impact)) return to;

  const clampedDistance = Math.max(
    CAMERA_OCCLUSION_MIN_DISTANCE_METERS,
    Math.min(distance, hit.time_of_impact - CAMERA_OCCLUSION_MARGIN_METERS),
  );
  return {
    x: from.x + direction.x * clampedDistance,
    y: from.y + direction.y * clampedDistance,
    z: from.z + direction.z * clampedDistance,
  };
}
