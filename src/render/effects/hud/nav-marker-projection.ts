import type { Vec3 } from '../../../types';

/**
 * Projecting nav markers into screen space, with off-screen markers pinned to
 * the viewport edge.
 *
 * A world-space 3D marker disappears the moment it leaves the frustum, which is
 * exactly when a pilot most needs it: you cannot turn toward something you can
 * no longer see. Nav mode therefore draws markers as a screen overlay — on the
 * body when it is in view, clamped to the nearest edge with a direction arrow
 * when it is not.
 *
 * Pure math, no DOM: the HUD controller owns the elements.
 */

export interface NavMarkerScreenPlacement {
  /** Position in CSS pixels from the **top-left** of the viewport. */
  x: number;
  y: number;
  /** True when the marker was clamped to the viewport edge. */
  offScreen: boolean;
  /** True when the body is behind the camera. */
  behind: boolean;
  /**
   * Direction the edge arrow should point, in radians, 0 = right and growing
   * clockwise in screen space. Meaningless when `offScreen` is false.
   */
  edgeAngleRadians: number;
}

export interface NavMarkerViewport {
  widthPx: number;
  heightPx: number;
  /** Keeps clamped markers clear of the frame; also the arrow's breathing room. */
  marginPx: number;
}

export interface NavMarkerCameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  fovYRadians: number;
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Clamp a centre-relative offset to the viewport rectangle.
 *
 * Scales the whole vector by the tightest axis rather than clamping each axis
 * independently: per-axis clamping slides a marker along the edge and points
 * the arrow somewhere the body is not. Preserving the direction keeps "turn
 * this way" honest, which is the only job an edge marker has.
 */
function clampToViewportRect(
  offsetX: number,
  offsetY: number,
  halfWidth: number,
  halfHeight: number,
): { x: number; y: number } {
  const absX = Math.abs(offsetX);
  const absY = Math.abs(offsetY);
  if (absX <= halfWidth && absY <= halfHeight) return { x: offsetX, y: offsetY };
  const scaleX = absX > 1e-6 ? halfWidth / absX : Infinity;
  const scaleY = absY > 1e-6 ? halfHeight / absY : Infinity;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return { x: 0, y: halfHeight };
  return { x: offsetX * scale, y: offsetY * scale };
}

/**
 * Screen placement for one world position.
 *
 * A body behind the camera has no valid perspective projection — dividing by a
 * negative depth mirrors it to the wrong side of the screen, which would send
 * the pilot turning away from the target. Behind-camera markers are instead
 * projected on their lateral direction alone and forced to the edge.
 */
export function projectNavMarkerToScreen(
  worldPosition: Vec3,
  cameraPosition: Vec3,
  basis: NavMarkerCameraBasis,
  viewport: NavMarkerViewport,
): NavMarkerScreenPlacement {
  const direction: Vec3 = {
    x: worldPosition.x - cameraPosition.x,
    y: worldPosition.y - cameraPosition.y,
    z: worldPosition.z - cameraPosition.z,
  };
  const depth = dot3(direction, basis.forward);
  const behind = depth <= 0;
  const lateral = dot3(direction, basis.right);
  const vertical = dot3(direction, basis.up);

  const halfWidth = Math.max(1, viewport.widthPx * 0.5 - viewport.marginPx);
  const halfHeight = Math.max(1, viewport.heightPx * 0.5 - viewport.marginPx);
  const halfFov = Math.max(0.1, basis.fovYRadians * 0.5);
  const focalPx = (viewport.heightPx * 0.5) / Math.tan(halfFov);

  let offsetX: number;
  let offsetY: number;
  if (behind) {
    // Direction only. Push well past the rectangle so the clamp below always
    // fires and lands it on the edge nearest the way the pilot must turn.
    const magnitude = Math.hypot(lateral, vertical);
    const unitX = magnitude > 1e-6 ? lateral / magnitude : 0;
    // A body directly behind has no lateral bias at all; send it to the bottom,
    // which reads as "reverse" rather than an arbitrary left or right.
    const unitY = magnitude > 1e-6 ? -vertical / magnitude : 1;
    const push = halfWidth + halfHeight;
    offsetX = unitX * push;
    offsetY = unitY * push;
  } else {
    offsetX = (lateral / depth) * focalPx;
    offsetY = (-vertical / depth) * focalPx;
  }

  const clamped = clampToViewportRect(offsetX, offsetY, halfWidth, halfHeight);
  const offScreen =
    behind || Math.abs(offsetX) > halfWidth || Math.abs(offsetY) > halfHeight;

  return {
    x: viewport.widthPx * 0.5 + clamped.x,
    y: viewport.heightPx * 0.5 + clamped.y,
    offScreen,
    behind,
    edgeAngleRadians: Math.atan2(clamped.y, clamped.x),
  };
}

/** Compact distance readout for a marker label: `840 m`, `12.4 km`, `1.2 Gm`. */
export function formatNavMarkerDistance(distanceMeters: number): string {
  const meters = Math.max(0, distanceMeters);
  if (meters < 1_000) return `${Math.round(meters)} m`;
  if (meters < 1_000_000) return `${(meters / 1_000).toFixed(1)} km`;
  if (meters < 1_000_000_000) return `${(meters / 1_000_000).toFixed(1)} Mm`;
  return `${(meters / 1_000_000_000).toFixed(2)} Gm`;
}
