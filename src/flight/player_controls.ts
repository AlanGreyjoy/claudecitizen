import type { CameraView, GameMode, ShipCameraView } from '../types';
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

const HANDLED_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Digit1',
  'Digit2',
  'Digit3',
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyV',
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
  let cameraView: CameraView = 'third-person';
  let shipCameraView: ShipCameraView = 'cockpit';

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
    if (!HANDLED_KEYS.has(event.code)) return;
    event.preventDefault();
    if (down) {
      if (event.code === 'KeyR') onReset?.();
      if (!keys.has(event.code) && event.code === 'KeyV') toggleCameraView();
      if (
        !keys.has(event.code) &&
        (event.code === 'KeyF' || event.code === 'Space' || event.code.startsWith('Digit'))
      ) {
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
    const pitchLimit = cameraView === 'first-person' ? FIRST_PERSON_PITCH_LIMIT : ORBIT_PITCH_LIMIT;
    orbitLook.yawRadians -= event.movementX * 0.0035;
    orbitLook.pitchRadians = Math.max(
      -pitchLimit,
      Math.min(pitchLimit, orbitLook.pitchRadians - event.movementY * 0.0028),
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
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onCanvasClick);

  function consumeActions() {
    const hangarDigit = justPressed.has('Digit1')
      ? 1
      : justPressed.has('Digit2')
        ? 2
        : justPressed.has('Digit3')
          ? 3
          : null;
    const actions = {
      interactPressed: justPressed.has('KeyF'),
      jumpPressed: justPressed.has('Space'),
      hangarDigit,
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
      cameraView,
      pitchRadians: orbitLook.pitchRadians,
      shipCameraView,
      shipZoomDistance: shipLook.zoomDistance,
      yawRadians: orbitLook.yawRadians,
      zoomDistance: orbitLook.zoomDistance,
    };
  }

  function sampleCharacterInput() {
    return {
      ...buildCharacterInput(keys, orbitLook),
      faceCameraYaw: cameraView === 'first-person',
    };
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
      // Taking the pilot seat always starts in the cockpit view.
      if (nextMode === 'in-ship' && mode !== 'in-ship') shipCameraView = 'cockpit';
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
