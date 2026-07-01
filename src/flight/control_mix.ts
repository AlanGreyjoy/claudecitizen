import type { CharacterInput, FlightInput } from '../types';

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function axis(keys: Set<string>, positive: string, negative: string): number {
  return (keys.has(positive) ? 1 : 0) + (keys.has(negative) ? -1 : 0);
}

interface OrbitLook {
  pitchRadians?: number;
  yawRadians?: number;
  zoomDistance?: number;
}

interface MouseLook {
  pitch01?: number;
  yaw01?: number;
}

export function buildCharacterInput(
  keys: Set<string>,
  orbitLook: OrbitLook = { pitchRadians: -0.35, yawRadians: 0 },
): CharacterInput {
  return {
    cameraPitchRadians: orbitLook.pitchRadians ?? -0.35,
    cameraYawRadians: orbitLook.yawRadians ?? 0,
    cameraZoomDistance: orbitLook.zoomDistance,
    moveX: axis(keys, 'KeyD', 'KeyA'),
    moveY: axis(keys, 'KeyW', 'KeyS'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

export function buildFlightInput(keys: Set<string>, mouseLook: MouseLook = { pitch01: 0, yaw01: 0 }): FlightInput {
  return {
    brake01: keys.has('KeyB') ? 1 : 0,
    boost01: keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0,
    lift01: axis(keys, 'Space', 'KeyC'),
    pitch01: clampAxis(axis(keys, 'ArrowUp', 'ArrowDown') + (mouseLook.pitch01 ?? 0)),
    roll01: axis(keys, 'KeyE', 'KeyQ'),
    strafe01: axis(keys, 'KeyD', 'KeyA'),
    throttle01: axis(keys, 'KeyW', 'KeyS'),
    yaw01: clampAxis(axis(keys, 'ArrowRight', 'ArrowLeft') + (mouseLook.yaw01 ?? 0)),
  };
}
