import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type GameSettings,
} from '../app/game_settings';
import type { CameraView, FlightInput, GameMode, ShipCameraView } from '../types';
import {
  applyShipWheelZoom,
  applyWheelZoom,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_SHIP_CAMERA_ZOOM,
  normalizeWheelDelta,
  updateSmoothZoom,
} from './camera_zoom';
import { buildCharacterInput, buildFlightInput } from './control_mix';
import { FIRST_PERSON_PITCH_LIMIT, ORBIT_PITCH_LIMIT } from '../player/character_controller';
import {
  getKeyboardBindingCodes,
  formatKeyboardBinding,
  isKeyboardActionActive,
  isKeyboardCodeForAction,
  isLikelyHotasGamepad,
  type DeviceButtonActionId,
  type DeviceInputBinding,
  type DeviceInputProfileSettings,
  type DeviceProfileId,
  type FlightAnalogControlId,
  type KeyboardActionId,
} from './input_settings';

const EXIT_SEAT_HOLD_SECONDS = 0.5;
const SEAT_LOOK_SNAP_HALF_LIFE_SECONDS = 0.35;
const SEAT_LOOK_YAW_SENSITIVITY = 0.0035;
const SEAT_LOOK_PITCH_SENSITIVITY = 0.0028;
const ORBIT_GAMEPAD_YAW_RATE = 2.4;
const ORBIT_GAMEPAD_PITCH_RATE = 1.8;
const PROFILE_IDS: readonly DeviceProfileId[] = ['controller', 'hotas'];
const ONE_SHOT_KEYBOARD_ACTIONS: readonly KeyboardActionId[] = [
  'interact',
  'jump',
  'hangar1',
  'hangar2',
  'hangar3',
  'hangarBuild',
  'hangarRotate',
  'hangarCancel',
];
const FLIGHT_INPUT_FIELDS: Record<FlightAnalogControlId, keyof FlightInput> = {
  lift: 'lift01',
  pitch: 'pitch01',
  roll: 'roll01',
  strafe: 'strafe01',
  throttle: 'throttle01',
  yaw: 'yaw01',
};

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clampPitch(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / Math.max(0.0001, 1 - deadzone);
  return Math.sign(value) * scaled;
}

function mergeAxis(current: number | undefined, next: number): number {
  return clampAxis((current ?? 0) + next);
}

interface PlayerControlsOptions {
  onReset?: () => void;
}

export function createPlayerControls(canvas: HTMLCanvasElement, { onReset }: PlayerControlsOptions = {}) {
  const keys = new Set<string>();
  const justPressed = new Set<string>();
  const deviceActionStates = new Map<string, boolean>();
  const flightLook = { pitch01: 0, yaw01: 0 };
  const seatLook = { pitchRadians: 0, yawRadians: 0 };
  const orbitLook = {
    pitchRadians: -0.35,
    yawRadians: 0,
    zoomDistance: DEFAULT_CAMERA_ZOOM,
    targetZoomDistance: DEFAULT_CAMERA_ZOOM,
  };
  const shipLook = {
    zoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
    targetZoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
  };
  let mode: GameMode | 'on-foot' | 'in-ship' = 'on-foot';
  let cameraView: CameraView = 'first-person';
  let shipCameraView: ShipCameraView = 'cockpit';
  let yHeldSinceMs: number | null = null;
  let exitSeatTriggered = false;
  let settings: GameSettings = loadGameSettings();
  let inputSuppressed = false;

  function inputSettings() {
    return settings.input;
  }

  function keyboardBindings() {
    return inputSettings().mouseKeyboard.bindings;
  }

  function isHandledKey(code: string): boolean {
    return Object.values(keyboardBindings()).some(
      (binding) => binding.primary === code || binding.secondary === code,
    );
  }

  function isKeyboardActionDown(action: KeyboardActionId): boolean {
    return isKeyboardActionActive(keys, action, keyboardBindings());
  }

  function isKeyboardCode(action: KeyboardActionId, code: string): boolean {
    return isKeyboardCodeForAction(code, action, keyboardBindings());
  }

  function wasKeyboardActionPressed(action: KeyboardActionId): boolean {
    return getKeyboardBindingCodes(keyboardBindings(), action).some((code) => justPressed.has(code));
  }

  function getGamepads(): Gamepad[] {
    return Array.from(navigator.getGamepads?.() ?? []).filter((gamepad): gamepad is Gamepad =>
      Boolean(gamepad),
    );
  }

  function getProfile(profileId: DeviceProfileId): DeviceInputProfileSettings {
    return inputSettings()[profileId];
  }

  function gamepadMatchesProfile(
    gamepad: Gamepad,
    profileId: DeviceProfileId,
    binding: DeviceInputBinding | null,
  ): boolean {
    if (binding?.deviceId) return gamepad.id === binding.deviceId;
    if (binding?.deviceIndex !== undefined) return gamepad.index === binding.deviceIndex;
    const hotas = isLikelyHotasGamepad(gamepad);
    return profileId === 'hotas' ? hotas : !hotas;
  }

  function readAnalogBinding(
    profile: DeviceInputProfileSettings,
    profileId: DeviceProfileId,
    binding: DeviceInputBinding | null,
  ): number {
    if (!profile.enabled || !binding) return 0;
    let bestValue = 0;
    for (const gamepad of getGamepads()) {
      if (!gamepadMatchesProfile(gamepad, profileId, binding)) continue;
      let value = 0;
      if (binding.kind === 'axis') {
        value = applyDeadzone(gamepad.axes[binding.axis] ?? 0, profile.deadzone);
        if (binding.direction) value *= binding.direction;
        if (binding.invert) value *= -1;
      } else {
        const button = gamepad.buttons[binding.button];
        value = button ? button.value : 0;
      }
      if (Math.abs(value) > Math.abs(bestValue)) bestValue = value;
    }
    return clampAxis(bestValue * profile.sensitivity);
  }

  function readButtonBinding(
    profile: DeviceInputProfileSettings,
    profileId: DeviceProfileId,
    binding: DeviceInputBinding | null,
  ): boolean {
    if (!profile.enabled || !binding) return false;
    for (const gamepad of getGamepads()) {
      if (!gamepadMatchesProfile(gamepad, profileId, binding)) continue;
      if (binding.kind === 'button') {
        const button = gamepad.buttons[binding.button];
        if (button && (button.pressed || button.value >= 0.5)) return true;
        continue;
      }
      let value = applyDeadzone(gamepad.axes[binding.axis] ?? 0, profile.deadzone);
      value *= binding.direction ?? 1;
      if (binding.invert) value *= -1;
      if (value >= 0.55) return true;
    }
    return false;
  }

  function readProfileAnalog(profileId: DeviceProfileId, control: FlightAnalogControlId): number {
    const profile = getProfile(profileId);
    return readAnalogBinding(profile, profileId, profile.analogBindings[control]);
  }

  function isDeviceActionDown(action: DeviceButtonActionId): boolean {
    return PROFILE_IDS.some((profileId) => {
      const profile = getProfile(profileId);
      return readButtonBinding(profile, profileId, profile.buttonBindings[action]);
    });
  }

  function consumeDeviceActionPress(action: DeviceButtonActionId): boolean {
    let pressed = false;
    for (const profileId of PROFILE_IDS) {
      const profile = getProfile(profileId);
      const key = `${profileId}:${action}`;
      const down = readButtonBinding(profile, profileId, profile.buttonBindings[action]);
      if (down && !deviceActionStates.get(key)) pressed = true;
      deviceActionStates.set(key, down);
    }
    return pressed;
  }

  function isExitSeatHeld(): boolean {
    return isKeyboardActionDown('exitSeat') || isDeviceActionDown('exitSeat');
  }

  function resetSeatLookState(): void {
    seatLook.pitchRadians = 0;
    seatLook.yawRadians = 0;
    yHeldSinceMs = null;
    exitSeatTriggered = false;
  }

  function isSeatLookActive(): boolean {
    return mode === 'in-ship' && isKeyboardActionDown('seatLook') && shipCameraView === 'cockpit';
  }

  function toggleCameraView() {
    if (mode === 'in-ship') {
      shipCameraView = shipCameraView === 'cockpit' ? 'external' : 'cockpit';
      return;
    }
    cameraView = cameraView === 'first-person' ? 'third-person' : 'first-person';
    if (cameraView === 'third-person') {
      orbitLook.pitchRadians = Math.max(
        -ORBIT_PITCH_LIMIT,
        Math.min(ORBIT_PITCH_LIMIT, orbitLook.pitchRadians),
      );
    }
  }

  function onKeyChange(event: KeyboardEvent, down: boolean) {
    if (!isHandledKey(event.code)) return;
    event.preventDefault();
    if (inputSuppressed) return;
    if (down) {
      const wasDown = keys.has(event.code);
      if (isKeyboardCode('reset', event.code)) onReset?.();
      if (!wasDown && isKeyboardCode('cycleCamera', event.code)) toggleCameraView();
      if (
        !wasDown &&
        ONE_SHOT_KEYBOARD_ACTIONS.some((action) => isKeyboardCode(action, event.code))
      ) {
        // The default F binding is hold-only while seated; tap-F interact stays for deck/doors/ramp.
        if (!(isKeyboardCode('seatLook', event.code) && mode === 'in-ship')) {
          justPressed.add(event.code);
        }
      }
      keys.add(event.code);
      return;
    }
    keys.delete(event.code);
  }

  function onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    const mouseKeyboard = inputSettings().mouseKeyboard;
    const lookSensitivity = mouseKeyboard.lookSensitivity;
    const flightMouseSensitivity = mouseKeyboard.flightMouseSensitivity;
    const pitchSign = mouseKeyboard.invertMouseY ? 1 : -1;
    if (mode === 'in-ship') {
      if (isSeatLookActive()) {
        seatLook.yawRadians -= event.movementX * SEAT_LOOK_YAW_SENSITIVITY * lookSensitivity;
        seatLook.pitchRadians = clampPitch(
          seatLook.pitchRadians +
            event.movementY * pitchSign * SEAT_LOOK_PITCH_SENSITIVITY * lookSensitivity,
          FIRST_PERSON_PITCH_LIMIT,
        );
        return;
      }
      flightLook.yaw01 = clampAxis(flightLook.yaw01 - event.movementX * 0.015 * flightMouseSensitivity);
      flightLook.pitch01 = clampAxis(
        flightLook.pitch01 + event.movementY * pitchSign * 0.015 * flightMouseSensitivity,
      );
      return;
    }
    const pitchLimit = cameraView === 'first-person' ? FIRST_PERSON_PITCH_LIMIT : ORBIT_PITCH_LIMIT;
    orbitLook.yawRadians -= event.movementX * 0.0035 * lookSensitivity;
    orbitLook.pitchRadians = Math.max(
      -pitchLimit,
      Math.min(
        pitchLimit,
        orbitLook.pitchRadians + event.movementY * pitchSign * 0.0028 * lookSensitivity,
      ),
    );
  }

  function onCanvasClick() {
    canvas.requestPointerLock?.();
  }

  function onBlur() {
    keys.clear();
    justPressed.clear();
    deviceActionStates.clear();
    flightLook.pitch01 = 0;
    flightLook.yaw01 = 0;
    resetSeatLookState();
  }

  const handleKeyDown = (event: KeyboardEvent) => onKeyChange(event, true);
  const handleKeyUp = (event: KeyboardEvent) => onKeyChange(event, false);
  const handleSettingsChanged = (event: Event) => {
    settings = (event as CustomEvent<GameSettings>).detail ?? loadGameSettings();
  };

  function onWheel(event: WheelEvent) {
    const delta = normalizeWheelDelta(event);
    if (delta === 0) return;
    event.preventDefault();
    if (mode === 'in-ship') {
      if (shipCameraView === 'cockpit') return;
      shipLook.targetZoomDistance = applyShipWheelZoom(shipLook.targetZoomDistance, delta);
      return;
    }
    if (cameraView === 'first-person') return;
    orbitLook.targetZoomDistance = applyWheelZoom(orbitLook.targetZoomDistance, delta);
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onCanvasClick);

  function updateExitSeatHold(): boolean {
    if (mode !== 'in-ship' || !isExitSeatHeld()) {
      yHeldSinceMs = null;
      exitSeatTriggered = false;
      return false;
    }
    if (yHeldSinceMs === null) {
      yHeldSinceMs = performance.now();
      exitSeatTriggered = false;
    }
    if (exitSeatTriggered) return false;
    const heldSeconds = (performance.now() - yHeldSinceMs) / 1000;
    if (heldSeconds >= EXIT_SEAT_HOLD_SECONDS) {
      exitSeatTriggered = true;
      return true;
    }
    return false;
  }

  function setInputSuppressed(next: boolean): void {
    if (inputSuppressed === next) return;
    inputSuppressed = next;
    if (next) {
      keys.clear();
      justPressed.clear();
      deviceActionStates.clear();
      flightLook.pitch01 = 0;
      flightLook.yaw01 = 0;
      resetSeatLookState();
    }
  }

  function consumeActions() {
    if (inputSuppressed) {
      justPressed.clear();
      return {
        interactPressed: false,
        exitSeatPressed: false,
        jumpPressed: false,
        hangarBuildPressed: false,
        hangarRotatePressed: false,
        hangarCancelPressed: false,
        hangarDigit: null,
      };
    }
    const cycleCameraPressed = consumeDeviceActionPress('cycleCamera');
    const resetPressed = consumeDeviceActionPress('reset');
    if (cycleCameraPressed) toggleCameraView();
    if (resetPressed) onReset?.();

    const hangarDigit = wasKeyboardActionPressed('hangar1') || consumeDeviceActionPress('hangar1')
      ? 1
      : wasKeyboardActionPressed('hangar2') || consumeDeviceActionPress('hangar2')
        ? 2
        : wasKeyboardActionPressed('hangar3') || consumeDeviceActionPress('hangar3')
          ? 3
          : null;
    const actions = {
      interactPressed: wasKeyboardActionPressed('interact') || consumeDeviceActionPress('interact'),
      exitSeatPressed: updateExitSeatHold(),
      jumpPressed: wasKeyboardActionPressed('jump') || consumeDeviceActionPress('jump'),
      hangarBuildPressed: wasKeyboardActionPressed('hangarBuild'),
      hangarRotatePressed: wasKeyboardActionPressed('hangarRotate'),
      hangarCancelPressed: wasKeyboardActionPressed('hangarCancel'),
      hangarDigit,
    };
    justPressed.clear();
    return actions;
  }

  function updateContinuousDeviceLook(dt: number): void {
    if (dt <= 0 || mode === 'in-ship') return;
    const yaw = readProfileAnalog('controller', 'yaw');
    const pitch = readProfileAnalog('controller', 'pitch');
    if (yaw === 0 && pitch === 0) return;
    const pitchLimit = cameraView === 'first-person' ? FIRST_PERSON_PITCH_LIMIT : ORBIT_PITCH_LIMIT;
    orbitLook.yawRadians -= yaw * ORBIT_GAMEPAD_YAW_RATE * dt;
    orbitLook.pitchRadians = clampPitch(
      orbitLook.pitchRadians + pitch * ORBIT_GAMEPAD_PITCH_RATE * dt,
      pitchLimit,
    );
  }

  function updateSeatLookSnap(dt: number): void {
    if (isSeatLookActive()) return;
    if (seatLook.yawRadians === 0 && seatLook.pitchRadians === 0) return;
    const decay = Math.exp((-dt * Math.LN2) / SEAT_LOOK_SNAP_HALF_LIFE_SECONDS);
    seatLook.yawRadians *= decay;
    seatLook.pitchRadians *= decay;
    if (Math.abs(seatLook.yawRadians) < 0.001) seatLook.yawRadians = 0;
    if (Math.abs(seatLook.pitchRadians) < 0.001) seatLook.pitchRadians = 0;
  }

  function sampleCameraState(dt = 0) {
    orbitLook.zoomDistance = updateSmoothZoom(
      orbitLook.zoomDistance,
      orbitLook.targetZoomDistance,
      dt,
    );
    shipLook.zoomDistance = updateSmoothZoom(
      shipLook.zoomDistance,
      shipLook.targetZoomDistance,
      dt,
    );
    updateContinuousDeviceLook(dt);
    updateSeatLookSnap(dt);
    return {
      cameraView,
      pitchRadians: orbitLook.pitchRadians,
      seatLook: { pitchRadians: seatLook.pitchRadians, yawRadians: seatLook.yawRadians },
      shipCameraView,
      shipZoomDistance: shipLook.zoomDistance,
      yawRadians: orbitLook.yawRadians,
      zoomDistance: orbitLook.zoomDistance,
    };
  }

  function sampleCharacterInput() {
    const input = {
      ...buildCharacterInput(keys, orbitLook, keyboardBindings()),
      faceCameraYaw: cameraView === 'first-person',
    };
    if (inputSuppressed) return input;
    input.moveX = mergeAxis(input.moveX, readProfileAnalog('controller', 'roll'));
    input.moveY = mergeAxis(input.moveY, readProfileAnalog('controller', 'throttle'));
    input.sprint = Boolean(input.sprint || isDeviceActionDown('boost'));
    return input;
  }

  function sampleFlightInput() {
    const input = buildFlightInput(keys, flightLook, keyboardBindings());
    if (inputSuppressed) return input;
    for (const profileId of PROFILE_IDS) {
      for (const [control, field] of Object.entries(FLIGHT_INPUT_FIELDS) as [
        FlightAnalogControlId,
        keyof FlightInput,
      ][]) {
        input[field] = mergeAxis(input[field], readProfileAnalog(profileId, control));
      }
    }
    input.boost01 = Math.max(input.boost01 ?? 0, isDeviceActionDown('boost') ? 1 : 0);
    input.brake01 = Math.max(input.brake01 ?? 0, isDeviceActionDown('brake') ? 1 : 0);
    if (isDeviceActionDown('jump')) input.lift01 = Math.max(input.lift01 ?? 0, 1);
    flightLook.pitch01 *= 0.3;
    flightLook.yaw01 *= 0.3;
    if (Math.abs(flightLook.pitch01) < 0.001) flightLook.pitch01 = 0;
    if (Math.abs(flightLook.yaw01) < 0.001) flightLook.yaw01 = 0;
    return input;
  }

  function dispose() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('click', onCanvasClick);
  }

  return {
    consumeActions,
    dispose,
    getKeyboardActionLabel(action: KeyboardActionId) {
      return formatKeyboardBinding(keyboardBindings()[action]);
    },
    isPointerLocked() {
      return document.pointerLockElement === canvas;
    },
    sampleCameraState,
    sampleCharacterInput,
    sampleFlightInput,
    setInputSuppressed,
    setMode(nextMode: GameMode | 'on-foot' | 'in-ship') {
      // Taking the pilot seat always starts in the cockpit view.
      if (nextMode === 'in-ship' && mode !== 'in-ship') shipCameraView = 'cockpit';
      if (mode === 'in-ship' && nextMode !== 'in-ship') resetSeatLookState();
      mode = nextMode;
      if (mode !== 'in-ship') {
        flightLook.pitch01 = 0;
        flightLook.yaw01 = 0;
      }
    },
    /** Snaps the orbit camera, e.g. to face out of an elevator on arrival. */
    setOrbitFacing(yawRadians: number, pitchRadians = -0.12) {
      orbitLook.yawRadians = yawRadians;
      orbitLook.pitchRadians = Math.max(
        -ORBIT_PITCH_LIMIT,
        Math.min(ORBIT_PITCH_LIMIT, pitchRadians),
      );
    },
  };
}
