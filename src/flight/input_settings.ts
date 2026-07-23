export type KeyboardActionId =
  | 'moveForward'
  | 'moveBackward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'sprintBoost'
  | 'crouch'
  | 'walkToggle'
  | 'rollLeft'
  | 'rollRight'
  | 'yawLeft'
  | 'yawRight'
  | 'pitchUp'
  | 'pitchDown'
  | 'liftUp'
  | 'liftDown'
  | 'brake'
  | 'interact'
  | 'seatLook'
  | 'exitSeat'
  | 'jump'
  | 'cycleCamera'
  | 'reset'
  | 'weaponPrimary'
  | 'weaponSecondary'
  | 'weaponPistol'
  | 'reloadWeapon'
  | 'cycleWeaponFireMode'
  | 'hangarBuild'
  | 'hangarRotate'
  | 'hangarCancel'
  | 'haloBand'
  | 'personalInventory'
  | 'cycleFlightMode';

export type FlightAnalogControlId =
  | 'pitch'
  | 'yaw'
  | 'roll'
  | 'throttle'
  | 'strafe'
  | 'lift';

export type DeviceButtonActionId =
  | 'boost'
  | 'brake'
  | 'interact'
  | 'exitSeat'
  | 'jump'
  | 'cycleCamera'
  | 'reset'
  | 'weaponPrimary'
  | 'weaponSecondary'
  | 'weaponPistol';

export type DeviceProfileId = 'controller' | 'hotas';

export interface KeyboardBinding {
  primary: string;
  secondary?: string;
}

export type KeyboardBindings = Record<KeyboardActionId, KeyboardBinding>;

export interface MouseKeyboardSettings {
  bindings: KeyboardBindings;
  flightMouseSensitivity: number;
  invertMouseY: boolean;
  lookSensitivity: number;
}

export interface DeviceAxisBinding {
  axis: number;
  deviceId?: string;
  deviceIndex?: number;
  direction?: -1 | 1;
  invert?: boolean;
  kind: 'axis';
}

export interface DeviceButtonBinding {
  button: number;
  deviceId?: string;
  deviceIndex?: number;
  kind: 'button';
}

export type DeviceInputBinding = DeviceAxisBinding | DeviceButtonBinding;
export type DeviceAnalogBindings = Record<FlightAnalogControlId, DeviceInputBinding | null>;
export type DeviceButtonBindings = Record<DeviceButtonActionId, DeviceInputBinding | null>;

export interface DeviceInputProfileSettings {
  analogBindings: DeviceAnalogBindings;
  buttonBindings: DeviceButtonBindings;
  deadzone: number;
  enabled: boolean;
  sensitivity: number;
}

export interface InputSettings {
  controller: DeviceInputProfileSettings;
  hotas: DeviceInputProfileSettings;
  mouseKeyboard: MouseKeyboardSettings;
}

export interface KeyboardActionDefinition {
  defaultBinding: KeyboardBinding;
  id: KeyboardActionId;
  label: string;
}

export interface FlightAnalogControlDefinition {
  id: FlightAnalogControlId;
  label: string;
}

export interface DeviceButtonActionDefinition {
  id: DeviceButtonActionId;
  label: string;
}

export interface DeviceProfileDefinition {
  id: DeviceProfileId;
  label: string;
}

export const KEYBOARD_ACTIONS: readonly KeyboardActionDefinition[] = [
  { id: 'moveForward', label: 'Move Forward', defaultBinding: { primary: 'KeyW' } },
  { id: 'moveBackward', label: 'Move Backward', defaultBinding: { primary: 'KeyS' } },
  { id: 'strafeLeft', label: 'Strafe Left', defaultBinding: { primary: 'KeyA' } },
  { id: 'strafeRight', label: 'Strafe Right', defaultBinding: { primary: 'KeyD' } },
  {
    id: 'sprintBoost',
    label: 'Sprint / Boost',
    defaultBinding: { primary: 'ShiftLeft', secondary: 'ShiftRight' },
  },
  {
    id: 'crouch',
    label: 'Crouch',
    defaultBinding: { primary: 'KeyC' },
  },
  {
    id: 'walkToggle',
    label: 'Walk Toggle',
    defaultBinding: { primary: 'CapsLock' },
  },
  { id: 'rollLeft', label: 'Roll Left', defaultBinding: { primary: 'KeyQ' } },
  { id: 'rollRight', label: 'Roll Right', defaultBinding: { primary: 'KeyE' } },
  { id: 'yawLeft', label: 'Yaw Left', defaultBinding: { primary: 'ArrowLeft' } },
  { id: 'yawRight', label: 'Yaw Right', defaultBinding: { primary: 'ArrowRight' } },
  { id: 'pitchUp', label: 'Pitch Up', defaultBinding: { primary: 'ArrowUp' } },
  { id: 'pitchDown', label: 'Pitch Down', defaultBinding: { primary: 'ArrowDown' } },
  { id: 'liftUp', label: 'Lift / Jump', defaultBinding: { primary: 'Space' } },
  { id: 'liftDown', label: 'Descend', defaultBinding: { primary: 'KeyC' } },
  { id: 'brake', label: 'Brake', defaultBinding: { primary: 'KeyB' } },
  { id: 'interact', label: 'Interact', defaultBinding: { primary: 'KeyF' } },
  { id: 'seatLook', label: 'Cockpit Free Look', defaultBinding: { primary: 'KeyF' } },
  { id: 'exitSeat', label: 'Leave Pilot Seat', defaultBinding: { primary: 'KeyY' } },
  { id: 'jump', label: 'Jump', defaultBinding: { primary: 'Space' } },
  { id: 'cycleCamera', label: 'Ship Camera View', defaultBinding: { primary: 'KeyV' } },
  { id: 'reset', label: 'Reset Position', defaultBinding: { primary: 'KeyR' } },
  { id: 'weaponPrimary', label: 'Primary Weapon', defaultBinding: { primary: 'Digit1' } },
  { id: 'weaponSecondary', label: 'Secondary Weapon', defaultBinding: { primary: 'Digit2' } },
  { id: 'weaponPistol', label: 'Pistol', defaultBinding: { primary: 'Digit3' } },
  { id: 'reloadWeapon', label: 'Reload Weapon', defaultBinding: { primary: 'KeyR' } },
  { id: 'cycleWeaponFireMode', label: 'Cycle Weapon Fire Mode', defaultBinding: { primary: 'KeyB' } },
  { id: 'hangarBuild', label: 'Build Mode', defaultBinding: { primary: 'KeyH' } },
  { id: 'hangarRotate', label: 'Rotate Prop', defaultBinding: { primary: 'KeyG' } },
  { id: 'hangarCancel', label: 'Cancel Build Tool', defaultBinding: { primary: 'KeyX' } },
  { id: 'haloBand', label: 'HaloBand Device', defaultBinding: { primary: 'F2' } },
  { id: 'personalInventory', label: 'Personal Inventory', defaultBinding: { primary: 'KeyI' } },
  { id: 'cycleFlightMode', label: 'Flight Mode / Quantum', defaultBinding: { primary: 'KeyU' } },
] as const;

export const FLIGHT_ANALOG_CONTROLS: readonly FlightAnalogControlDefinition[] = [
  { id: 'pitch', label: 'Pitch' },
  { id: 'yaw', label: 'Yaw' },
  { id: 'roll', label: 'Roll' },
  { id: 'throttle', label: 'Throttle' },
  { id: 'strafe', label: 'Strafe' },
  { id: 'lift', label: 'Lift' },
] as const;

export const DEVICE_BUTTON_ACTIONS: readonly DeviceButtonActionDefinition[] = [
  { id: 'boost', label: 'Boost' },
  { id: 'brake', label: 'Brake' },
  { id: 'interact', label: 'Interact' },
  { id: 'exitSeat', label: 'Leave Pilot Seat' },
  { id: 'jump', label: 'Jump' },
  { id: 'cycleCamera', label: 'Ship Camera View' },
  { id: 'reset', label: 'Reset Position' },
  { id: 'weaponPrimary', label: 'Primary Weapon' },
  { id: 'weaponSecondary', label: 'Secondary Weapon' },
  { id: 'weaponPistol', label: 'Pistol' },
] as const;

export const DEVICE_PROFILES: readonly DeviceProfileDefinition[] = [
  { id: 'controller', label: 'Controller' },
  { id: 'hotas', label: 'HOTAS' },
] as const;

export const DEFAULT_KEYBOARD_BINDINGS: KeyboardBindings = Object.fromEntries(
  KEYBOARD_ACTIONS.map((action) => [action.id, { ...action.defaultBinding }]),
) as KeyboardBindings;

function emptyAnalogBindings(): DeviceAnalogBindings {
  return Object.fromEntries(FLIGHT_ANALOG_CONTROLS.map((control) => [control.id, null])) as DeviceAnalogBindings;
}

function emptyButtonBindings(): DeviceButtonBindings {
  return Object.fromEntries(DEVICE_BUTTON_ACTIONS.map((action) => [action.id, null])) as DeviceButtonBindings;
}

function createDefaultControllerProfile(): DeviceInputProfileSettings {
  return {
    analogBindings: {
      ...emptyAnalogBindings(),
      pitch: { kind: 'axis', axis: 3, invert: true },
      yaw: { kind: 'axis', axis: 2 },
      roll: { kind: 'axis', axis: 0 },
      throttle: { kind: 'axis', axis: 1, invert: true },
    },
    buttonBindings: {
      ...emptyButtonBindings(),
      boost: { kind: 'button', button: 5 },
      brake: { kind: 'button', button: 4 },
      interact: { kind: 'button', button: 2 },
      exitSeat: { kind: 'button', button: 1 },
      jump: { kind: 'button', button: 0 },
      cycleCamera: { kind: 'button', button: 3 },
      reset: { kind: 'button', button: 8 },
    },
    deadzone: 0.12,
    enabled: true,
    sensitivity: 1,
  };
}

function createDefaultHotasProfile(): DeviceInputProfileSettings {
  return {
    analogBindings: {
      ...emptyAnalogBindings(),
      pitch: { kind: 'axis', axis: 1, invert: true },
      yaw: { kind: 'axis', axis: 0 },
      roll: { kind: 'axis', axis: 2 },
      throttle: { kind: 'axis', axis: 3, invert: true },
    },
    buttonBindings: emptyButtonBindings(),
    deadzone: 0.06,
    enabled: true,
    sensitivity: 1,
  };
}

export function createDefaultInputSettings(): InputSettings {
  return {
    controller: createDefaultControllerProfile(),
    hotas: createDefaultHotasProfile(),
    mouseKeyboard: {
      bindings: { ...DEFAULT_KEYBOARD_BINDINGS },
      flightMouseSensitivity: 1,
      invertMouseY: false,
      lookSensitivity: 1,
    },
  };
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = createDefaultInputSettings();

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function normalizeKeyboardBinding(
  raw: Partial<KeyboardBinding> | undefined,
  fallback: KeyboardBinding,
): KeyboardBinding {
  const primary = typeof raw?.primary === 'string' && raw.primary ? raw.primary : fallback.primary;
  const secondary =
    typeof raw?.secondary === 'string' && raw.secondary ? raw.secondary : fallback.secondary;
  return secondary ? { primary, secondary } : { primary };
}

function normalizeKeyboardBindings(
  raw: Partial<Record<KeyboardActionId, Partial<KeyboardBinding>>> | undefined,
): KeyboardBindings {
  const bindings = {} as KeyboardBindings;
  for (const action of KEYBOARD_ACTIONS) {
    bindings[action.id] = normalizeKeyboardBinding(raw?.[action.id], action.defaultBinding);
  }
  return bindings;
}

function parseDeviceBindingMeta(record: Partial<DeviceInputBinding>): {
  deviceId?: string;
  deviceIndex?: number;
} {
  const deviceId =
    typeof record.deviceId === 'string' && record.deviceId ? record.deviceId : undefined;
  const deviceIndex =
    typeof record.deviceIndex === 'number' && Number.isInteger(record.deviceIndex)
      ? Math.max(0, record.deviceIndex)
      : undefined;
  return {
    ...(deviceId ? { deviceId } : {}),
    ...(deviceIndex !== undefined ? { deviceIndex } : {}),
  };
}

function normalizeButtonDeviceBinding(
  record: Partial<DeviceInputBinding>,
): DeviceInputBinding | null {
  if (record.kind !== 'button' || typeof record.button !== 'number' || !Number.isInteger(record.button)) {
    return null;
  }
  return {
    kind: 'button',
    button: Math.max(0, record.button),
    ...parseDeviceBindingMeta(record),
  };
}

function normalizeAxisDeviceBinding(
  record: Partial<DeviceInputBinding>,
): DeviceInputBinding | null {
  if (record.kind !== 'axis' || typeof record.axis !== 'number' || !Number.isInteger(record.axis)) {
    return null;
  }
  const direction = record.direction === -1 || record.direction === 1 ? record.direction : undefined;
  return {
    kind: 'axis',
    axis: Math.max(0, record.axis),
    ...(direction !== undefined ? { direction } : {}),
    ...parseDeviceBindingMeta(record),
    ...(typeof record.invert === 'boolean' ? { invert: record.invert } : {}),
  };
}

function normalizeDeviceBinding(raw: unknown): DeviceInputBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<DeviceInputBinding>;
  return normalizeButtonDeviceBinding(record) ?? normalizeAxisDeviceBinding(record);
}

function normalizeAnalogBindings(
  raw: Partial<Record<FlightAnalogControlId, unknown>> | undefined,
  fallback: DeviceAnalogBindings,
): DeviceAnalogBindings {
  const bindings = emptyAnalogBindings();
  for (const control of FLIGHT_ANALOG_CONTROLS) {
    bindings[control.id] = normalizeDeviceBinding(raw?.[control.id]) ?? fallback[control.id];
  }
  return bindings;
}

function normalizeButtonBindings(
  raw: Partial<Record<DeviceButtonActionId, unknown>> | undefined,
  fallback: DeviceButtonBindings,
): DeviceButtonBindings {
  const bindings = emptyButtonBindings();
  for (const action of DEVICE_BUTTON_ACTIONS) {
    bindings[action.id] = normalizeDeviceBinding(raw?.[action.id]) ?? fallback[action.id];
  }
  return bindings;
}

function normalizeDeviceProfile(
  raw: Partial<DeviceInputProfileSettings> | undefined,
  fallback: DeviceInputProfileSettings,
): DeviceInputProfileSettings {
  return {
    analogBindings: normalizeAnalogBindings(raw?.analogBindings, fallback.analogBindings),
    buttonBindings: normalizeButtonBindings(raw?.buttonBindings, fallback.buttonBindings),
    deadzone: clampNumber(raw?.deadzone, 0, 0.45, fallback.deadzone),
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    sensitivity: clampNumber(raw?.sensitivity, 0.2, 2.5, fallback.sensitivity),
  };
}

export function normalizeInputSettings(raw: Partial<InputSettings> | undefined): InputSettings {
  const defaults = createDefaultInputSettings();
  return {
    controller: normalizeDeviceProfile(raw?.controller, defaults.controller),
    hotas: normalizeDeviceProfile(raw?.hotas, defaults.hotas),
    mouseKeyboard: {
      bindings: normalizeKeyboardBindings(raw?.mouseKeyboard?.bindings),
      flightMouseSensitivity: clampNumber(
        raw?.mouseKeyboard?.flightMouseSensitivity,
        0.2,
        2.5,
        defaults.mouseKeyboard.flightMouseSensitivity,
      ),
      invertMouseY:
        typeof raw?.mouseKeyboard?.invertMouseY === 'boolean'
          ? raw.mouseKeyboard.invertMouseY
          : defaults.mouseKeyboard.invertMouseY,
      lookSensitivity: clampNumber(
        raw?.mouseKeyboard?.lookSensitivity,
        0.2,
        2.5,
        defaults.mouseKeyboard.lookSensitivity,
      ),
    },
  };
}

export function getKeyboardBindingCodes(
  bindings: KeyboardBindings,
  action: KeyboardActionId,
): readonly string[] {
  const binding = bindings[action];
  return binding.secondary ? [binding.primary, binding.secondary] : [binding.primary];
}

export function isKeyboardActionActive(
  keys: ReadonlySet<string>,
  action: KeyboardActionId,
  bindings: KeyboardBindings,
): boolean {
  return getKeyboardBindingCodes(bindings, action).some((code) => keys.has(code));
}

export function isKeyboardCodeForAction(
  code: string,
  action: KeyboardActionId,
  bindings: KeyboardBindings,
): boolean {
  return getKeyboardBindingCodes(bindings, action).includes(code);
}

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.replace('Arrow', '');
  if (code === 'Space') return 'Space';
  if (code === 'ShiftLeft') return 'Left Shift';
  if (code === 'ShiftRight') return 'Right Shift';
  if (code === 'ControlLeft') return 'Left Ctrl';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (code === 'AltLeft') return 'Left Alt';
  if (code === 'AltRight') return 'Right Alt';
  return code;
}

export function formatKeyboardBinding(binding: KeyboardBinding): string {
  return binding.secondary
    ? `${formatKeyCode(binding.primary)} / ${formatKeyCode(binding.secondary)}`
    : formatKeyCode(binding.primary);
}

export function formatDeviceBinding(binding: DeviceInputBinding | null): string {
  if (!binding) return 'Unbound';
  const device = binding.deviceIndex !== undefined ? ` · Device ${binding.deviceIndex}` : '';
  if (binding.kind === 'button') return `Button ${binding.button}${device}`;
  const direction =
    binding.direction === 1 ? ' +' : binding.direction === -1 ? ' -' : binding.invert ? ' inverted' : '';
  return `Axis ${binding.axis}${direction}${device}`;
}

export function isLikelyHotasGamepad(gamepad: Pick<Gamepad, 'axes' | 'id' | 'mapping'>): boolean {
  const id = gamepad.id.toLowerCase();
  return (
    id.includes('vkb') ||
    id.includes('gladiator') ||
    id.includes('hotas') ||
    id.includes('joystick') ||
    id.includes('flight') ||
    id.includes('stick') ||
    id.includes('throttle') ||
    id.includes('virpil') ||
    id.includes('winwing') ||
    (gamepad.mapping !== 'standard' && gamepad.axes.length >= 3)
  );
}

export function clampInputAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function applyInputDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / Math.max(0.0001, 1 - deadzone);
  return Math.sign(value) * scaled;
}

export function gamepadMatchesDeviceProfile(
  gamepad: Pick<Gamepad, 'axes' | 'id' | 'index' | 'mapping'>,
  profileId: DeviceProfileId,
  binding: DeviceInputBinding | null,
): boolean {
  if (binding?.deviceId) return gamepad.id === binding.deviceId;
  if (binding?.deviceIndex !== undefined) return gamepad.index === binding.deviceIndex;
  const hotas = isLikelyHotasGamepad(gamepad);
  return profileId === 'hotas' ? hotas : !hotas;
}

function readRawDeviceBindingValue(
  gamepad: Gamepad,
  binding: DeviceInputBinding,
  deadzone: number,
): number {
  if (binding.kind === 'button') {
    return gamepad.buttons[binding.button]?.value ?? 0;
  }
  let value = applyInputDeadzone(gamepad.axes[binding.axis] ?? 0, deadzone);
  if (binding.direction) value *= binding.direction;
  if (binding.invert) value *= -1;
  return value;
}

export function readDeviceAnalogControl(
  profile: DeviceInputProfileSettings,
  profileId: DeviceProfileId,
  control: FlightAnalogControlId,
  gamepads: readonly Gamepad[],
): number {
  const binding = profile.analogBindings[control];
  if (!profile.enabled || !binding) return 0;
  let bestValue = 0;
  for (const gamepad of gamepads) {
    if (!gamepadMatchesDeviceProfile(gamepad, profileId, binding)) continue;
    const value = readRawDeviceBindingValue(gamepad, binding, profile.deadzone);
    if (Math.abs(value) > Math.abs(bestValue)) bestValue = value;
  }
  return clampInputAxis(bestValue * profile.sensitivity);
}

export function readDeviceAnalogAxes(
  profile: DeviceInputProfileSettings,
  profileId: DeviceProfileId,
  gamepads: readonly Gamepad[],
): Record<FlightAnalogControlId, number> {
  return {
    pitch: readDeviceAnalogControl(profile, profileId, 'pitch', gamepads),
    yaw: readDeviceAnalogControl(profile, profileId, 'yaw', gamepads),
    roll: readDeviceAnalogControl(profile, profileId, 'roll', gamepads),
    throttle: readDeviceAnalogControl(profile, profileId, 'throttle', gamepads),
    strafe: readDeviceAnalogControl(profile, profileId, 'strafe', gamepads),
    lift: readDeviceAnalogControl(profile, profileId, 'lift', gamepads),
  };
}
