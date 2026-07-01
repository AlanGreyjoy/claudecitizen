import type { GameMode } from '../types';
import {
  applyShipWheelZoom,
  applyWheelZoom,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_SHIP_CAMERA_ZOOM,
  normalizeWheelDelta,
  updateSmoothZoom,
} from './camera_zoom';
import { buildCharacterInput, buildFlightInput } from './control_mix';
import { ORBIT_PITCH_LIMIT } from '../player/character_controller';

const HANDLED_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyW',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

interface PlayerControlsOptions {
  onReset?: () => void;
}

export function createPlayerControls(canvas: HTMLCanvasElement, { onReset }: PlayerControlsOptions = {}) {
  const keys = new Set<string>();
  const justPressed = new Set<string>();
  const flightLook = { pitch01: 0, yaw01: 0 };
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

  function onKeyChange(event: KeyboardEvent, down: boolean) {
    if (!HANDLED_KEYS.has(event.code)) return;
    event.preventDefault();
    if (down) {
      if (event.code === 'KeyR') onReset?.();
      if (!keys.has(event.code) && (event.code === 'KeyF' || event.code === 'Space')) {
        justPressed.add(event.code);
      }
      keys.add(event.code);
      return;
    }
    keys.delete(event.code);
  }

  function onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    if (mode === 'in-ship') {
      flightLook.yaw01 = clampAxis(flightLook.yaw01 - event.movementX * 0.015);
      flightLook.pitch01 = clampAxis(flightLook.pitch01 - event.movementY * 0.015);
      return;
    }
    orbitLook.yawRadians -= event.movementX * 0.0035;
    orbitLook.pitchRadians = Math.max(
      -ORBIT_PITCH_LIMIT,
      Math.min(ORBIT_PITCH_LIMIT, orbitLook.pitchRadians - event.movementY * 0.0028),
    );
  }

  function onCanvasClick() {
    canvas.requestPointerLock?.();
  }

  function onBlur() {
    keys.clear();
    justPressed.clear();
    flightLook.pitch01 = 0;
    flightLook.yaw01 = 0;
  }

  const handleKeyDown = (event: KeyboardEvent) => onKeyChange(event, true);
  const handleKeyUp = (event: KeyboardEvent) => onKeyChange(event, false);

  function onWheel(event: WheelEvent) {
    const delta = normalizeWheelDelta(event);
    if (delta === 0) return;
    event.preventDefault();
    if (mode === 'in-ship') {
      shipLook.targetZoomDistance = applyShipWheelZoom(shipLook.targetZoomDistance, delta);
      return;
    }
    orbitLook.targetZoomDistance = applyWheelZoom(orbitLook.targetZoomDistance, delta);
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onCanvasClick);

  function consumeActions() {
    const actions = {
      interactPressed: justPressed.has('KeyF'),
      jumpPressed: justPressed.has('Space'),
    };
    justPressed.clear();
    return actions;
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
    return {
      pitchRadians: orbitLook.pitchRadians,
      shipZoomDistance: shipLook.zoomDistance,
      yawRadians: orbitLook.yawRadians,
      zoomDistance: orbitLook.zoomDistance,
    };
  }

  function sampleCharacterInput() {
    return buildCharacterInput(keys, orbitLook);
  }

  function sampleFlightInput() {
    const input = buildFlightInput(keys, flightLook);
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
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('click', onCanvasClick);
  }

  return {
    consumeActions,
    dispose,
    isPointerLocked() {
      return document.pointerLockElement === canvas;
    },
    sampleCameraState,
    sampleCharacterInput,
    sampleFlightInput,
    setMode(nextMode: GameMode | 'on-foot' | 'in-ship') {
      mode = nextMode;
      if (mode !== 'in-ship') {
        flightLook.pitch01 = 0;
        flightLook.yaw01 = 0;
      }
    },
  };
}
