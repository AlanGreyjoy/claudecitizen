import {
  formatDeviceBinding,
  formatKeyCode,
  isLikelyHotasGamepad,
  type DeviceButtonActionId,
  type DeviceInputBinding,
  type DeviceProfileId,
  type FlightAnalogControlId,
  type KeyboardActionId,
} from '../../../flight/input-settings';

type DeviceBindingGroup = 'analog' | 'button';

interface GamepadSnapshot {
  axes: number[];
  buttons: number[];
}

export interface GameMenuCaptureState {
  deviceCapture:
    | {
        action: DeviceButtonActionId | FlightAnalogControlId;
        group: DeviceBindingGroup;
        profileId: DeviceProfileId;
      }
    | null;
  keyboardCaptureAction: KeyboardActionId | null;
}

export interface GameMenuCaptureDeps {
  getCaptureState: () => GameMenuCaptureState;
  onRerender: () => void;
  saveDeviceBinding: (
    profileId: DeviceProfileId,
    group: DeviceBindingGroup,
    action: DeviceButtonActionId | FlightAnalogControlId,
    binding: DeviceInputBinding,
  ) => void;
  setCaptureState: (patch: Partial<GameMenuCaptureState>) => void;
  setControlsStatus: (status: string) => void;
  setDeviceCaptureCleanup: (cleanup: (() => void) | null) => void;
  setKeyboardCaptureCleanup: (cleanup: (() => void) | null) => void;
  updateInputSettings: (
    updater: (input: import('../../../flight/input-settings').InputSettings) => void,
  ) => void;
}

function getGamepads(): Gamepad[] {
  return Array.from(navigator.getGamepads?.() ?? []).filter((gamepad): gamepad is Gamepad =>
    Boolean(gamepad),
  );
}

function gamepadMatchesTab(gamepad: Gamepad, tab: DeviceProfileId): boolean {
  const hotas = isLikelyHotasGamepad(gamepad);
  return tab === 'hotas' ? hotas : !hotas;
}

function snapshotProfileGamepads(profileId: DeviceProfileId): Map<number, GamepadSnapshot> {
  const snapshots = new Map<number, GamepadSnapshot>();
  for (const gamepad of getGamepads()) {
    if (!gamepadMatchesTab(gamepad, profileId)) continue;
    snapshots.set(gamepad.index, {
      axes: [...gamepad.axes],
      buttons: gamepad.buttons.map((button) => button.value),
    });
  }
  return snapshots;
}

function captureButtonInput(
  profileId: DeviceProfileId,
  snapshots: Map<number, GamepadSnapshot>,
): DeviceInputBinding | null {
  for (const gamepad of getGamepads()) {
    if (!gamepadMatchesTab(gamepad, profileId)) continue;
    const snapshot = snapshots.get(gamepad.index);
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      const baseline = snapshot?.buttons[index] ?? 0;
      const button = gamepad.buttons[index];
      if (button.value > 0.55 && button.value - baseline > 0.35) {
        return { kind: 'button', button: index, deviceId: gamepad.id, deviceIndex: gamepad.index };
      }
    }
  }
  return null;
}

function captureAxisInput(
  profileId: DeviceProfileId,
  snapshots: Map<number, GamepadSnapshot>,
  group: DeviceBindingGroup,
): DeviceInputBinding | null {
  for (const gamepad of getGamepads()) {
    if (!gamepadMatchesTab(gamepad, profileId)) continue;
    const snapshot = snapshots.get(gamepad.index);
    for (let index = 0; index < gamepad.axes.length; index += 1) {
      const baseline = snapshot?.axes[index] ?? 0;
      const value = gamepad.axes[index] ?? 0;
      const delta = value - baseline;
      if (Math.abs(delta) > 0.35 && Math.abs(value) > 0.35) {
        const direction = delta >= 0 ? 1 : -1;
        return {
          kind: 'axis',
          axis: index,
          deviceId: gamepad.id,
          deviceIndex: gamepad.index,
          ...(group === 'button' ? { direction } : {}),
        };
      }
    }
  }
  return null;
}

export function createGameMenuCapture(deps: GameMenuCaptureDeps) {
  function cancelCapture(status = ''): void {
    deps.setKeyboardCaptureCleanup(null);
    deps.setDeviceCaptureCleanup(null);
    deps.setCaptureState({ keyboardCaptureAction: null, deviceCapture: null });
    deps.setControlsStatus(status);
  }

  function startKeyboardCapture(action: KeyboardActionId): void {
    cancelCapture();
    deps.setCaptureState({ keyboardCaptureAction: action });
    deps.setControlsStatus(`Press a key for ${action}.`);
    deps.onRerender();
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        cancelCapture('Binding canceled.');
        deps.onRerender();
        return;
      }
      deps.updateInputSettings((input) => {
        input.mouseKeyboard.bindings[action] = { primary: event.code };
      });
      cancelCapture(`Bound to ${formatKeyCode(event.code)}.`);
      deps.onRerender();
    };
    window.addEventListener('keydown', handleKey, true);
    deps.setKeyboardCaptureCleanup(() => window.removeEventListener('keydown', handleKey, true));
  }

  function startDeviceCapture(
    profileId: DeviceProfileId,
    group: DeviceBindingGroup,
    action: DeviceButtonActionId | FlightAnalogControlId,
  ): void {
    cancelCapture();
    const snapshots = snapshotProfileGamepads(profileId);
    if (snapshots.size === 0) {
      deps.setControlsStatus('No matching device is visible to the browser.');
      deps.onRerender();
      return;
    }
    const startedAt = performance.now();
    deps.setCaptureState({ deviceCapture: { action, group, profileId } });
    deps.setControlsStatus('Move an axis or press a button.');
    deps.onRerender();

    let frame = 0;
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelCapture('Binding canceled.');
      deps.onRerender();
    };
    const tick = () => {
      const binding =
        group === 'analog'
          ? captureAxisInput(profileId, snapshots, group) ?? captureButtonInput(profileId, snapshots)
          : captureButtonInput(profileId, snapshots) ?? captureAxisInput(profileId, snapshots, group);
      if (binding) {
        deps.saveDeviceBinding(profileId, group, action, binding);
        cancelCapture(`Bound to ${formatDeviceBinding(binding)}.`);
        deps.onRerender();
        return;
      }
      if (performance.now() - startedAt > 8000) {
        cancelCapture('Binding timed out.');
        deps.onRerender();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('keydown', handleKey, true);
    frame = requestAnimationFrame(tick);
    deps.setDeviceCaptureCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKey, true);
    });
  }

  return { cancelCapture, startDeviceCapture, startKeyboardCapture };
}
