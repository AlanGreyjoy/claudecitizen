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
  'KeyY',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

const EXIT_SEAT_HOLD_SECONDS = 0.5;
const SEAT_LOOK_SNAP_HALF_LIFE_SECONDS = 0.35;
const SEAT_LOOK_YAW_SENSITIVITY = 0.0035;
const SEAT_LOOK_PITCH_SENSITIVITY = 0.0028;

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clampPitch(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

interface PlayerControlsOptions {
  onReset?: () => void;
}

export function createPlayerControls(canvas: HTMLCanvasElement, { onReset }: PlayerControlsOptions = {}) {
  const keys = new Set<string>();
  const justPressed = new Set<string>();
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

  function resetSeatLookState(): void {
    seatLook.pitchRadians = 0;
    seatLook.yawRadians = 0;
    yHeldSinceMs = null;
    exitSeatTriggered = false;
  }

  function isSeatLookActive(): boolean {
    return mode === 'in-ship' && keys.has('KeyF') && shipCameraView === 'cockpit';
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
    if (!HANDLED_KEYS.has(event.code)) return;
    event.preventDefault();
    if (down) {
      if (event.code === 'KeyR') onReset?.();
      if (!keys.has(event.code) && event.code === 'KeyV') toggleCameraView();
      if (event.code === 'KeyY' && mode === 'in-ship' && yHeldSinceMs === null) {
        yHeldSinceMs = performance.now();
        exitSeatTriggered = false;
      }
      if (
        !keys.has(event.code) &&
        (event.code === 'KeyF' || event.code === 'Space' || event.code.startsWith('Digit'))
      ) {
        // F is hold-only while seated; tap-F interact stays for deck/doors/ramp.
        if (!(event.code === 'KeyF' && mode === 'in-ship')) {
          justPressed.add(event.code);
        }
      }
      keys.add(event.code);
      return;
    }
    if (event.code === 'KeyY') {
      yHeldSinceMs = null;
      exitSeatTriggered = false;
    }
    keys.delete(event.code);
  }

  function onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    if (mode === 'in-ship') {
      if (isSeatLookActive()) {
        seatLook.yawRadians -= event.movementX * SEAT_LOOK_YAW_SENSITIVITY;
        seatLook.pitchRadians = clampPitch(
          seatLook.pitchRadians - event.movementY * SEAT_LOOK_PITCH_SENSITIVITY,
          FIRST_PERSON_PITCH_LIMIT,
        );
        return;
      }
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
    resetSeatLookState();
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

  function updateExitSeatHold(): boolean {
    if (mode !== 'in-ship' || !keys.has('KeyY')) return false;
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
      exitSeatPressed: updateExitSeatHold(),
      jumpPressed: justPressed.has('Space'),
      hangarDigit,
    };
    justPressed.clear();
    return actions;
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
