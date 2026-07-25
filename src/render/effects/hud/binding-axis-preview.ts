import {
  FLIGHT_ANALOG_CONTROLS,
  readDeviceAnalogAxes,
  type DeviceInputProfileSettings,
  type DeviceProfileId,
  type FlightAnalogControlId,
} from '../../../flight/input_settings';

export interface BindingAxisPreview {
  root: HTMLElement;
  start: () => () => void;
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

function getGamepads(): Gamepad[] {
  return Array.from(navigator.getGamepads?.() ?? []).filter((gamepad): gamepad is Gamepad =>
    Boolean(gamepad),
  );
}

const METER_IDS = FLIGHT_ANALOG_CONTROLS.map((control) => control.id);

function createShipMesh(): HTMLElement {
  const ship = createElement('div', 'sc-binding-preview-ship');
  const parts = [
    'fuselage',
    'fuselage-side',
    'nose',
    'canopy',
    'wing-left',
    'wing-right',
    'fin',
    'engine',
    'plume',
  ] as const;
  for (const part of parts) {
    ship.append(createElement('div', `sc-binding-preview-part is-${part}`));
  }
  return ship;
}

export function createBindingAxisPreview(
  profileId: DeviceProfileId,
  getProfile: () => DeviceInputProfileSettings,
): BindingAxisPreview {
  const root = createElement('aside', 'sc-binding-preview');
  root.setAttribute('aria-label', 'Live binding preview');

  const title = createElement('h4', 'sc-game-menu-section-title', 'Live Preview');
  const hint = createElement(
    'p',
    'sc-binding-preview-hint',
    'Move sticks to verify pitch, yaw, roll, and thrust before resume.',
  );

  const stage = createElement('div', 'sc-binding-preview-stage');
  const pad = createElement('div', 'sc-binding-preview-pad');
  const camera = createElement('div', 'sc-binding-preview-camera');
  const rig = createElement('div', 'sc-binding-preview-rig');
  rig.append(createShipMesh());
  camera.append(rig);
  stage.append(pad, camera);

  const meters = createElement('div', 'sc-binding-preview-meters');
  const fillEls = {} as Record<FlightAnalogControlId, HTMLElement>;
  const valueEls = {} as Record<FlightAnalogControlId, HTMLElement>;

  for (const control of FLIGHT_ANALOG_CONTROLS) {
    const row = createElement('div', 'sc-binding-preview-meter');
    const label = createElement('span', 'sc-binding-preview-meter-label', control.label);
    const track = createElement('div', 'sc-binding-preview-meter-track');
    const fill = createElement('div', 'sc-binding-preview-meter-fill');
    const value = createElement('span', 'sc-binding-preview-meter-value', '0.00');
    track.append(fill);
    row.append(label, track, value);
    meters.append(row);
    fillEls[control.id] = fill;
    valueEls[control.id] = value;
  }

  root.append(title, hint, stage, meters);

  function applyAxes(axes: Record<FlightAnalogControlId, number>): void {
    const pitch = axes.pitch;
    const yaw = axes.yaw;
    const roll = axes.roll;
    const throttle = axes.throttle;
    const strafe = axes.strafe;
    const lift = axes.lift;

    // Ship-local motion on top of the fixed isometric camera.
    // Mesh nose is -Y, wings ±X, canopy +Z.
    // +pitch nose up, +yaw right, +roll right wing down.
    const rotX = (-pitch * 38).toFixed(2);
    const rotY = (yaw * 38).toFixed(2);
    const rotZ = (-roll * 48).toFixed(2);
    const tx = (strafe * 26).toFixed(2);
    const ty = (-throttle * 28).toFixed(2);
    const tz = (lift * 24).toFixed(2);

    rig.style.transform = [
      `translate3d(${tx}px, ${ty}px, ${tz}px)`,
      `rotateZ(${rotZ}deg)`,
      `rotateY(${rotY}deg)`,
      `rotateX(${rotX}deg)`,
    ].join(' ');

    const thrust = Math.max(0.18, 0.22 + Math.abs(throttle) * 0.95 + Math.max(0, lift) * 0.2);
    root.style.setProperty('--sc-binding-thrust', thrust.toFixed(3));
    root.classList.toggle('is-active', METER_IDS.some((id) => Math.abs(axes[id]) > 0.03));

    for (const id of METER_IDS) {
      const value = axes[id];
      const fill = fillEls[id];
      const valueEl = valueEls[id];
      const width = Math.abs(value) * 50;
      fill.style.width = `${width}%`;
      fill.style.left = value >= 0 ? '50%' : `${50 - width}%`;
      fill.classList.toggle('is-negative', value < -0.02);
      fill.classList.toggle('is-positive', value > 0.02);
      valueEl.textContent = value.toFixed(2);
    }
  }

  function start(): () => void {
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (root.isConnected) {
        applyAxes(readDeviceAnalogAxes(getProfile(), profileId, getGamepads()));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }

  return { root, start };
}
