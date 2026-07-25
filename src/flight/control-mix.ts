import type { CharacterInput, FlightInput } from '../types';
import {
  DEFAULT_KEYBOARD_BINDINGS,
  isKeyboardActionActive,
  type KeyboardActionId,
  type KeyboardBindings,
} from './input_settings';

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function actionAxis(
  keys: Set<string>,
  bindings: KeyboardBindings,
  positive: KeyboardActionId,
  negative: KeyboardActionId,
): number {
  return (
    (isKeyboardActionActive(keys, positive, bindings) ? 1 : 0) +
    (isKeyboardActionActive(keys, negative, bindings) ? -1 : 0)
  );
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
  bindings: KeyboardBindings = DEFAULT_KEYBOARD_BINDINGS,
): CharacterInput {
  return {
    cameraPitchRadians: orbitLook.pitchRadians ?? -0.35,
    cameraYawRadians: orbitLook.yawRadians ?? 0,
    cameraZoomDistance: orbitLook.zoomDistance,
    moveX: actionAxis(keys, bindings, 'strafeRight', 'strafeLeft'),
    moveY: actionAxis(keys, bindings, 'moveForward', 'moveBackward'),
    sprint: isKeyboardActionActive(keys, 'sprintBoost', bindings),
    crouch: isKeyboardActionActive(keys, 'crouch', bindings),
  };
}

export function buildFlightInput(
  keys: Set<string>,
  mouseLook: MouseLook = { pitch01: 0, yaw01: 0 },
  bindings: KeyboardBindings = DEFAULT_KEYBOARD_BINDINGS,
): FlightInput {
  return {
    brake01: isKeyboardActionActive(keys, 'brake', bindings) ? 1 : 0,
    boost01: isKeyboardActionActive(keys, 'sprintBoost', bindings) ? 1 : 0,
    lift01: actionAxis(keys, bindings, 'liftUp', 'liftDown'),
    pitch01: clampAxis(actionAxis(keys, bindings, 'pitchUp', 'pitchDown') + (mouseLook.pitch01 ?? 0)),
    roll01: actionAxis(keys, bindings, 'rollRight', 'rollLeft'),
    strafe01: actionAxis(keys, bindings, 'strafeRight', 'strafeLeft'),
    throttle01: actionAxis(keys, bindings, 'moveForward', 'moveBackward'),
    yaw01: clampAxis(actionAxis(keys, bindings, 'yawRight', 'yawLeft') + (mouseLook.yaw01 ?? 0)),
  };
}
