import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type GameSettings,
} from '../settings/game-settings';
import type {
  FlightAimState,
  FlightInput,
  GameMode,
  ShipCameraView,
} from '../types';
import {
  applyShipWheelZoom,
  applyWheelZoom,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_SHIP_CAMERA_ZOOM,
  normalizeWheelDelta,
  updateSmoothZoom,
} from '../flight/camera-zoom';
import { buildCharacterInput, buildFlightInput } from '../flight/control-mix';
import {
  applyMouseDeltaToAim,
  createFlightAimState,
} from '../flight/flight-aim';
import { QUANTUM_ENGAGE_HOLD_SECONDS } from '../flight/quantum-travel';
import { FIRST_PERSON_PITCH_LIMIT, ORBIT_PITCH_LIMIT } from '../player/character-controller';
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
} from '../flight/input-settings';

const EXIT_SEAT_HOLD_SECONDS = 0.5;
const FLIGHT_MODE_TAP_THRESHOLD_SECONDS = 0.25;
const SEAT_LOOK_SNAP_HALF_LIFE_SECONDS = 0.35;
const SEAT_LOOK_YAW_SENSITIVITY = 0.0035;
const SEAT_LOOK_PITCH_SENSITIVITY = 0.0028;
const ORBIT_GAMEPAD_YAW_RATE = 2.4;
const ORBIT_GAMEPAD_PITCH_RATE = 1.8;
const PROFILE_IDS: readonly DeviceProfileId[] = ['controller', 'hotas'];
const ONE_SHOT_KEYBOARD_ACTIONS: readonly KeyboardActionId[] = [
  'interact',
  'jump',
  'weaponPrimary',
  'weaponSecondary',
  'weaponPistol',
  'reloadWeapon',
  'cycleWeaponFireMode',
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

type ControlsMode = GameMode | 'on-foot' | 'in-ship';

interface SeatLookState {
  pitchRadians: number;
  yawRadians: number;
  targetPitchRadians: number;
  targetYawRadians: number;
}

interface OrbitLookState {
  pitchRadians: number;
  yawRadians: number;
  targetPitchRadians: number;
  targetYawRadians: number;
  zoomDistance: number;
  targetZoomDistance: number;
}

interface ShipLookState {
  zoomDistance: number;
  targetZoomDistance: number;
}

interface ControlsState {
  canvas: HTMLCanvasElement;
  onReset?: () => void;
  keys: Set<string>;
  justPressed: Set<string>;
  deviceActionStates: Map<string, boolean>;
  flightAim: FlightAimState;
  coupledMode: boolean;
  coupledTogglePressed: boolean;
  seatLook: SeatLookState;
  primaryClickPressed: boolean;
  primaryClickHeld: boolean;
  secondaryClickHeld: boolean;
  orbitLook: OrbitLookState;
  shipLook: ShipLookState;
  mode: ControlsMode;
  shipCameraView: ShipCameraView;
  yHeldSinceMs: number | null;
  exitSeatTriggered: boolean;
  uHeldSinceMs: number | null;
  quantumEngageTriggered: boolean;
  cycleFlightModePressed: boolean;
  settings: GameSettings;
  inputSuppressed: boolean;
  combatInputActive: boolean;
  /** CapsLock walk gait toggle (on-foot). */
  walkToggleEnabled: boolean;
}

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

function inputSettings(state: ControlsState) {
  return state.settings.input;
}

function keyboardBindings(state: ControlsState) {
  return inputSettings(state).mouseKeyboard.bindings;
}

function isHandledKey(state: ControlsState, code: string): boolean {
  if (code.startsWith('Key') || code === 'Space') return true;
  if (code === 'AltLeft' || code === 'AltRight') return true;
  if (code === 'CapsLock') return true;
  return Object.values(keyboardBindings(state)).some(
    (binding) => binding.primary === code || binding.secondary === code,
  );
}

function isKeyboardActionDown(state: ControlsState, action: KeyboardActionId): boolean {
  return isKeyboardActionActive(state.keys, action, keyboardBindings(state));
}

function isKeyboardCode(state: ControlsState, action: KeyboardActionId, code: string): boolean {
  return isKeyboardCodeForAction(code, action, keyboardBindings(state));
}

function wasKeyboardActionPressed(state: ControlsState, action: KeyboardActionId): boolean {
  return getKeyboardBindingCodes(keyboardBindings(state), action).some((code) =>
    state.justPressed.has(code),
  );
}

function getGamepads(): Gamepad[] {
  return Array.from(navigator.getGamepads?.() ?? []).filter((gamepad): gamepad is Gamepad =>
    Boolean(gamepad),
  );
}

function getProfile(state: ControlsState, profileId: DeviceProfileId): DeviceInputProfileSettings {
  return inputSettings(state)[profileId];
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

function readProfileAnalog(
  state: ControlsState,
  profileId: DeviceProfileId,
  control: FlightAnalogControlId,
): number {
  const profile = getProfile(state, profileId);
  return readAnalogBinding(profile, profileId, profile.analogBindings[control]);
}

function isDeviceActionDown(state: ControlsState, action: DeviceButtonActionId): boolean {
  return PROFILE_IDS.some((profileId) => {
    const profile = getProfile(state, profileId);
    return readButtonBinding(profile, profileId, profile.buttonBindings[action]);
  });
}

function consumeDeviceActionPress(state: ControlsState, action: DeviceButtonActionId): boolean {
  let pressed = false;
  for (const profileId of PROFILE_IDS) {
    const profile = getProfile(state, profileId);
    const key = `${profileId}:${action}`;
    const down = readButtonBinding(profile, profileId, profile.buttonBindings[action]);
    if (down && !state.deviceActionStates.get(key)) pressed = true;
    state.deviceActionStates.set(key, down);
  }
  return pressed;
}

function isExitSeatHeld(state: ControlsState): boolean {
  return isKeyboardActionDown(state, 'exitSeat') || isDeviceActionDown(state, 'exitSeat');
}

function resetSeatLookState(state: ControlsState): void {
  state.seatLook.pitchRadians = 0;
  state.seatLook.yawRadians = 0;
  state.seatLook.targetPitchRadians = 0;
  state.seatLook.targetYawRadians = 0;
  state.yHeldSinceMs = null;
  state.exitSeatTriggered = false;
  state.uHeldSinceMs = null;
  state.quantumEngageTriggered = false;
  state.cycleFlightModePressed = false;
}

function isSeatLookActive(state: ControlsState): boolean {
  return (
    state.mode === 'in-ship' &&
    isKeyboardActionDown(state, 'seatLook') &&
    state.shipCameraView === 'cockpit'
  );
}

function isBedLookActive(state: ControlsState): boolean {
  return state.mode === 'in-bed';
}

function isHeadLookActive(state: ControlsState): boolean {
  return isSeatLookActive(state) || isBedLookActive(state);
}

function toggleShipCameraView(state: ControlsState): void {
  if (state.mode !== 'in-ship') return;
  state.shipCameraView = state.shipCameraView === 'cockpit' ? 'external' : 'cockpit';
}

function handleControlsKeyDown(state: ControlsState, event: KeyboardEvent): void {
  const wasDown = state.keys.has(event.code);
  if (isKeyboardCode(state, 'reset', event.code) && !state.combatInputActive) state.onReset?.();
  if (!wasDown && isKeyboardCode(state, 'cycleCamera', event.code)) toggleShipCameraView(state);
  if (
    !wasDown &&
    isKeyboardCode(state, 'cycleFlightMode', event.code) &&
    state.mode === 'in-ship'
  ) {
    state.uHeldSinceMs = performance.now();
    state.quantumEngageTriggered = false;
  }
  // Star Citizen-style coupled/decoupled toggle (Alt+C).
  if (
    !wasDown &&
    event.code === 'KeyC' &&
    event.altKey &&
    state.mode === 'in-ship'
  ) {
    state.coupledMode = !state.coupledMode;
    state.coupledTogglePressed = true;
    return;
  }
  // CapsLock toggles walk gait on foot / deck / station (not while piloting).
  if (
    !wasDown &&
    isKeyboardCode(state, 'walkToggle', event.code) &&
    state.mode !== 'in-ship'
  ) {
    state.walkToggleEnabled = !state.walkToggleEnabled;
  }
  if (
    !wasDown &&
    ONE_SHOT_KEYBOARD_ACTIONS.some((action) => isKeyboardCode(state, action, event.code))
  ) {
    // The default F binding is hold-only while seated; tap-F interact stays for deck/doors/ramp.
    // In bed, head look is always on — allow tap-F for Entertainment System gaze interact.
    if (!(isKeyboardCode(state, 'seatLook', event.code) && state.mode === 'in-ship')) {
      state.justPressed.add(event.code);
    }
  }
  state.keys.add(event.code);
}

function handleControlsKeyUp(state: ControlsState, event: KeyboardEvent): void {
  if (
    isKeyboardCode(state, 'cycleFlightMode', event.code) &&
    state.uHeldSinceMs !== null &&
    state.mode === 'in-ship'
  ) {
    const heldSeconds = (performance.now() - state.uHeldSinceMs) / 1000;
    if (heldSeconds < FLIGHT_MODE_TAP_THRESHOLD_SECONDS) {
      state.cycleFlightModePressed = true;
    }
  }
  state.keys.delete(event.code);
  if (isKeyboardCode(state, 'cycleFlightMode', event.code)) {
    state.uHeldSinceMs = null;
    state.quantumEngageTriggered = false;
  }
}

function onKeyChange(state: ControlsState, event: KeyboardEvent, down: boolean): void {
  if (!isHandledKey(state, event.code)) return;
  event.preventDefault();
  if (state.inputSuppressed) return;
  if (down) {
    handleControlsKeyDown(state, event);
    return;
  }
  handleControlsKeyUp(state, event);
}

function onMouseMove(state: ControlsState, event: MouseEvent): void {
  if (document.pointerLockElement !== state.canvas) return;
  const mouseKeyboard = inputSettings(state).mouseKeyboard;
  const lookSensitivity = mouseKeyboard.lookSensitivity;
  const flightMouseSensitivity = mouseKeyboard.flightMouseSensitivity;
  const pitchSign = mouseKeyboard.invertMouseY ? 1 : -1;
  if (state.mode === 'in-ship') {
    if (isSeatLookActive(state)) {
      state.seatLook.targetYawRadians -=
        event.movementX * SEAT_LOOK_YAW_SENSITIVITY * lookSensitivity;
      state.seatLook.targetPitchRadians = clampPitch(
        state.seatLook.targetPitchRadians +
          event.movementY * pitchSign * SEAT_LOOK_PITCH_SENSITIVITY * lookSensitivity,
        FIRST_PERSON_PITCH_LIMIT,
      );
      return;
    }
    state.flightAim = applyMouseDeltaToAim(
      state.flightAim,
      event.movementX,
      event.movementY,
      flightMouseSensitivity,
      mouseKeyboard.invertMouseY,
    );
    return;
  }
  if (state.mode === 'in-bed') {
    state.seatLook.targetYawRadians -=
      event.movementX * SEAT_LOOK_YAW_SENSITIVITY * lookSensitivity;
    state.seatLook.targetPitchRadians = clampPitch(
      state.seatLook.targetPitchRadians +
        event.movementY * pitchSign * SEAT_LOOK_PITCH_SENSITIVITY * lookSensitivity,
      FIRST_PERSON_PITCH_LIMIT,
    );
    return;
  }
  state.orbitLook.targetYawRadians -= event.movementX * 0.0035 * lookSensitivity;
  state.orbitLook.targetPitchRadians = Math.max(
    -ORBIT_PITCH_LIMIT,
    Math.min(
      ORBIT_PITCH_LIMIT,
      state.orbitLook.targetPitchRadians + event.movementY * pitchSign * 0.0028 * lookSensitivity,
    ),
  );
}

// Mouse events report every button transition. Pointer events only emit
// pointerdown/up for the first/last button in a chord, which made RMB aim
// swallow a later LMB fire press.
function onMouseDown(state: ControlsState, event: MouseEvent): void {
  if (document.pointerLockElement !== state.canvas) return;
  if (state.inputSuppressed) return;
  if (event.button === 0) {
    state.primaryClickPressed = true;
    state.primaryClickHeld = true;
  } else if (event.button === 2) {
    state.secondaryClickHeld = true;
  }
}

function onMouseUp(state: ControlsState, event: MouseEvent): void {
  if (event.button === 0) state.primaryClickHeld = false;
  if (event.button === 2) state.secondaryClickHeld = false;
}

function onPointerLockChange(state: ControlsState): void {
  if (document.pointerLockElement !== state.canvas) {
    state.primaryClickHeld = false;
    state.secondaryClickHeld = false;
  }
}

function onBlur(state: ControlsState): void {
  state.keys.clear();
  state.justPressed.clear();
  state.deviceActionStates.clear();
  state.primaryClickPressed = false;
  state.primaryClickHeld = false;
  state.secondaryClickHeld = false;
  state.flightAim = createFlightAimState();
  resetSeatLookState(state);
}

function onWheel(state: ControlsState, event: WheelEvent): void {
  const delta = normalizeWheelDelta(event);
  if (delta === 0) return;
  event.preventDefault();
  if (state.mode === 'in-ship') {
    if (state.shipCameraView === 'cockpit') return;
    state.shipLook.targetZoomDistance = applyShipWheelZoom(state.shipLook.targetZoomDistance, delta);
    return;
  }
  if (state.mode === 'in-bed') return;
  state.orbitLook.targetZoomDistance = applyWheelZoom(state.orbitLook.targetZoomDistance, delta);
}

function updateQuantumEngageHold(state: ControlsState): boolean {
  if (state.mode !== 'in-ship' || !isKeyboardActionDown(state, 'cycleFlightMode')) {
    state.uHeldSinceMs = null;
    state.quantumEngageTriggered = false;
    return false;
  }
  if (state.uHeldSinceMs === null) {
    state.uHeldSinceMs = performance.now();
    state.quantumEngageTriggered = false;
  }
  if (state.quantumEngageTriggered) return false;
  const heldSeconds = (performance.now() - state.uHeldSinceMs) / 1000;
  if (heldSeconds >= QUANTUM_ENGAGE_HOLD_SECONDS) {
    state.quantumEngageTriggered = true;
    return true;
  }
  return false;
}

function updateExitSeatHold(state: ControlsState): boolean {
  if ((state.mode !== 'in-ship' && state.mode !== 'in-bed') || !isExitSeatHeld(state)) {
    state.yHeldSinceMs = null;
    state.exitSeatTriggered = false;
    return false;
  }
  if (state.yHeldSinceMs === null) {
    state.yHeldSinceMs = performance.now();
    state.exitSeatTriggered = false;
  }
  if (state.exitSeatTriggered) return false;
  const heldSeconds = (performance.now() - state.yHeldSinceMs) / 1000;
  if (heldSeconds >= EXIT_SEAT_HOLD_SECONDS) {
    state.exitSeatTriggered = true;
    return true;
  }
  return false;
}

function setInputSuppressed(state: ControlsState, next: boolean): void {
  if (state.inputSuppressed === next) return;
  state.inputSuppressed = next;
  if (next) {
    state.keys.clear();
    state.justPressed.clear();
    state.deviceActionStates.clear();
    state.primaryClickPressed = false;
    state.primaryClickHeld = false;
    state.secondaryClickHeld = false;
    state.flightAim = createFlightAimState();
    resetSeatLookState(state);
  }
}

function suppressedActions() {
  return {
    interactPressed: false,
    exitSeatPressed: false,
    jumpPressed: false,
    hangarBuildPressed: false,
    hangarRotatePressed: false,
    hangarCancelPressed: false,
    weaponSlotPress: null,
    cycleFlightModePressed: false,
    coupledToggled: false,
    quantumEngagePressed: false,
    primaryClickPressed: false,
    primaryClickHeld: false,
    reloadWeaponPressed: false,
    cycleWeaponFireModePressed: false,
    wasKeyPressed: () => false,
  };
}

function resolveWeaponSlotPress(state: ControlsState): 1 | 2 | 3 | null {
  if (wasKeyboardActionPressed(state, 'weaponPrimary') || consumeDeviceActionPress(state, 'weaponPrimary')) {
    return 1;
  }
  if (wasKeyboardActionPressed(state, 'weaponSecondary') || consumeDeviceActionPress(state, 'weaponSecondary')) {
    return 2;
  }
  if (wasKeyboardActionPressed(state, 'weaponPistol') || consumeDeviceActionPress(state, 'weaponPistol')) {
    return 3;
  }
  return null;
}

function consumeActions(state: ControlsState) {
  if (state.inputSuppressed) {
    state.justPressed.clear();
    return suppressedActions();
  }
  const cycleCameraPressed = consumeDeviceActionPress(state, 'cycleCamera');
  const resetPressed = consumeDeviceActionPress(state, 'reset');
  if (cycleCameraPressed) toggleShipCameraView(state);
  if (resetPressed && !state.combatInputActive) state.onReset?.();

  const weaponSlotPress = resolveWeaponSlotPress(state);
  const interactPressed =
    wasKeyboardActionPressed(state, 'interact') || consumeDeviceActionPress(state, 'interact');
  const justPressedSnapshot = new Set(state.justPressed);
  const cycleFlightModeTap = state.cycleFlightModePressed;
  state.cycleFlightModePressed = false;
  const coupledToggled = state.coupledTogglePressed;
  state.coupledTogglePressed = false;
  const clickPressed = state.primaryClickPressed;
  state.primaryClickPressed = false;
  const actions = {
    interactPressed,
    exitSeatPressed: updateExitSeatHold(state),
    jumpPressed: wasKeyboardActionPressed(state, 'jump') || consumeDeviceActionPress(state, 'jump'),
    hangarBuildPressed: wasKeyboardActionPressed(state, 'hangarBuild'),
    hangarRotatePressed: wasKeyboardActionPressed(state, 'hangarRotate'),
    hangarCancelPressed: wasKeyboardActionPressed(state, 'hangarCancel'),
    weaponSlotPress,
    cycleFlightModePressed: cycleFlightModeTap,
    coupledToggled,
    quantumEngagePressed: updateQuantumEngageHold(state),
    primaryClickPressed: clickPressed,
    primaryClickHeld: state.primaryClickHeld,
    reloadWeaponPressed: wasKeyboardActionPressed(state, 'reloadWeapon'),
    cycleWeaponFireModePressed: wasKeyboardActionPressed(state, 'cycleWeaponFireMode'),
    wasKeyPressed: (code: string) =>
      justPressedSnapshot.has(code) || (code === 'KeyF' && interactPressed),
  };
  state.justPressed.clear();
  return actions;
}

function updateContinuousDeviceLook(state: ControlsState, dt: number): void {
  if (dt <= 0 || state.mode === 'in-ship' || state.mode === 'in-bed') return;
  const yaw = readProfileAnalog(state, 'controller', 'yaw');
  const pitch = readProfileAnalog(state, 'controller', 'pitch');
  if (yaw === 0 && pitch === 0) return;
  state.orbitLook.targetYawRadians -= yaw * ORBIT_GAMEPAD_YAW_RATE * dt;
  state.orbitLook.targetPitchRadians = clampPitch(
    state.orbitLook.targetPitchRadians + pitch * ORBIT_GAMEPAD_PITCH_RATE * dt,
    ORBIT_PITCH_LIMIT,
  );
}

function updateSeatLookSnap(state: ControlsState, dt: number): void {
  // Bed look stays where you left it (SC head cam); only snap cockpit free-look.
  if (isHeadLookActive(state) || state.mode === 'in-bed') return;
  if (state.seatLook.yawRadians === 0 && state.seatLook.pitchRadians === 0) return;
  const decay = Math.exp((-dt * Math.LN2) / SEAT_LOOK_SNAP_HALF_LIFE_SECONDS);
  state.seatLook.yawRadians *= decay;
  state.seatLook.pitchRadians *= decay;
  state.seatLook.targetYawRadians = state.seatLook.yawRadians;
  state.seatLook.targetPitchRadians = state.seatLook.pitchRadians;
  if (Math.abs(state.seatLook.yawRadians) < 0.001) {
    state.seatLook.yawRadians = 0;
    state.seatLook.targetYawRadians = 0;
  }
  if (Math.abs(state.seatLook.pitchRadians) < 0.001) {
    state.seatLook.pitchRadians = 0;
    state.seatLook.targetPitchRadians = 0;
  }
}

function sampleCameraState(state: ControlsState, dt = 0) {
  state.orbitLook.zoomDistance = updateSmoothZoom(
    state.orbitLook.zoomDistance,
    state.orbitLook.targetZoomDistance,
    dt,
  );
  state.shipLook.zoomDistance = updateSmoothZoom(
    state.shipLook.zoomDistance,
    state.shipLook.targetZoomDistance,
    dt,
  );
  updateContinuousDeviceLook(state, dt);
  updateSeatLookSnap(state, dt);

  if (dt > 0) {
    const mouseSmoothness = 35;
    const blend = 1 - Math.exp(-mouseSmoothness * dt);

    let diffYaw = state.orbitLook.targetYawRadians - state.orbitLook.yawRadians;
    diffYaw = Math.atan2(Math.sin(diffYaw), Math.cos(diffYaw));
    state.orbitLook.yawRadians += diffYaw * blend;

    state.orbitLook.pitchRadians +=
      (state.orbitLook.targetPitchRadians - state.orbitLook.pitchRadians) * blend;

    if (isHeadLookActive(state)) {
      state.seatLook.yawRadians +=
        (state.seatLook.targetYawRadians - state.seatLook.yawRadians) * blend;
      state.seatLook.pitchRadians +=
        (state.seatLook.targetPitchRadians - state.seatLook.pitchRadians) * blend;
    }
  }

  return {
    pitchRadians: state.orbitLook.pitchRadians,
    seatLook: { pitchRadians: state.seatLook.pitchRadians, yawRadians: state.seatLook.yawRadians },
    shipCameraView: state.shipCameraView,
    shipZoomDistance: state.shipLook.zoomDistance,
    yawRadians: state.orbitLook.yawRadians,
    zoomDistance: state.orbitLook.zoomDistance,
  };
}

function sampleCharacterInput(state: ControlsState) {
  const input = buildCharacterInput(state.keys, state.orbitLook, keyboardBindings(state));
  if (state.inputSuppressed) return input;
  input.moveX = mergeAxis(input.moveX, readProfileAnalog(state, 'controller', 'roll'));
  input.moveY = mergeAxis(input.moveY, readProfileAnalog(state, 'controller', 'throttle'));
  input.sprint = Boolean(input.sprint || isDeviceActionDown(state, 'boost'));
  input.walk = state.walkToggleEnabled;
  // Crouch blocks sprint (plan: crouch wins over sprint).
  if (input.crouch) input.sprint = false;
  return input;
}

function sampleFlightInput(state: ControlsState) {
  // Mouse drives persistent aim (IFCS); keyboard/gamepad pitch/yaw are direct torque.
  const input = buildFlightInput(state.keys, { pitch01: 0, yaw01: 0 }, keyboardBindings(state));
  if (state.inputSuppressed) return input;
  for (const profileId of PROFILE_IDS) {
    for (const [control, field] of Object.entries(FLIGHT_INPUT_FIELDS) as [
      FlightAnalogControlId,
      keyof FlightInput,
    ][]) {
      input[field] = mergeAxis(input[field], readProfileAnalog(state, profileId, control));
    }
  }
  input.boost01 = Math.max(input.boost01 ?? 0, isDeviceActionDown(state, 'boost') ? 1 : 0);
  input.brake01 = Math.max(input.brake01 ?? 0, isDeviceActionDown(state, 'brake') ? 1 : 0);
  if (isDeviceActionDown(state, 'jump')) input.lift01 = Math.max(input.lift01 ?? 0, 1);
  return input;
}

function setControlsMode(state: ControlsState, nextMode: ControlsMode): void {
  // Taking the pilot seat always starts in the cockpit view.
  if (nextMode === 'in-ship' && state.mode !== 'in-ship') state.shipCameraView = 'cockpit';
  if (
    (state.mode === 'in-ship' || state.mode === 'in-bed') &&
    nextMode !== 'in-ship' &&
    nextMode !== 'in-bed'
  ) {
    resetSeatLookState(state);
  }
  state.mode = nextMode;
  if (state.mode !== 'in-ship') {
    state.flightAim = createFlightAimState();
  }
}

function setOrbitFacing(state: ControlsState, yawRadians: number, pitchRadians = -0.12): void {
  state.orbitLook.yawRadians = yawRadians;
  state.orbitLook.pitchRadians = Math.max(
    -ORBIT_PITCH_LIMIT,
    Math.min(ORBIT_PITCH_LIMIT, pitchRadians),
  );
  state.orbitLook.targetYawRadians = state.orbitLook.yawRadians;
  state.orbitLook.targetPitchRadians = state.orbitLook.pitchRadians;
}

interface PlayerControlsOptions {
  onReset?: () => void;
}

function createControlsState(
  canvas: HTMLCanvasElement,
  onReset?: () => void,
): ControlsState {
  return {
    canvas,
    onReset,
    keys: new Set(),
    justPressed: new Set(),
    deviceActionStates: new Map(),
    flightAim: createFlightAimState(),
    coupledMode: true,
    coupledTogglePressed: false,
    seatLook: { pitchRadians: 0, yawRadians: 0, targetPitchRadians: 0, targetYawRadians: 0 },
    primaryClickPressed: false,
    primaryClickHeld: false,
    secondaryClickHeld: false,
    orbitLook: {
      pitchRadians: -0.35,
      yawRadians: 0,
      targetPitchRadians: -0.35,
      targetYawRadians: 0,
      zoomDistance: DEFAULT_CAMERA_ZOOM,
      targetZoomDistance: DEFAULT_CAMERA_ZOOM,
    },
    shipLook: {
      zoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
      targetZoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
    },
    mode: 'on-foot',
    shipCameraView: 'cockpit',
    yHeldSinceMs: null,
    exitSeatTriggered: false,
    uHeldSinceMs: null,
    quantumEngageTriggered: false,
    cycleFlightModePressed: false,
    settings: loadGameSettings(),
    inputSuppressed: false,
    combatInputActive: false,
    walkToggleEnabled: false,
  };
}

export function createPlayerControls(canvas: HTMLCanvasElement, { onReset }: PlayerControlsOptions = {}) {
  const state = createControlsState(canvas, onReset);

  const handleKeyDown = (event: KeyboardEvent) => onKeyChange(state, event, true);
  const handleKeyUp = (event: KeyboardEvent) => onKeyChange(state, event, false);
  const handleSettingsChanged = (event: Event) => {
    state.settings = (event as CustomEvent<GameSettings>).detail ?? loadGameSettings();
  };
  const handleMouseMove = (event: MouseEvent) => onMouseMove(state, event);
  const handleBlur = () => onBlur(state);
  const handleWheel = (event: WheelEvent) => onWheel(state, event);
  const handleCanvasClick = () => canvas.requestPointerLock?.();
  const handleMouseDown = (event: MouseEvent) => onMouseDown(state, event);
  const handleContextMenu = (event: MouseEvent) => event.preventDefault();
  const handleMouseUp = (event: MouseEvent) => onMouseUp(state, event);
  const handlePointerLockChange = () => onPointerLockChange(state);

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('blur', handleBlur);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('pointerlockchange', handlePointerLockChange);

  function dispose() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('blur', handleBlur);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('click', handleCanvasClick);
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('contextmenu', handleContextMenu);
    window.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }

  return {
    consumeActions: () => consumeActions(state),
    dispose,
    getKeyboardActionLabel(action: KeyboardActionId) {
      return formatKeyboardBinding(keyboardBindings(state)[action]);
    },
    isPointerLocked() {
      return document.pointerLockElement === canvas;
    },
    isSecondaryClickHeld() {
      return !state.inputSuppressed && state.secondaryClickHeld && document.pointerLockElement === canvas;
    },
    isSeatLookActive: () => isSeatLookActive(state),
    sampleCameraState: (dt = 0) => sampleCameraState(state, dt),
    sampleCharacterInput: () => sampleCharacterInput(state),
    sampleFlightInput: () => sampleFlightInput(state),
    getFlightAim: (): FlightAimState => ({ ...state.flightAim }),
    getSeatLook: (): { pitchRadians: number; yawRadians: number } => ({
      pitchRadians: state.seatLook.pitchRadians,
      yawRadians: state.seatLook.yawRadians,
    }),
    setFlightAim: (next: FlightAimState) => {
      state.flightAim = next;
    },
    isCoupledMode: () => state.coupledMode,
    setInputSuppressed: (next: boolean) => setInputSuppressed(state, next),
    setCombatInputActive(next: boolean) {
      state.combatInputActive = next;
      if (!next) state.primaryClickHeld = false;
    },
    setMode: (nextMode: ControlsMode) => setControlsMode(state, nextMode),
    /** Snaps the orbit camera, e.g. to face out of an elevator on arrival. */
    setOrbitFacing: (yawRadians: number, pitchRadians = -0.12) =>
      setOrbitFacing(state, yawRadians, pitchRadians),
  };
}
