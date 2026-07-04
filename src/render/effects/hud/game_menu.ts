import {
  applyRenderQualityAndReload,
  loadGameSettings,
  saveGameSettings,
  type GameSettings,
} from '../../../app/game_settings';
import {
  createDefaultInputSettings,
  DEVICE_BUTTON_ACTIONS,
  DEVICE_PROFILES,
  FLIGHT_ANALOG_CONTROLS,
  formatDeviceBinding,
  formatKeyboardBinding,
  formatKeyCode,
  isLikelyHotasGamepad,
  KEYBOARD_ACTIONS,
  type DeviceButtonActionId,
  type DeviceInputBinding,
  type DeviceInputProfileSettings,
  type DeviceProfileId,
  type FlightAnalogControlId,
  type InputSettings,
  type KeyboardActionId,
} from '../../../flight/input_settings';
import type { RenderQualityPreset } from '../../main/domain/render_quality';

export interface GameMenuElements {
  rootEl: HTMLElement;
  resumeBtnEl: HTMLButtonElement;
  exitBtnEl: HTMLButtonElement;
  chatInputEl: HTMLInputElement;
  masterVolumeEl: HTMLInputElement;
  sfxVolumeEl: HTMLInputElement;
  musicVolumeEl: HTMLInputElement;
  masterValueEl: HTMLElement;
  sfxValueEl: HTMLElement;
  musicValueEl: HTMLElement;
}

export interface GameMenuCallbacks {
  onExitGame: () => void;
}

type GameMenuTab = 'video' | 'audio' | 'controls' | 'exit';
type ControlsTab = 'mouseKeyboard' | DeviceProfileId;
type DeviceBindingGroup = 'analog' | 'button';

interface GamepadSnapshot {
  axes: number[];
  buttons: number[];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function cloneInputSettings(input: InputSettings): InputSettings {
  return JSON.parse(JSON.stringify(input)) as InputSettings;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

function createTextButton(className: string, textContent: string): HTMLButtonElement {
  const button = createElement('button', className, textContent);
  button.type = 'button';
  return button;
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

function formatDecimal(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

export function createGameMenu(elements: GameMenuElements, callbacks: GameMenuCallbacks) {
  let open = false;
  let activeTab: GameMenuTab = 'video';
  let controlsTab: ControlsTab = 'mouseKeyboard';
  let settings: GameSettings = loadGameSettings();
  let controlsStatus = '';
  let keyboardCaptureAction: KeyboardActionId | null = null;
  let deviceCapture:
    | {
        action: DeviceButtonActionId | FlightAnalogControlId;
        group: DeviceBindingGroup;
        profileId: DeviceProfileId;
      }
    | null = null;
  let keyboardCaptureCleanup: (() => void) | null = null;
  let deviceCaptureCleanup: (() => void) | null = null;
  let telemetryInterval: number | null = null;

  const navButtons = Array.from(
    elements.rootEl.querySelectorAll<HTMLButtonElement>('[data-game-menu-tab]'),
  );
  const panels = Array.from(
    elements.rootEl.querySelectorAll<HTMLElement>('[data-game-menu-panel]'),
  );
  const controlsRoot = elements.rootEl.querySelector<HTMLElement>('#game-menu-controls');
  const qualityInputs = Array.from(
    elements.rootEl.querySelectorAll<HTMLInputElement>('input[name="game-menu-quality"]'),
  );

  function isCapturingControls(): boolean {
    return keyboardCaptureAction !== null || deviceCapture !== null;
  }

  function syncQualityRadios(): void {
    for (const input of qualityInputs) {
      input.checked = input.value === settings.renderQuality;
    }
  }

  function syncAudioControls(): void {
    elements.masterVolumeEl.value = String(Math.round(settings.masterVolume * 100));
    elements.sfxVolumeEl.value = String(Math.round(settings.sfxVolume * 100));
    elements.musicVolumeEl.value = String(Math.round(settings.musicVolume * 100));
    elements.masterValueEl.textContent = formatPercent(settings.masterVolume);
    elements.sfxValueEl.textContent = formatPercent(settings.sfxVolume);
    elements.musicValueEl.textContent = formatPercent(settings.musicVolume);
  }

  function setActiveTab(tab: GameMenuTab): void {
    activeTab = tab;
    for (const button of navButtons) {
      button.classList.toggle('is-active', button.dataset.gameMenuTab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.gameMenuPanel === tab);
    }
    if (tab === 'controls') renderControlsPanel();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      syncQualityRadios();
      syncAudioControls();
      renderControlsPanel();
      startTelemetry();
      elements.resumeBtnEl.focus();
      return;
    }
    cancelCapture();
    stopTelemetry();
    elements.rootEl.blur();
  }

  function toggleOpen(): void {
    setOpen(!open);
  }

  function updateAudioSetting(
    key: 'masterVolume' | 'sfxVolume' | 'musicVolume',
    percent: number,
  ): void {
    settings = saveGameSettings({
      ...settings,
      [key]: percent / 100,
    });
    syncAudioControls();
  }

  function saveInputSettings(nextInput: InputSettings, rerender = true): void {
    settings = saveGameSettings({
      ...settings,
      input: nextInput,
    });
    if (rerender) renderControlsPanel();
  }

  function updateInputSettings(updater: (input: InputSettings) => void, rerender = true): void {
    const nextInput = cloneInputSettings(settings.input);
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

  function renderRangeControl(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    formatter: (next: number) => string,
    onInput: (next: number) => void,
  ): HTMLElement {
    const wrap = createElement('label', 'sc-game-menu-slider');
    const labelEl = createElement('span', 'sc-game-menu-slider-label', label);
    const valueEl = createElement('span', 'sc-game-menu-slider-value', formatter(value));
    const input = createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const next = Number.parseFloat(input.value);
      valueEl.textContent = formatter(next);
      onInput(next);
    });
    wrap.append(labelEl, valueEl, input);
    return wrap;
  }

  function renderToggle(
    label: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ): HTMLElement {
    const wrap = createElement('label', 'sc-game-menu-toggle');
    const input = createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(input, createElement('span', undefined, label));
    return wrap;
  }

  function renderControlsSubnav(): HTMLElement {
    const tabs = createElement('div', 'sc-game-menu-control-tabs');
    const tabDefinitions: readonly { id: ControlsTab; label: string }[] = [
      { id: 'mouseKeyboard', label: 'Mouse & Keyboard' },
      ...DEVICE_PROFILES,
    ];
    for (const tab of tabDefinitions) {
      const button = createTextButton('sc-game-menu-control-tab', tab.label);
      button.classList.toggle('is-active', controlsTab === tab.id);
      button.addEventListener('click', () => {
        controlsTab = tab.id;
        controlsStatus = '';
        cancelCapture();
        renderControlsPanel();
      });
      tabs.append(button);
    }
    return tabs;
  }

  function renderControlsStatus(): HTMLElement | null {
    if (!controlsStatus) return null;
    return createElement('p', 'sc-game-menu-control-status', controlsStatus);
  }

  function renderKeyboardControls(): HTMLElement {
    const panel = createElement('div', 'sc-game-menu-control-page');
    const mouseKeyboard = settings.input.mouseKeyboard;
    const ranges = createElement('div', 'sc-game-menu-control-grid');
    ranges.append(
      renderRangeControl('Look Sensitivity', mouseKeyboard.lookSensitivity, 0.2, 2.5, 0.05, formatDecimal, (next) =>
        updateInputSettings(
          (input) => {
            input.mouseKeyboard.lookSensitivity = next;
          },
          false,
        ),
      ),
      renderRangeControl(
        'Flight Mouse Sensitivity',
        mouseKeyboard.flightMouseSensitivity,
        0.2,
        2.5,
        0.05,
        formatDecimal,
        (next) =>
          updateInputSettings(
            (input) => {
              input.mouseKeyboard.flightMouseSensitivity = next;
            },
            false,
          ),
      ),
      renderToggle('Invert Mouse Y', mouseKeyboard.invertMouseY, (next) =>
        updateInputSettings((input) => {
          input.mouseKeyboard.invertMouseY = next;
        }),
      ),
    );

    const bindings = createElement('div', 'sc-game-menu-binding-list');
    for (const action of KEYBOARD_ACTIONS) {
      const row = createElement('div', 'sc-game-menu-binding-row');
      const label = createElement('span', 'sc-game-menu-binding-label', action.label);
      const bindButton = createTextButton(
        'sc-game-menu-bind-btn',
        keyboardCaptureAction === action.id
          ? 'Press a key...'
          : formatKeyboardBinding(mouseKeyboard.bindings[action.id]),
      );
      bindButton.addEventListener('click', () => startKeyboardCapture(action.id));
      row.append(label, bindButton);
      bindings.append(row);
    }

    const actions = createElement('div', 'sc-game-menu-control-actions');
    const reset = createTextButton('sc-title-btn sc-title-btn-secondary', 'Reset Mouse & Keyboard');
    reset.addEventListener('click', () => resetControlsTab('mouseKeyboard'));
    actions.append(reset);
    panel.append(ranges, bindings, actions);
    return panel;
  }

  function renderDetectedDevices(profileId: DeviceProfileId): HTMLElement {
    const wrap = createElement('div', 'sc-game-menu-device-list');
    const devices = getGamepads().filter((gamepad) => gamepadMatchesTab(gamepad, profileId));
    if (devices.length === 0) {
      wrap.append(createElement('p', 'sc-game-menu-note', 'No devices reported by the browser yet.'));
      return wrap;
    }
    for (const gamepad of devices) {
      const row = createElement('div', 'sc-game-menu-device-row');
      const title = createElement(
        'div',
        'sc-game-menu-device-name',
        `Device ${gamepad.index}: ${gamepad.id}`,
      );
      const axes = gamepad.axes
        .slice(0, 8)
        .map((value, index) => `${index}:${value.toFixed(2)}`)
        .join('  ');
      const pressedButtons = gamepad.buttons
        .map((button, index) => (button.pressed || button.value > 0.2 ? `${index}:${button.value.toFixed(2)}` : ''))
        .filter(Boolean)
        .join('  ');
      const details = createElement(
        'div',
        'sc-game-menu-device-readout',
        `Axes ${axes || 'none'} · Buttons ${pressedButtons || 'none'}`,
      );
      row.append(title, details);
      wrap.append(row);
    }
    return wrap;
  }

  function renderDeviceBindingButton(
    profileId: DeviceProfileId,
    group: DeviceBindingGroup,
    action: DeviceButtonActionId | FlightAnalogControlId,
    binding: DeviceInputBinding | null,
  ): HTMLButtonElement {
    const capturing =
      deviceCapture?.profileId === profileId &&
      deviceCapture.group === group &&
      deviceCapture.action === action;
    const button = createTextButton(
      'sc-game-menu-bind-btn',
      capturing ? 'Move input...' : formatDeviceBinding(binding),
    );
    button.addEventListener('click', () => startDeviceCapture(profileId, group, action));
    return button;
  }

  function renderDeviceControls(profileId: DeviceProfileId): HTMLElement {
    const panel = createElement('div', 'sc-game-menu-control-page');
    const profile = settings.input[profileId];
    const settingsGrid = createElement('div', 'sc-game-menu-control-grid');
    settingsGrid.append(
      renderToggle('Enabled', profile.enabled, (next) =>
        updateDeviceProfile(profileId, (profileSettings) => {
          profileSettings.enabled = next;
        }),
      ),
      renderRangeControl('Sensitivity', profile.sensitivity, 0.2, 2.5, 0.05, formatDecimal, (next) =>
        updateInputSettings(
          (input) => {
            input[profileId].sensitivity = next;
          },
          false,
        ),
      ),
      renderRangeControl('Deadzone', profile.deadzone, 0, 0.45, 0.01, (next) => `${Math.round(next * 100)}%`, (next) =>
        updateInputSettings(
          (input) => {
            input[profileId].deadzone = next;
          },
          false,
        ),
      ),
    );

    const devicesTitle = createElement('h4', 'sc-game-menu-section-title', 'Detected Devices');
    const analogTitle = createElement('h4', 'sc-game-menu-section-title', 'Flight Axes');
    const analogBindings = createElement('div', 'sc-game-menu-binding-list');
    for (const control of FLIGHT_ANALOG_CONTROLS) {
      const binding = profile.analogBindings[control.id];
      const row = createElement('div', 'sc-game-menu-binding-row');
      const label = createElement('span', 'sc-game-menu-binding-label', control.label);
      const bindButton = renderDeviceBindingButton(profileId, 'analog', control.id, binding);
      const extras = createElement('div', 'sc-game-menu-binding-extras');
      if (binding?.kind === 'axis') {
        extras.append(
          renderToggle('Invert', Boolean(binding.invert), (next) =>
            updateDeviceProfile(profileId, (profileSettings) => {
              const nextBinding = profileSettings.analogBindings[control.id];
              if (nextBinding?.kind === 'axis') nextBinding.invert = next;
            }),
          ),
        );
      }
      const clear = createTextButton('sc-game-menu-small-btn', 'Clear');
      clear.addEventListener('click', () =>
        updateDeviceProfile(profileId, (profileSettings) => {
          profileSettings.analogBindings[control.id] = null;
        }),
      );
      extras.append(clear);
      row.append(label, bindButton, extras);
      analogBindings.append(row);
    }

    const buttonTitle = createElement('h4', 'sc-game-menu-section-title', 'Buttons');
    const buttonBindings = createElement('div', 'sc-game-menu-binding-list');
    for (const action of DEVICE_BUTTON_ACTIONS) {
      const binding = profile.buttonBindings[action.id];
      const row = createElement('div', 'sc-game-menu-binding-row');
      const label = createElement('span', 'sc-game-menu-binding-label', action.label);
      const bindButton = renderDeviceBindingButton(profileId, 'button', action.id, binding);
      const extras = createElement('div', 'sc-game-menu-binding-extras');
      const clear = createTextButton('sc-game-menu-small-btn', 'Clear');
      clear.addEventListener('click', () =>
        updateDeviceProfile(profileId, (profileSettings) => {
          profileSettings.buttonBindings[action.id] = null;
        }),
      );
      extras.append(clear);
      row.append(label, bindButton, extras);
      buttonBindings.append(row);
    }

    const actions = createElement('div', 'sc-game-menu-control-actions');
    const reset = createTextButton(
      'sc-title-btn sc-title-btn-secondary',
      `Reset ${profileId === 'hotas' ? 'HOTAS' : 'Controller'}`,
    );
    reset.addEventListener('click', () => resetControlsTab(profileId));
    actions.append(reset);

    panel.append(
      settingsGrid,
      devicesTitle,
      renderDetectedDevices(profileId),
      analogTitle,
      analogBindings,
      buttonTitle,
      buttonBindings,
      actions,
    );
    return panel;
  }

  function renderControlsPanel(): void {
    if (!controlsRoot) return;
    controlsRoot.replaceChildren();
    controlsRoot.append(renderControlsSubnav());
    const status = renderControlsStatus();
    if (status) controlsRoot.append(status);
    controlsRoot.append(
      controlsTab === 'mouseKeyboard' ? renderKeyboardControls() : renderDeviceControls(controlsTab),
    );
  }

  function cancelCapture(status = ''): void {
    keyboardCaptureCleanup?.();
    deviceCaptureCleanup?.();
    keyboardCaptureCleanup = null;
    deviceCaptureCleanup = null;
    keyboardCaptureAction = null;
    deviceCapture = null;
    controlsStatus = status;
  }

  function startKeyboardCapture(action: KeyboardActionId): void {
    cancelCapture();
    keyboardCaptureAction = action;
    controlsStatus = `Press a key for ${KEYBOARD_ACTIONS.find((item) => item.id === action)?.label ?? action}.`;
    renderControlsPanel();
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        cancelCapture('Binding canceled.');
        renderControlsPanel();
        return;
      }
      updateInputSettings((input) => {
        input.mouseKeyboard.bindings[action] = { primary: event.code };
      });
      cancelCapture(`Bound to ${formatKeyCode(event.code)}.`);
      renderControlsPanel();
    };
    window.addEventListener('keydown', handleKey, true);
    keyboardCaptureCleanup = () => window.removeEventListener('keydown', handleKey, true);
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

  function saveDeviceBinding(
    profileId: DeviceProfileId,
    group: DeviceBindingGroup,
    action: DeviceButtonActionId | FlightAnalogControlId,
    binding: DeviceInputBinding,
  ): void {
    updateDeviceProfile(profileId, (profile) => {
      if (group === 'analog') {
        profile.analogBindings[action as FlightAnalogControlId] = binding;
        return;
      }
      profile.buttonBindings[action as DeviceButtonActionId] = binding;
    });
  }

  function startDeviceCapture(
    profileId: DeviceProfileId,
    group: DeviceBindingGroup,
    action: DeviceButtonActionId | FlightAnalogControlId,
  ): void {
    cancelCapture();
    const snapshots = snapshotProfileGamepads(profileId);
    if (snapshots.size === 0) {
      controlsStatus = 'No matching device is visible to the browser.';
      renderControlsPanel();
      return;
    }
    const startedAt = performance.now();
    deviceCapture = { action, group, profileId };
    controlsStatus = 'Move an axis or press a button.';
    renderControlsPanel();

    let frame = 0;
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelCapture('Binding canceled.');
      renderControlsPanel();
    };
    const tick = () => {
      const binding =
        group === 'analog'
          ? captureAxisInput(profileId, snapshots, group) ?? captureButtonInput(profileId, snapshots)
          : captureButtonInput(profileId, snapshots) ?? captureAxisInput(profileId, snapshots, group);
      if (binding) {
        saveDeviceBinding(profileId, group, action, binding);
        cancelCapture(`Bound to ${formatDeviceBinding(binding)}.`);
        renderControlsPanel();
        return;
      }
      if (performance.now() - startedAt > 8000) {
        cancelCapture('Binding timed out.');
        renderControlsPanel();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('keydown', handleKey, true);
    frame = requestAnimationFrame(tick);
    deviceCaptureCleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKey, true);
    };
  }

  function startTelemetry(): void {
    if (telemetryInterval !== null) return;
    telemetryInterval = window.setInterval(() => {
      if (open && activeTab === 'controls' && !isCapturingControls()) renderControlsPanel();
    }, 500);
  }

  function stopTelemetry(): void {
    if (telemetryInterval === null) return;
    window.clearInterval(telemetryInterval);
    telemetryInterval = null;
  }

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.gameMenuTab as GameMenuTab | undefined;
      if (!tab) return;
      setActiveTab(tab);
    });
  }

  for (const input of qualityInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const preset = input.value as RenderQualityPreset;
      if (preset === settings.renderQuality) return;
      applyRenderQualityAndReload(preset);
    });
  }

  elements.masterVolumeEl.addEventListener('input', () => {
    updateAudioSetting('masterVolume', Number.parseInt(elements.masterVolumeEl.value, 10));
  });
  elements.sfxVolumeEl.addEventListener('input', () => {
    updateAudioSetting('sfxVolume', Number.parseInt(elements.sfxVolumeEl.value, 10));
  });
  elements.musicVolumeEl.addEventListener('input', () => {
    updateAudioSetting('musicVolume', Number.parseInt(elements.musicVolumeEl.value, 10));
  });

  elements.resumeBtnEl.addEventListener('click', () => setOpen(false));
  elements.exitBtnEl.addEventListener('click', () => {
    setOpen(false);
    callbacks.onExitGame();
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isCapturingControls()) return;
    if (event.key !== 'Escape') return;
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (isTypingTarget(event.target) && event.target !== elements.chatInputEl) return;
    if (event.target === elements.chatInputEl) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };

  window.addEventListener('keydown', handleKeyDown, true);

  syncQualityRadios();
  syncAudioControls();
  renderControlsPanel();

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      cancelCapture();
      stopTelemetry();
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    close() {
      setOpen(false);
    },
    open() {
      setOpen(true);
    },
    toggle: toggleOpen,
  };
}

export type GameMenuController = ReturnType<typeof createGameMenu>;
