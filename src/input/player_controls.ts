import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type GameSettings,
} from '../settings/game_settings';
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
} from '../flight/camera_zoom';
import { buildCharacterInput, buildFlightInput } from '../flight/control_mix';
import {
  applyMouseDeltaToAim,
  createFlightAimState,
} from '../flight/flight_aim';
import { QUANTUM_ENGAGE_HOLD_SECONDS } from '../flight/quantum_travel';
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
} from '../flight/input_settings';

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
  let flightAim: FlightAimState = createFlightAimState();
  let coupledMode = true;
  let coupledTogglePressed = false;
  const seatLook = { pitchRadians: 0, yawRadians: 0, targetPitchRadians: 0, targetYawRadians: 0 };
  let primaryClickPressed = false;
  let primaryClickHeld = false;
  let secondaryClickHeld = false;
  const orbitLook = {
    pitchRadians: -0.35,
    yawRadians: 0,
    targetPitchRadians: -0.35,
    targetYawRadians: 0,
    zoomDistance: DEFAULT_CAMERA_ZOOM,
    targetZoomDistance: DEFAULT_CAMERA_ZOOM,
  };
  const shipLook = {
    zoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
    targetZoomDistance: DEFAULT_SHIP_CAMERA_ZOOM,
  };
  let mode: GameMode | 'on-foot' | 'in-ship' = 'on-foot';
  let shipCameraView: ShipCameraView = 'cockpit';
  let yHeldSinceMs: number | null = null;
  let exitSeatTriggered = false;
  let uHeldSinceMs: number | null = null;
  let quantumEngageTriggered = false;
  let cycleFlightModePressed = false;
  let settings: GameSettings = loadGameSettings();
  let inputSuppressed = false;
  let combatInputActive = false;
  /** CapsLock walk gait toggle (on-foot). */
  let walkToggleEnabled = false;

  function inputSettings() {
    return settings.input;
  }

  function keyboardBindings() {
    return inputSettings().mouseKeyboard.bindings;
  }

  function isHandledKey(code: string): boolean {
    if (code.startsWith('Key') || code === 'Space') return true;
    if (code === 'AltLeft' || code === 'AltRight') return true;
    if (code === 'CapsLock') return true;
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
    seatLook.targetPitchRadians = 0;
    seatLook.targetYawRadians = 0;
    yHeldSinceMs = null;
    exitSeatTriggered = false;
    uHeldSinceMs = null;
    quantumEngageTriggered = false;
    cycleFlightModePressed = false;
  }

  function isSeatLookActive(): boolean {
    return mode === 'in-ship' && isKeyboardActionDown('seatLook') && shipCameraView === 'cockpit';
  }

  function isBedLookActive(): boolean {
    return mode === 'in-bed';
  }

  function isHeadLookActive(): boolean {
    return isSeatLookActive() || isBedLookActive();
  }

  function toggleShipCameraView() {
    if (mode !== 'in-ship') return;
    shipCameraView = shipCameraView === 'cockpit' ? 'external' : 'cockpit';
  }

  function handleControlsKeyDown(event: KeyboardEvent): void {
    const wasDown = keys.has(event.code);
    if (isKeyboardCode('reset', event.code) && !combatInputActive) onReset?.();
    if (!wasDown && isKeyboardCode('cycleCamera', event.code)) toggleShipCameraView();
    if (
      !wasDown &&
      isKeyboardCode('cycleFlightMode', event.code) &&
      mode === 'in-ship'
    ) {
      uHeldSinceMs = performance.now();
      quantumEngageTriggered = false;
    }
    // Star Citizen-style coupled/decoupled toggle (Alt+C).
    if (
      !wasDown &&
      event.code === 'KeyC' &&
      event.altKey &&
      mode === 'in-ship'
    ) {
      coupledMode = !coupledMode;
      coupledTogglePressed = true;
      return;
    }
    // CapsLock toggles walk gait on foot / deck / station (not while piloting).
    if (
      !wasDown &&
      isKeyboardCode('walkToggle', event.code) &&
      mode !== 'in-ship'
    ) {
      walkToggleEnabled = !walkToggleEnabled;
    }
    if (
      !wasDown &&
      ONE_SHOT_KEYBOARD_ACTIONS.some((action) => isKeyboardCode(action, event.code))
    ) {
      // The default F binding is hold-only while seated; tap-F interact stays for deck/doors/ramp.
      // In bed, head look is always on — allow tap-F for Entertainment System gaze interact.
      if (!(isKeyboardCode('seatLook', event.code) && mode === 'in-ship')) {
        justPressed.add(event.code);
      }
    }
    keys.add(event.code);
  }

  function handleControlsKeyUp(event: KeyboardEvent): void {
    if (
      isKeyboardCode('cycleFlightMode', event.code) &&
      uHeldSinceMs !== null &&
      mode === 'in-ship'
    ) {
      const heldSeconds = (performance.now() - uHeldSinceMs) / 1000;
      if (heldSeconds < FLIGHT_MODE_TAP_THRESHOLD_SECONDS) {
        cycleFlightModePressed = true;
      }
    }
    keys.delete(event.code);
    if (isKeyboardCode('cycleFlightMode', event.code)) {
      uHeldSinceMs = null;
      quantumEngageTriggered = false;
    }
  }

  function onKeyChange(event: KeyboardEvent, down: boolean) {
    if (!isHandledKey(event.code)) return;
    event.preventDefault();
    if (inputSuppressed) return;
    if (down) {
      handleControlsKeyDown(event);
      return;
    }
    handleControlsKeyUp(event);
  }

  function onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    const mouseKeyboard = inputSettings().mouseKeyboard;
    const lookSensitivity = mouseKeyboard.lookSensitivity;
    const flightMouseSensitivity = mouseKeyboard.flightMouseSensitivity;
    const pitchSign = mouseKeyboard.invertMouseY ? 1 : -1;
    if (mode === 'in-ship') {
      if (isSeatLookActive()) {
        seatLook.targetYawRadians -= event.movementX * SEAT_LOOK_YAW_SENSITIVITY * lookSensitivity;
        seatLook.targetPitchRadians = clampPitch(
          seatLook.targetPitchRadians +
            event.movementY * pitchSign * SEAT_LOOK_PITCH_SENSITIVITY * lookSensitivity,
          FIRST_PERSON_PITCH_LIMIT,
        );
        return;
      }
      flightAim = applyMouseDeltaToAim(
        flightAim,
        event.movementX,
        event.movementY,
        flightMouseSensitivity,
        mouseKeyboard.invertMouseY,
      );
      return;
    }
    if (mode === 'in-bed') {
      seatLook.targetYawRadians -= event.movementX * SEAT_LOOK_YAW_SENSITIVITY * lookSensitivity;
      seatLook.targetPitchRadians = clampPitch(
        seatLook.targetPitchRadians +
          event.movementY * pitchSign * SEAT_LOOK_PITCH_SENSITIVITY * lookSensitivity,
        FIRST_PERSON_PITCH_LIMIT,
      );
      return;
    }
    orbitLook.targetYawRadians -= event.movementX * 0.0035 * lookSensitivity;
    orbitLook.targetPitchRadians = Math.max(
      -ORBIT_PITCH_LIMIT,
      Math.min(
        ORBIT_PITCH_LIMIT,
        orbitLook.targetPitchRadians + event.movementY * pitchSign * 0.0028 * lookSensitivity,
      ),
    );
  }

  function onCanvasClick() {
    canvas.requestPointerLock?.();
  }

  // Mouse events report every button transition. Pointer events only emit
  // pointerdown/up for the first/last button in a chord, which made RMB aim
  // swallow a later LMB fire press.
  function onMouseDown(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    if (inputSuppressed) return;
    if (event.button === 0) {
      primaryClickPressed = true;
      primaryClickHeld = true;
    } else if (event.button === 2) {
      secondaryClickHeld = true;
    }
  }

  function onMouseUp(event: MouseEvent) {
    if (event.button === 0) primaryClickHeld = false;
    if (event.button === 2) secondaryClickHeld = false;
  }

  function onPointerLockChange() {
    if (document.pointerLockElement !== canvas) {
      primaryClickHeld = false;
      secondaryClickHeld = false;
    }
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function onBlur() {
    keys.clear();
    justPressed.clear();
    deviceActionStates.clear();
    primaryClickPressed = false;
    primaryClickHeld = false;
    secondaryClickHeld = false;
    flightAim = createFlightAimState();
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
    if (mode === 'in-bed') return;
    orbitLook.targetZoomDistance = applyWheelZoom(orbitLook.targetZoomDistance, delta);
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);

  function updateQuantumEngageHold(): boolean {
    if (mode !== 'in-ship' || !isKeyboardActionDown('cycleFlightMode')) {
      uHeldSinceMs = null;
      quantumEngageTriggered = false;
      return false;
    }
    if (uHeldSinceMs === null) {
      uHeldSinceMs = performance.now();
      quantumEngageTriggered = false;
    }
    if (quantumEngageTriggered) return false;
    const heldSeconds = (performance.now() - uHeldSinceMs) / 1000;
    if (heldSeconds >= QUANTUM_ENGAGE_HOLD_SECONDS) {
      quantumEngageTriggered = true;
      return true;
    }
    return false;
  }

  function updateExitSeatHold(): boolean {
    if ((mode !== 'in-ship' && mode !== 'in-bed') || !isExitSeatHeld()) {
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
      primaryClickPressed = false;
      primaryClickHeld = false;
      secondaryClickHeld = false;
      flightAim = createFlightAimState();
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
    const cycleCameraPressed = consumeDeviceActionPress('cycleCamera');
    const resetPressed = consumeDeviceActionPress('reset');
    if (cycleCameraPressed) toggleShipCameraView();
    if (resetPressed && !combatInputActive) onReset?.();

    const weaponSlotPress =
      wasKeyboardActionPressed('weaponPrimary') || consumeDeviceActionPress('weaponPrimary')
        ? 1
        : wasKeyboardActionPressed('weaponSecondary') || consumeDeviceActionPress('weaponSecondary')
          ? 2
          : wasKeyboardActionPressed('weaponPistol') || consumeDeviceActionPress('weaponPistol')
            ? 3
            : null;
    const interactPressed = wasKeyboardActionPressed('interact') || consumeDeviceActionPress('interact');
    const justPressedSnapshot = new Set(justPressed);
    const cycleFlightModeTap = cycleFlightModePressed;
    cycleFlightModePressed = false;
    const coupledToggled = coupledTogglePressed;
    coupledTogglePressed = false;
    const clickPressed = primaryClickPressed;
    primaryClickPressed = false;
    const actions = {
      interactPressed,
      exitSeatPressed: updateExitSeatHold(),
      jumpPressed: wasKeyboardActionPressed('jump') || consumeDeviceActionPress('jump'),
      hangarBuildPressed: wasKeyboardActionPressed('hangarBuild'),
      hangarRotatePressed: wasKeyboardActionPressed('hangarRotate'),
      hangarCancelPressed: wasKeyboardActionPressed('hangarCancel'),
      weaponSlotPress: weaponSlotPress as 1 | 2 | 3 | null,
      cycleFlightModePressed: cycleFlightModeTap,
      coupledToggled,
      quantumEngagePressed: updateQuantumEngageHold(),
      primaryClickPressed: clickPressed,
      primaryClickHeld,
      reloadWeaponPressed: wasKeyboardActionPressed('reloadWeapon'),
      cycleWeaponFireModePressed: wasKeyboardActionPressed('cycleWeaponFireMode'),
      wasKeyPressed: (code: string) => justPressedSnapshot.has(code) || (code === 'KeyF' && interactPressed),
    };
    justPressed.clear();
    return actions;
  }

  function updateContinuousDeviceLook(dt: number): void {
    if (dt <= 0 || mode === 'in-ship' || mode === 'in-bed') return;
    const yaw = readProfileAnalog('controller', 'yaw');
    const pitch = readProfileAnalog('controller', 'pitch');
    if (yaw === 0 && pitch === 0) return;
    orbitLook.targetYawRadians -= yaw * ORBIT_GAMEPAD_YAW_RATE * dt;
    orbitLook.targetPitchRadians = clampPitch(
      orbitLook.targetPitchRadians + pitch * ORBIT_GAMEPAD_PITCH_RATE * dt,
      ORBIT_PITCH_LIMIT,
    );
  }

  function updateSeatLookSnap(dt: number): void {
    // Bed look stays where you left it (SC head cam); only snap cockpit free-look.
    if (isHeadLookActive() || mode === 'in-bed') return;
    if (seatLook.yawRadians === 0 && seatLook.pitchRadians === 0) return;
    const decay = Math.exp((-dt * Math.LN2) / SEAT_LOOK_SNAP_HALF_LIFE_SECONDS);
    seatLook.yawRadians *= decay;
    seatLook.pitchRadians *= decay;
    seatLook.targetYawRadians = seatLook.yawRadians;
    seatLook.targetPitchRadians = seatLook.pitchRadians;
    if (Math.abs(seatLook.yawRadians) < 0.001) {
      seatLook.yawRadians = 0;
      seatLook.targetYawRadians = 0;
    }
    if (Math.abs(seatLook.pitchRadians) < 0.001) {
      seatLook.pitchRadians = 0;
      seatLook.targetPitchRadians = 0;
    }
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

    if (dt > 0) {
      const mouseSmoothness = 35;
      const blend = 1 - Math.exp(-mouseSmoothness * dt);

      let diffYaw = orbitLook.targetYawRadians - orbitLook.yawRadians;
      diffYaw = Math.atan2(Math.sin(diffYaw), Math.cos(diffYaw));
      orbitLook.yawRadians += diffYaw * blend;

      orbitLook.pitchRadians += (orbitLook.targetPitchRadians - orbitLook.pitchRadians) * blend;

      if (isHeadLookActive()) {
        seatLook.yawRadians += (seatLook.targetYawRadians - seatLook.yawRadians) * blend;
        seatLook.pitchRadians += (seatLook.targetPitchRadians - seatLook.pitchRadians) * blend;
      }
    }

    return {
      pitchRadians: orbitLook.pitchRadians,
      seatLook: { pitchRadians: seatLook.pitchRadians, yawRadians: seatLook.yawRadians },
      shipCameraView,
      shipZoomDistance: shipLook.zoomDistance,
      yawRadians: orbitLook.yawRadians,
      zoomDistance: orbitLook.zoomDistance,
    };
  }

  function sampleCharacterInput() {
    const input = buildCharacterInput(keys, orbitLook, keyboardBindings());
    if (inputSuppressed) return input;
    input.moveX = mergeAxis(input.moveX, readProfileAnalog('controller', 'roll'));
    input.moveY = mergeAxis(input.moveY, readProfileAnalog('controller', 'throttle'));
    input.sprint = Boolean(input.sprint || isDeviceActionDown('boost'));
    input.walk = walkToggleEnabled;
    // Crouch blocks sprint (plan: crouch wins over sprint).
    if (input.crouch) input.sprint = false;
    return input;
  }

  function sampleFlightInput() {
    // Mouse drives persistent aim (IFCS); keyboard/gamepad pitch/yaw are direct torque.
    const input = buildFlightInput(keys, { pitch01: 0, yaw01: 0 }, keyboardBindings());
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
    return input;
  }

  function getFlightAim(): FlightAimState {
    return { ...flightAim };
  }

  function getSeatLook(): { pitchRadians: number; yawRadians: number } {
    return { pitchRadians: seatLook.pitchRadians, yawRadians: seatLook.yawRadians };
  }

  function setFlightAim(next: FlightAimState): void {
    flightAim = next;
  }

  function isCoupledMode(): boolean {
    return coupledMode;
  }

  function dispose() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('click', onCanvasClick);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
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
    isSecondaryClickHeld() {
      return !inputSuppressed && secondaryClickHeld && document.pointerLockElement === canvas;
    },
    isSeatLookActive,
    sampleCameraState,
    sampleCharacterInput,
    sampleFlightInput,
    getFlightAim,
    getSeatLook,
    setFlightAim,
    isCoupledMode,
    setInputSuppressed,
    setCombatInputActive(next: boolean) {
      combatInputActive = next;
      if (!next) primaryClickHeld = false;
    },
    setMode(nextMode: GameMode | 'on-foot' | 'in-ship') {
      // Taking the pilot seat always starts in the cockpit view.
      if (nextMode === 'in-ship' && mode !== 'in-ship') shipCameraView = 'cockpit';
      if (
        (mode === 'in-ship' || mode === 'in-bed') &&
        nextMode !== 'in-ship' &&
        nextMode !== 'in-bed'
      ) {
        resetSeatLookState();
      }
      mode = nextMode;
      if (mode !== 'in-ship') {
        flightAim = createFlightAimState();
      }
    },
    /** Snaps the orbit camera, e.g. to face out of an elevator on arrival. */
    setOrbitFacing(yawRadians: number, pitchRadians = -0.12) {
      orbitLook.yawRadians = yawRadians;
      orbitLook.pitchRadians = Math.max(
        -ORBIT_PITCH_LIMIT,
        Math.min(ORBIT_PITCH_LIMIT, pitchRadians),
      );
      orbitLook.targetYawRadians = orbitLook.yawRadians;
      orbitLook.targetPitchRadians = orbitLook.pitchRadians;
    },
  };
}
