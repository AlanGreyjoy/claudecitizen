import * as THREE from 'three';
import {
  FIRST_PERSON_PITCH_LIMIT,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
} from '../../player/character_controller';
import { resolveDeckCameraOrbit } from '../../flight/flight_aim';
import { getBedEyeLocal, localOffsetToWorld } from '../../player/ship_interaction';
import { updateEntertainmentCameraFeel } from '../../player/entertainment_camera';
import { resolveEntertainmentGazeTarget } from '../../player/entertainment_gaze';
import { occludeShipCamera } from '../../physics/ship_physics';
import { getShipLayout } from '../../player/ship_layout';
import type { ShipSandboxSession } from './types';
import { WORLD_UP } from './types';
import { resolveSandboxOrbit, resolveShipSeatLook, smoothVector } from './camera_math';

function updateInBedSandboxCamera(session: ShipSandboxSession, dt: number): void {
  session.flightCameraFeelFrame = null;
  const layout = getShipLayout();
  const eyeLocal = getBedEyeLocal(session.activeBedId) ?? layout.pilotEye;
  const eye = localOffsetToWorld(session.ship, eyeLocal);
  const cameraState = session.controls.sampleCameraState(dt);
  const seatLook = cameraState.seatLook;
  const lookingAround =
    seatLook &&
    (Math.abs(seatLook.yawRadians) > 1e-6 ||
      Math.abs(seatLook.pitchRadians) > 1e-6);
  const look = lookingAround
    ? resolveShipSeatLook(
        session.ship.forward,
        session.ship.up,
        seatLook.yawRadians,
        seatLook.pitchRadians,
        FIRST_PERSON_PITCH_LIMIT,
      )
    : { forward: session.ship.forward, up: session.ship.up };

  let feelEye = eye;
  let feelTarget = {
    x: eye.x + look.forward.x * 60,
    y: eye.y + look.forward.y * 60,
    z: eye.z + look.forward.z * 60,
  };
  let fovDelta = 0;
  if (layout.entertainmentSystems.length > 0) {
    const esHit = resolveEntertainmentGazeTarget(
      layout.entertainmentSystems,
      session.ship,
      eye,
      look.forward,
    );
    const screenSpec = esHit?.system ?? layout.entertainmentSystems[0]!;
    const screen = localOffsetToWorld(session.ship, screenSpec.position);
    const feel = updateEntertainmentCameraFeel(session.esCameraState, {
      dt,
      open: session.entertainmentSystem.isOpen(),
      gazing: Boolean(esHit),
      eye,
      screen,
      viewForward: look.forward,
    });
    if (feel) {
      feelEye = feel.eye;
      feelTarget = feel.lookTarget;
      fovDelta = feel.fovDeltaDeg;
    }
  } else {
    session.esCameraState.focus01 = 0;
  }

  if (typeof session.camera.userData.baseFovDeg !== 'number') {
    session.camera.userData.baseFovDeg = session.camera.fov;
  }
  session.camera.fov = (session.camera.userData.baseFovDeg as number) + fovDelta;
  session.camera.updateProjectionMatrix();
  session.camera.position.set(feelEye.x, feelEye.y, feelEye.z);
  session.cameraTarget.set(feelTarget.x, feelTarget.y, feelTarget.z);
  session.camera.up.set(look.up.x, look.up.y, look.up.z);
  session.camera.lookAt(session.cameraTarget);
  session.camera.userData.smoothedPos = null;
  session.camera.userData.smoothedTarget = null;
}

function updateExternalPilotCamera(session: ShipSandboxSession, dt: number): void {
  session.camera.fov = session.camera.userData.baseFovDeg as number;
  session.camera.updateProjectionMatrix();
  const cameraState = session.controls.sampleCameraState(dt);
  const zoom = cameraState.shipZoomDistance ?? 1;
  const back = 28 * zoom;
  const up = 8 * zoom;
  const lookAhead = 40;
  const desiredPos = new THREE.Vector3(
    session.ship.position.x - session.ship.forward.x * back + session.ship.up.x * up,
    session.ship.position.y - session.ship.forward.y * back + session.ship.up.y * up,
    session.ship.position.z - session.ship.forward.z * back + session.ship.up.z * up,
  );
  const desiredTarget = new THREE.Vector3(
    session.ship.position.x + session.ship.forward.x * lookAhead,
    session.ship.position.y + session.ship.forward.y * lookAhead,
    session.ship.position.z + session.ship.forward.z * lookAhead,
  );
  if (!session.camera.userData.smoothedPos) {
    session.camera.userData.smoothedPos = new THREE.Vector3().copy(desiredPos);
  }
  if (!session.camera.userData.smoothedTarget) {
    session.camera.userData.smoothedTarget = new THREE.Vector3().copy(desiredTarget);
  }
  smoothVector(session.camera.userData.smoothedPos, desiredPos, dt, 0.06);
  smoothVector(session.camera.userData.smoothedTarget, desiredTarget, dt, 0.04);
  session.camera.position.copy(session.camera.userData.smoothedPos);
  session.cameraTarget.copy(session.camera.userData.smoothedTarget);
  session.camera.up.set(session.ship.up.x, session.ship.up.y, session.ship.up.z);
  session.camera.lookAt(session.cameraTarget);
}

function updateCockpitPilotCamera(session: ShipSandboxSession): void {
  const eyeLocal = getShipLayout().pilotEye;
  const shake = session.flightCameraFeelFrame?.eyeShake;
  const eyeOffset = shake
    ? {
        right: eyeLocal.right + shake.right,
        up: eyeLocal.up + shake.up,
        forward: eyeLocal.forward + shake.forward,
      }
    : eyeLocal;
  const eye = localOffsetToWorld(session.ship, eyeOffset);
  const cameraState = session.controls.sampleCameraState(0);
  const seatLook = cameraState.seatLook;
  const lookingAround =
    seatLook &&
    (Math.abs(seatLook.yawRadians) > 1e-6 ||
      Math.abs(seatLook.pitchRadians) > 1e-6);
  const look = lookingAround
    ? resolveShipSeatLook(
        session.ship.forward,
        session.ship.up,
        seatLook.yawRadians,
        seatLook.pitchRadians,
        FIRST_PERSON_PITCH_LIMIT,
      )
    : { forward: session.ship.forward, up: session.ship.up };
  session.camera.position.set(eye.x, eye.y, eye.z);
  session.cameraTarget.set(
    eye.x + look.forward.x * 60,
    eye.y + look.forward.y * 60,
    eye.z + look.forward.z * 60,
  );
  session.camera.up.set(look.up.x, look.up.y, look.up.z);
  session.camera.lookAt(session.cameraTarget);
  if (typeof session.camera.userData.baseFovDeg !== 'number') {
    session.camera.userData.baseFovDeg = session.camera.fov;
  }
  session.camera.fov =
    (session.camera.userData.baseFovDeg as number) +
    (session.flightCameraFeelFrame?.fovDeltaDeg ?? 0);
  session.camera.updateProjectionMatrix();
  session.camera.userData.smoothedPos = null;
  session.camera.userData.smoothedTarget = null;
}

function updatePilotSandboxCamera(session: ShipSandboxSession, dt: number): void {
  const cameraState = session.controls.sampleCameraState(dt);
  if (cameraState.shipCameraView === 'external') {
    updateExternalPilotCamera(session, dt);
    return;
  }
  updateCockpitPilotCamera(session);
}

function updateWalkSandboxCamera(session: ShipSandboxSession, dt: number): void {
  session.flightCameraFeelFrame = null;
  session.camera.fov = session.camera.userData.baseFovDeg as number;
  session.camera.updateProjectionMatrix();

  const onShip =
    session.mode === 'deck' ||
    session.mode === 'sitting' ||
    session.mode === 'standing' ||
    session.mode === 'lying' ||
    session.mode === 'getting-up';
  const cameraState = session.controls.sampleCameraState(dt);
  const orbit = onShip
    ? resolveDeckCameraOrbit(
        session.ship.forward,
        session.ship.up,
        cameraState.yawRadians,
        cameraState.pitchRadians,
        ORBIT_PITCH_LIMIT,
      )
    : resolveSandboxOrbit(
        cameraState.yawRadians,
        cameraState.pitchRadians,
        ORBIT_PITCH_LIMIT,
      );
  const orbitUp = onShip ? session.ship.up : WORLD_UP;
  const rigOffsets = resolveCharacterCameraRig(orbit, cameraState.zoomDistance);

  const desiredPos = new THREE.Vector3(
    session.character.position.x + rigOffsets.positionOffset.x,
    session.character.position.y + rigOffsets.positionOffset.y,
    session.character.position.z + rigOffsets.positionOffset.z,
  );
  const desiredTarget = new THREE.Vector3(
    session.character.position.x + rigOffsets.targetOffset.x,
    session.character.position.y + rigOffsets.targetOffset.y,
    session.character.position.z + rigOffsets.targetOffset.z,
  );

  if (!session.camera.userData.smoothedPos) {
    session.camera.userData.smoothedPos = new THREE.Vector3().copy(desiredPos);
  }
  if (!session.camera.userData.smoothedTarget) {
    session.camera.userData.smoothedTarget = new THREE.Vector3().copy(desiredTarget);
  }
  smoothVector(session.camera.userData.smoothedPos, desiredPos, dt, 0.05);
  smoothVector(session.camera.userData.smoothedTarget, desiredTarget, dt, 0.04);
  if (session.shipPhysics) {
    const smoothedPos = session.camera.userData.smoothedPos as THREE.Vector3;
    const smoothedTarget = session.camera.userData.smoothedTarget as THREE.Vector3;
    const clamped = occludeShipCamera(
      session.shipPhysics,
      session.ship,
      { x: smoothedTarget.x, y: smoothedTarget.y, z: smoothedTarget.z },
      { x: smoothedPos.x, y: smoothedPos.y, z: smoothedPos.z },
    );
    smoothedPos.set(clamped.x, clamped.y, clamped.z);
  }
  session.camera.position.copy(session.camera.userData.smoothedPos);
  session.cameraTarget.copy(session.camera.userData.smoothedTarget);
  session.camera.up.set(orbitUp.x, orbitUp.y, orbitUp.z);
  session.camera.lookAt(session.cameraTarget);
}

export function updateShipSandboxCamera(session: ShipSandboxSession, dt: number): void {
  if (session.mode === 'in-bed') {
    updateInBedSandboxCamera(session, dt);
    return;
  }
  session.esCameraState.focus01 = 0;
  if (session.mode === 'pilot') {
    updatePilotSandboxCamera(session, dt);
    return;
  }
  updateWalkSandboxCamera(session, dt);
}
