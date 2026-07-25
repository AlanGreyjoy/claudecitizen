import * as THREE from 'three';
import type { SpikeRenderWorld, Vec3 } from '../../../types';
import {
  FIRST_PERSON_PITCH_LIMIT,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
  resolveOrbitCamera,
} from '../../../player/character_controller';
import { getBedEyeLocal, getPilotEyeLocal } from '../../../player/ship_interaction';
import { add, cross, normalize, rotateAroundAxis, scale } from '../../../math/vec3';
import { v3 } from '../domain/math';
import type { StationCameraContext } from './camera_rig_types';
import { clampOffsetToRoom, clampOffsetToShipZone } from './camera_rig_clamp';

const WEAPON_AIM_ZOOM_SCALE = 0.86;

type CameraSmoothFn = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  frameDt: number,
  halfLife: number,
) => void;

interface ExternalShipCameraRigOptions {
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  focusVec: THREE.Vector3;
  altitudeFactor: number;
  shipUp: Vec3;
  shipForward: Vec3;
  shipCameraZoom: number;
  renderScale: number;
  dt: number;
  smoothVector: CameraSmoothFn;
}

interface InShipCameraRigOptions {
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  world: SpikeRenderWorld;
  renderScale: number;
  altitudeFactor: number;
  shipUp: Vec3;
  shipForward: Vec3;
  focusVec: THREE.Vector3;
  dt: number;
  smoothVector: CameraSmoothFn;
}

interface CharacterOrbitCameraRigOptions {
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  world: SpikeRenderWorld;
  renderScale: number;
  shipUp: Vec3;
  shipForward: Vec3;
  focusPosition: Vec3;
  focusVec: THREE.Vector3;
  weaponAimZoom01: number;
  station: StationCameraContext | null;
  stationActive: boolean;
  onShipDeckInterior: boolean;
  dt: number;
  smoothVector: CameraSmoothFn;
}

function resolveShipDeckOrbit(
  shipForward: Vec3,
  shipUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number = ORBIT_PITCH_LIMIT,
) {
  const up = normalize(shipUp);
  const deckForward = normalize(shipForward);
  const deckRight = normalize(cross(deckForward, up));
  const deckYawRadians = -yawRadians;
  const planarForward = normalize(
    add(
      scale(deckForward, Math.cos(deckYawRadians)),
      scale(deckRight, Math.sin(deckYawRadians)),
    ),
  );
  const right = normalize(cross(planarForward, up));
  const clampedPitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitchRadians));
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    pitchRadians: clampedPitch,
    right,
    up,
  };
}

function resolveSeatLookForward(
  shipForward: Vec3,
  shipUp: Vec3,
  seatLook: NonNullable<SpikeRenderWorld['seatLook']>,
) {
  return resolveShipDeckOrbit(
    shipForward,
    shipUp,
    seatLook.yawRadians,
    seatLook.pitchRadians,
    FIRST_PERSON_PITCH_LIMIT,
  ).forward;
}

function seatLookActive(seatLook: SpikeRenderWorld['seatLook']): boolean {
  return Boolean(
    seatLook &&
      (Math.abs(seatLook.yawRadians) > 1e-6 || Math.abs(seatLook.pitchRadians) > 1e-6),
  );
}

function clearCameraSmoothing(camera: THREE.PerspectiveCamera): void {
  camera.userData.smoothedWorldPos = null;
  camera.userData.smoothedWorldTarget = null;
}

function applyShipFrameLookAt(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  shipUp: Vec3,
  eye: Vec3,
  lookForward: Vec3,
  renderScale: number,
  lookMeters = 60,
): void {
  camera.position.set(eye.x * renderScale, eye.y * renderScale, eye.z * renderScale);
  cameraTarget.set(
    (eye.x + lookForward.x * lookMeters) * renderScale,
    (eye.y + lookForward.y * lookMeters) * renderScale,
    (eye.z + lookForward.z * lookMeters) * renderScale,
  );
  camera.up.copy(v3(shipUp));
}

function resolveShipEyeLocal(
  pilotEye: ReturnType<typeof getPilotEyeLocal>,
  shake: NonNullable<NonNullable<SpikeRenderWorld['flightCameraFeel']>['eyeShake']> | undefined,
) {
  if (!shake) return pilotEye;
  return {
    right: pilotEye.right + shake.right,
    up: pilotEye.up + shake.up,
    forward: pilotEye.forward + shake.forward,
  };
}

function buildShipEye(
  shipRight: Vec3,
  shipUp: Vec3,
  shipForward: Vec3,
  eyeLocal: { right: number; up: number; forward: number },
): Vec3 {
  return add(
    add(scale(shipRight, eyeLocal.right), scale(shipUp, eyeLocal.up)),
    scale(shipForward, eyeLocal.forward),
  );
}

export function updateInBedCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  shipUp: Vec3,
  shipForward: Vec3,
): void {
  clearCameraSmoothing(camera);

  const esFeel = world.entertainmentCameraFeel;
  if (esFeel) {
    if (typeof camera.userData.baseFovDeg !== 'number') {
      camera.userData.baseFovDeg = camera.fov;
    }
    camera.fov = (camera.userData.baseFovDeg as number) + esFeel.fovDeltaDeg;
    camera.updateProjectionMatrix();
    camera.position.set(
      esFeel.eye.x * renderScale,
      esFeel.eye.y * renderScale,
      esFeel.eye.z * renderScale,
    );
    cameraTarget.set(
      esFeel.lookTarget.x * renderScale,
      esFeel.lookTarget.y * renderScale,
      esFeel.lookTarget.z * renderScale,
    );
    camera.up.copy(v3(shipUp));
    return;
  }

  if (typeof camera.userData.baseFovDeg === 'number') {
    camera.fov = camera.userData.baseFovDeg;
    camera.updateProjectionMatrix();
  }
  const shipRight = normalize(cross(shipForward, shipUp));
  const bedEye = getBedEyeLocal(world.activeBedId) ?? getPilotEyeLocal();
  const eye = buildShipEye(shipRight, shipUp, shipForward, bedEye);
  const lookForward = seatLookActive(world.seatLook)
    ? resolveSeatLookForward(shipForward, shipUp, world.seatLook!)
    : shipForward;
  applyShipFrameLookAt(camera, cameraTarget, shipUp, eye, lookForward, renderScale);
}

function updateCockpitCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  shipUp: Vec3,
  shipForward: Vec3,
): void {
  clearCameraSmoothing(camera);

  const shipRight = normalize(cross(shipForward, shipUp));
  const pilotEye = getPilotEyeLocal();
  const eyeLocal = resolveShipEyeLocal(pilotEye, world.flightCameraFeel?.eyeShake);
  const eye = buildShipEye(shipRight, shipUp, shipForward, eyeLocal);
  const lookForward = seatLookActive(world.seatLook)
    ? resolveSeatLookForward(shipForward, shipUp, world.seatLook!)
    : shipForward;
  applyShipFrameLookAt(camera, cameraTarget, shipUp, eye, lookForward, renderScale);

  if (typeof camera.userData.baseFovDeg !== 'number') {
    camera.userData.baseFovDeg = camera.fov;
  }
  const fovDelta = world.flightCameraFeel?.fovDeltaDeg ?? 0;
  camera.fov = (camera.userData.baseFovDeg as number) + fovDelta;
  camera.updateProjectionMatrix();
}

function updateExternalShipCameraRig(options: ExternalShipCameraRigOptions): void {
  const {
    camera,
    cameraTarget,
    focusVec,
    altitudeFactor,
    shipUp,
    shipForward,
    shipCameraZoom,
    renderScale,
    dt,
    smoothVector,
  } = options;
  if (typeof camera.userData.baseFovDeg === 'number') {
    camera.fov = camera.userData.baseFovDeg;
    camera.updateProjectionMatrix();
  }
  const zoom = shipCameraZoom ?? 1.0;
  const cameraBackMeters = (58 + altitudeFactor * 180) * zoom;
  const cameraUpMeters = (9 + altitudeFactor * 136) * zoom;
  const desiredCameraOffset = new THREE.Vector3(
    -shipForward.x * cameraBackMeters + shipUp.x * cameraUpMeters,
    -shipForward.y * cameraBackMeters + shipUp.y * cameraUpMeters,
    -shipForward.z * cameraBackMeters + shipUp.z * cameraUpMeters,
  );
  const desiredTargetOffset = new THREE.Vector3(
    shipForward.x * (170 + altitudeFactor * 340) + shipUp.x * (-6 + altitudeFactor * 52),
    shipForward.y * (170 + altitudeFactor * 340) + shipUp.y * (-6 + altitudeFactor * 52),
    shipForward.z * (170 + altitudeFactor * 340) + shipUp.z * (-6 + altitudeFactor * 52),
  );

  const desiredWorldPos = new THREE.Vector3().copy(focusVec).add(desiredCameraOffset);
  const desiredWorldTarget = new THREE.Vector3().copy(focusVec).add(desiredTargetOffset);

  if (!camera.userData.smoothedWorldPos) {
    camera.userData.smoothedWorldPos = new THREE.Vector3().copy(desiredWorldPos);
    camera.userData.smoothedWorldTarget = new THREE.Vector3().copy(desiredWorldTarget);
  }

  smoothVector(camera.userData.smoothedWorldPos, desiredWorldPos, dt, 0.06);
  smoothVector(camera.userData.smoothedWorldTarget, desiredWorldTarget, dt, 0.04);

  camera.position.copy(camera.userData.smoothedWorldPos).sub(focusVec).multiplyScalar(renderScale);
  cameraTarget.copy(camera.userData.smoothedWorldTarget).sub(focusVec).multiplyScalar(renderScale);
}

export function updateInShipCameraRig(options: InShipCameraRigOptions): void {
  const {
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
  } = options;
  if ((world.shipCameraView ?? 'cockpit') === 'cockpit') {
    updateCockpitCameraRig(camera, cameraTarget, world, renderScale, shipUp, shipForward);
  } else {
    updateExternalShipCameraRig({
      camera,
      cameraTarget,
      focusVec,
      altitudeFactor,
      shipUp,
      shipForward,
      shipCameraZoom: world.shipCameraZoom ?? 1.0,
      renderScale,
      dt,
      smoothVector,
    });
  }
  camera.up.copy(v3(shipUp));
}

export function updateCharacterOrbitCameraRig(options: CharacterOrbitCameraRigOptions): void {
  const {
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
  } = options;
  if (typeof camera.userData.baseFovDeg === 'number') {
    camera.fov = camera.userData.baseFovDeg;
    camera.updateProjectionMatrix();
  }

  const { cameraOrbit = { pitchRadians: -0.35, yawRadians: 0, zoomDistance: 7.4 }, character } = world;
  const orbit =
    stationActive && station
      ? resolveShipDeckOrbit(
          station.frame.forward,
          station.frame.up,
          cameraOrbit.yawRadians,
          cameraOrbit.pitchRadians,
          ORBIT_PITCH_LIMIT,
        )
      : onShipDeckInterior
        ? resolveShipDeckOrbit(
            shipForward,
            shipUp,
            cameraOrbit.yawRadians,
            cameraOrbit.pitchRadians,
            ORBIT_PITCH_LIMIT,
          )
        : resolveOrbitCamera(
            character!.position,
            cameraOrbit.yawRadians,
            cameraOrbit.pitchRadians,
            ORBIT_PITCH_LIMIT,
          );

  const baseZoomDistance = cameraOrbit.zoomDistance ?? 7.4;
  const zoomDistance = baseZoomDistance * (1 - (1 - WEAPON_AIM_ZOOM_SCALE) * weaponAimZoom01);
  const rig = resolveCharacterCameraRig(orbit, zoomDistance);
  let positionOffset = rig.positionOffset;
  if (stationActive && station) {
    positionOffset = clampOffsetToRoom(positionOffset, character!.position, station);
  } else if (onShipDeckInterior) {
    positionOffset = clampOffsetToShipZone(
      positionOffset,
      character!.position,
      world,
      shipUp,
      shipForward,
    );
  }

  const desiredWorldPos = new THREE.Vector3(
    focusPosition.x + positionOffset.x,
    focusPosition.y + positionOffset.y,
    focusPosition.z + positionOffset.z,
  );
  const desiredWorldTarget = new THREE.Vector3(
    focusPosition.x + rig.targetOffset.x,
    focusPosition.y + rig.targetOffset.y,
    focusPosition.z + rig.targetOffset.z,
  );

  if (!camera.userData.smoothedWorldPos || !camera.userData.smoothedWorldTarget) {
    camera.userData.smoothedWorldPos = new THREE.Vector3().copy(desiredWorldPos);
    camera.userData.smoothedWorldTarget = new THREE.Vector3().copy(desiredWorldTarget);
  }

  smoothVector(camera.userData.smoothedWorldPos, desiredWorldPos, dt, 0.05);
  smoothVector(camera.userData.smoothedWorldTarget, desiredWorldTarget, dt, 0.04);

  const occludeCamera = world.cameraOcclusion;
  if (occludeCamera) {
    const smoothedPos = camera.userData.smoothedWorldPos as THREE.Vector3;
    const smoothedTarget = camera.userData.smoothedWorldTarget as THREE.Vector3;
    const adjusted = occludeCamera(
      { x: smoothedTarget.x, y: smoothedTarget.y, z: smoothedTarget.z },
      { x: smoothedPos.x, y: smoothedPos.y, z: smoothedPos.z },
    );
    smoothedPos.set(adjusted.x, adjusted.y, adjusted.z);
  }

  camera.position.copy(camera.userData.smoothedWorldPos).sub(focusVec).multiplyScalar(renderScale);
  cameraTarget.copy(camera.userData.smoothedWorldTarget).sub(focusVec).multiplyScalar(renderScale);
  camera.up.copy(v3(orbit.up));
}
