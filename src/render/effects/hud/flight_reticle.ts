import type { QuantumTravelState } from '../../../flight/quantum_travel';
import { MODE_IN_SHIP } from '../../../player/modes';
import type { ShipFlightMode } from '../../../flight/flight_modes';
import type { GameMode, Vec3 } from '../../../types';

export interface FlightReticleElements {
  rootEl: HTMLElement;
}

export interface FlightReticleUpdateParams {
  mode: GameMode;
  flightMode: ShipFlightMode;
  quantum: QuantumTravelState;
  /** When set, drives dual-reticle aim + nose pip placement. */
  dual?: {
    /** Aim pip offset from screen center in CSS pixels. */
    aimOffsetPx: { x: number; y: number };
    /** Nose pip offset from screen center in CSS pixels. */
    noseOffsetPx: { x: number; y: number };
    coupled: boolean;
  };
}

/** Project a world direction onto screen-pixel offset from center (cockpit HUD). */
export function projectDirectionToReticleOffset(
  direction: Vec3,
  cameraForward: Vec3,
  cameraRight: Vec3,
  cameraUp: Vec3,
  fovYRadians: number,
  viewportHeightPx: number,
  maxOffsetPx = 140,
): { x: number; y: number; behind: boolean } {
  const depth =
    direction.x * cameraForward.x +
    direction.y * cameraForward.y +
    direction.z * cameraForward.z;
  const behind = depth <= 0.05;
  const right =
    direction.x * cameraRight.x +
    direction.y * cameraRight.y +
    direction.z * cameraRight.z;
  const up =
    direction.x * cameraUp.x + direction.y * cameraUp.y + direction.z * cameraUp.z;
  const halfFov = Math.max(0.1, fovYRadians * 0.5);
  const scale = (viewportHeightPx * 0.5) / Math.tan(halfFov);
  const safeDepth = Math.max(0.05, Math.abs(depth));
  let x = (right / safeDepth) * scale;
  let y = (-up / safeDepth) * scale;
  const mag = Math.hypot(x, y);
  if (mag > maxOffsetPx || behind) {
    const rim = Math.max(mag, 1e-6);
    x = (x / rim) * maxOffsetPx;
    y = (y / rim) * maxOffsetPx;
  }
  return { x, y, behind };
}

export function createFlightReticle(elements: FlightReticleElements) {
  let aimPip = elements.rootEl.querySelector<HTMLElement>('.sc-flight-reticle-aim');
  let nosePip = elements.rootEl.querySelector<HTMLElement>('.sc-flight-reticle-nose');
  if (!aimPip) {
    aimPip = document.createElement('div');
    aimPip.className = 'sc-flight-reticle-aim';
    elements.rootEl.appendChild(aimPip);
  }
  if (!nosePip) {
    nosePip = document.createElement('div');
    nosePip.className = 'sc-flight-reticle-nose';
    elements.rootEl.appendChild(nosePip);
  }

  function update({ mode, flightMode, quantum, dual }: FlightReticleUpdateParams): void {
    const visible = mode === MODE_IN_SHIP;
    elements.rootEl.classList.toggle('is-visible', visible);
    if (!visible) return;

    elements.rootEl.dataset.flightMode = flightMode;
    elements.rootEl.dataset.quantumPhase = quantum.phase;
    elements.rootEl.dataset.coupled = dual?.coupled === false ? '0' : '1';

    // Full-screen overlay; aim (primary) + nose (lag) move from screen center.
    elements.rootEl.style.transform = '';
    if (dual) {
      aimPip!.style.transform = `translate(calc(-50% + ${dual.aimOffsetPx.x}px), calc(-50% + ${dual.aimOffsetPx.y}px))`;
      nosePip!.style.transform = `translate(calc(-50% + ${dual.noseOffsetPx.x}px), calc(-50% + ${dual.noseOffsetPx.y}px))`;
      nosePip!.style.opacity = '1';
      aimPip!.style.opacity = '1';
    } else {
      aimPip!.style.transform = 'translate(-50%, -50%)';
      nosePip!.style.transform = 'translate(-50%, -50%)';
      nosePip!.style.opacity = '0';
      aimPip!.style.opacity = '0';
    }
  }

  return { update };
}
