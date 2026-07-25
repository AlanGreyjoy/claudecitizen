import {
  createDefaultInputSettings,
  type DeviceButtonActionId,
  type DeviceInputBinding,
  type DeviceInputProfileSettings,
  type DeviceProfileId,
  type FlightAnalogControlId,
  type InputSettings,
} from '../../../flight/input-settings';
import type { GameSettings } from '../../../settings/game-settings';
import {
  createGameMenuCapture,
  type GameMenuCaptureState,
} from './game-menu-controls-capture';
import { createGameMenuControlsPanel } from './game-menu-controls-panel';

export type ControlsTab = 'mouseKeyboard' | DeviceProfileId;

export interface GameMenuControlsDeps {
  controlsRoot: HTMLElement | null;
  getSettings: () => GameSettings;
  saveSettings: (settings: GameSettings) => GameSettings;
  getActiveTab: () => 'video' | 'audio' | 'controls' | 'exit';
  isOpen: () => boolean;
}

export interface GameMenuControls {
  cancelCapture: (status?: string) => void;
  isCapturingControls: () => boolean;
  renderControlsPanel: () => void;
  startTelemetry: () => void;
  stopAxisPreview: () => void;
  stopTelemetry: () => void;
}

function cloneInputSettings(input: InputSettings): InputSettings {
  return JSON.parse(JSON.stringify(input)) as InputSettings;
}

export function createGameMenuControls(deps: GameMenuControlsDeps): GameMenuControls {
  const { controlsRoot, getSettings, saveSettings, getActiveTab, isOpen } = deps;

  let controlsTab: ControlsTab = 'mouseKeyboard';
  let controlsStatus = '';
  let captureState: GameMenuCaptureState = {
    keyboardCaptureAction: null,
    deviceCapture: null,
  };
  let keyboardCaptureCleanup: (() => void) | null = null;
  let deviceCaptureCleanup: (() => void) | null = null;
  let axisPreviewCleanup: (() => void) | null = null;
  let telemetryInterval: number | null = null;

  function isCapturingControls(): boolean {
    return captureState.keyboardCaptureAction !== null || captureState.deviceCapture !== null;
  }

  function saveInputSettings(nextInput: InputSettings, rerender = true): void {
    saveSettings({
      ...getSettings(),
      input: nextInput,
    });
    if (rerender) renderControlsPanel();
  }

  function updateInputSettings(updater: (input: InputSettings) => void, rerender = true): void {
    const nextInput = cloneInputSettings(getSettings().input);
    updater(nextInput);
    saveInputSettings(nextInput, rerender);
  }

  function updateDeviceProfile(
    profileId: DeviceProfileId,
    updater: (profile: DeviceInputProfileSettings) => void,
  ): void {
    updateInputSettings((input) => updater(input[profileId]));
  }

  function resetControlsTab(tab: ControlsTab): void {
    const defaults = createDefaultInputSettings();
    controlsStatus = 'Defaults restored.';
    updateInputSettings((input) => {
      if (tab === 'mouseKeyboard') {
        input.mouseKeyboard = defaults.mouseKeyboard;
        return;
      }
      input[tab] = defaults[tab];
    });
  }

  function stopAxisPreview(): void {
    axisPreviewCleanup?.();
    axisPreviewCleanup = null;
  }

  function renderControlsPanel(): void {
    stopAxisPreview();
    controlsPanel.renderControlsPanel((cleanup) => {
      axisPreviewCleanup = cleanup;
    });
  }

  const capture = createGameMenuCapture({
    getCaptureState: () => captureState,
    onRerender: renderControlsPanel,
    saveDeviceBinding: (
      profileId: DeviceProfileId,
      group: 'analog' | 'button',
      action: DeviceButtonActionId | FlightAnalogControlId,
      binding: DeviceInputBinding,
    ) => {
      updateDeviceProfile(profileId, (profile) => {
        if (group === 'analog') {
          profile.analogBindings[action as FlightAnalogControlId] = binding;
          return;
        }
        profile.buttonBindings[action as DeviceButtonActionId] = binding;
      });
    },
    setCaptureState: (patch) => {
      captureState = { ...captureState, ...patch };
    },
    setControlsStatus: (status) => {
      controlsStatus = status;
    },
    setDeviceCaptureCleanup: (cleanup) => {
      deviceCaptureCleanup?.();
      deviceCaptureCleanup = cleanup;
    },
    setKeyboardCaptureCleanup: (cleanup) => {
      keyboardCaptureCleanup?.();
      keyboardCaptureCleanup = cleanup;
    },
    updateInputSettings: (updater) => updateInputSettings(updater),
  });

  const controlsPanel = createGameMenuControlsPanel({
    cancelCapture: () => capture.cancelCapture(),
    controlsRoot,
    getControlsStatus: () => controlsStatus,
    getControlsTab: () => controlsTab,
    getCaptureState: () => captureState,
    getSettings,
    onControlsTabChange: (tab) => {
      controlsTab = tab;
      controlsStatus = '';
      capture.cancelCapture();
      renderControlsPanel();
    },
    resetControlsTab,
    startDeviceCapture: capture.startDeviceCapture,
    startKeyboardCapture: capture.startKeyboardCapture,
    updateDeviceProfile,
    updateInputSettings,
  });

  function cancelCapture(status = ''): void {
    capture.cancelCapture(status);
  }

  function startTelemetry(): void {
    if (telemetryInterval !== null) return;
    telemetryInterval = window.setInterval(() => {
      if (
        isOpen() &&
        getActiveTab() === 'controls' &&
        controlsTab === 'mouseKeyboard' &&
        !isCapturingControls()
      ) {
        renderControlsPanel();
      }
    }, 500);
  }

  function stopTelemetry(): void {
    if (telemetryInterval === null) return;
    window.clearInterval(telemetryInterval);
    telemetryInterval = null;
  }

  return {
    cancelCapture,
    isCapturingControls,
    renderControlsPanel,
    startTelemetry,
    stopAxisPreview,
    stopTelemetry,
  };
}
