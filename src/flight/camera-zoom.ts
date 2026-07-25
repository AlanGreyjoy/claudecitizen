export const DEFAULT_CAMERA_ZOOM = 7.4;
export const MIN_CAMERA_ZOOM = 1.5;
export const MAX_CAMERA_ZOOM = 30;

export const DEFAULT_SHIP_CAMERA_ZOOM = 1.0;
export const MIN_SHIP_CAMERA_ZOOM = 0.45;
export const MAX_SHIP_CAMERA_ZOOM = 2.2;

export const ZOOM_SMOOTHNESS = 12;

const ZOOM_BASE = 0.94;
const ZOOM_SENSITIVITY = 1;

export function clampCameraZoom(distance: number): number {
  return Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, distance));
}

export function clampShipCameraZoom(distance: number): number {
  return Math.max(MIN_SHIP_CAMERA_ZOOM, Math.min(MAX_SHIP_CAMERA_ZOOM, distance));
}

export function normalizeWheelDelta(event: WheelEvent): number {
  let delta = event.deltaY;
  switch (event.deltaMode) {
    case 1:
      delta *= 16;
      break;
    case 2:
      delta *= 100;
      break;
  }
  if (event.ctrlKey) delta *= 10;
  return delta;
}

function applyWheelZoomWithClamp(
  distance: number,
  deltaY: number,
  clampFn: (value: number) => number,
): number {
  if (deltaY === 0) return distance;
  const factor = Math.pow(ZOOM_BASE, ZOOM_SENSITIVITY * Math.abs(deltaY) * 0.01);
  const next = deltaY > 0 ? distance / factor : distance * factor;
  return clampFn(next);
}

export function applyWheelZoom(distance: number, deltaY: number): number {
  return applyWheelZoomWithClamp(distance, deltaY, clampCameraZoom);
}

export function applyShipWheelZoom(distance: number, deltaY: number): number {
  return applyWheelZoomWithClamp(distance, deltaY, clampShipCameraZoom);
}

export function updateSmoothZoom(
  current: number,
  target: number,
  dt: number,
  smoothness = ZOOM_SMOOTHNESS,
): number {
  if (dt <= 0) return current;
  const blend = 1 - Math.exp(-smoothness * dt);
  return current + (target - current) * blend;
}
