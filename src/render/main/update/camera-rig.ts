import * as THREE from 'three';
import type { CharacterRenderState, SpikeRenderWorld, Vec3 } from '../../../types';
import {
  MODE_IN_BED,
  MODE_IN_STATION,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from '../../../player/modes';
import {
  updateCharacterOrbitCameraRig,
  updateInBedCameraRig,
  updateInShipCameraRig,
} from './camera_rig_modes';
import type { StationCameraContext } from './camera_rig_types';

export type { StationCameraContext } from './camera_rig_types';
export { clampOffsetToRoom, clampOffsetToShipZone } from './camera_rig_clamp';

const WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS = 0.07;

function smoothVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dt: number,
  halfLife: number,
): void {
  if (dt <= 0) return;
  const smoothness = Math.LN2 / halfLife;
  const blend = 1 - Math.exp(-smoothness * dt);
  current.lerp(target, blend);
}

function resolveWeaponAimZoom01(
  camera: THREE.PerspectiveCamera,
  world: SpikeRenderWorld,
  dt: number,
): number {
  const previousWeaponAimZoom =
    typeof camera.userData.weaponAimZoom01 === 'number'
      ? camera.userData.weaponAimZoom01 as number
      : 0;
  const weaponAimZoomTarget = world.weaponAimActive ? 1 : 0;
  const weaponAimZoomBlend = dt <= 0
    ? 0
    : 1 - Math.exp((-Math.LN2 * dt) / WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS);
  const weaponAimZoom01 = previousWeaponAimZoom
    + (weaponAimZoomTarget - previousWeaponAimZoom) * weaponAimZoomBlend;
  camera.userData.weaponAimZoom01 = weaponAimZoom01;
  return weaponAimZoom01;
}

export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  altitudeFactor: number,
  shipUp: Vec3,
  shipForward: Vec3,
  options: {
    station?: StationCameraContext | null;
    dt?: number;
  } = {},
): void {
  const station = options.station ?? null;
  const dt = options.dt ?? 0.016;
  const {
    character = null,
    mode = 'in-ship',
    shipExteriorWalk = false,
  } = world;
  const stationActive =
    station !== null && (mode === MODE_IN_STATION || mode === MODE_RIDING_ELEVATOR);
  const onShipDeckInterior = mode === MODE_ON_SHIP_DECK && !shipExteriorWalk;
  const weaponAimZoom01 = resolveWeaponAimZoom01(camera, world, dt);

  const focusPosition =
    mode === 'in-ship' || mode === MODE_IN_BED || !character
      ? world.ship.position
      : character.position;
  const focusVec = new THREE.Vector3(focusPosition.x, focusPosition.y, focusPosition.z);

  if (mode === MODE_IN_BED) {
    updateInBedCameraRig(camera, cameraTarget, world, renderScale, shipUp, shipForward);
  } else if (mode === 'in-ship' || !character) {
    updateInShipCameraRig({
      camera,
      cameraTarget,
      world,
      renderScale,
      altitudeFactor,
      shipUp,
      shipForward,
      focusVec,
      dt,
      smoothVector,
    });
  } else {
    updateCharacterOrbitCameraRig({
      camera,
      cameraTarget,
      world,
      renderScale,
      shipUp,
      shipForward,
      focusPosition,
      focusVec,
      weaponAimZoom01,
      station,
      stationActive,
      onShipDeckInterior,
      dt,
      smoothVector,
    });
  }

  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}

export function updateSpeedBlur(
  speedBlurEffect: { setStrength: (value: number) => void },
  world: SpikeRenderWorld,
): void {
  const { character = null, mode = 'in-ship', ship, quantum } = world;
  if (quantum?.phase === 'traveling') {
    // Skip the 8-tap radial blur during warp — planet tile thrash was the
    // bigger hit, but this still costs a full-screen pass for little read.
    speedBlurEffect.setStrength(0);
    return;
  }
  if (quantum?.phase === 'spooling') {
    const spoolT = quantum.spoolElapsed / Math.max(quantum.spoolDuration, 0.001);
    speedBlurEffect.setStrength(spoolT * 0.02);
    return;
  }
  if (quantum?.phase === 'dropOut') {
    speedBlurEffect.setStrength(0);
    return;
  }

  const focusVelocity =
    mode === 'in-ship' || mode === MODE_IN_BED
      ? ship.velocity
      : (character as CharacterRenderState & { velocity?: Vec3 })!.velocity;
  const speed = focusVelocity ? Math.hypot(focusVelocity.x, focusVelocity.y, focusVelocity.z) : 0;

  if (mode === 'in-ship') {
    const t = Math.max(0, Math.min(1, (speed - 120) / 1000));
    speedBlurEffect.setStrength(t * 0.045);
  } else if (mode === MODE_IN_BED) {
    speedBlurEffect.setStrength(0);
  } else {
    const t = Math.max(0, Math.min(1, (speed - 6) / 10));
    speedBlurEffect.setStrength(t * 0.012);
  }
}
