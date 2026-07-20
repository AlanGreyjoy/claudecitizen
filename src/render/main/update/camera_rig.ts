import * as THREE from 'three';
import type { CharacterRenderState, SpikeRenderWorld, Vec3 } from '../../../types';
import {
  FIRST_PERSON_PITCH_LIMIT,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
  resolveOrbitCamera,
} from '../../../player/character_controller';
import {
  MODE_IN_BED,
  MODE_IN_STATION,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from '../../../player/modes';
import { getShipLayout } from '../../../player/ship_layout';
import type { ShipCameraBounds } from '../../../player/ship_layout';
import { getBedEyeLocal, getPilotEyeLocal } from '../../../player/ship_interaction';
import {
  getStationRoom,
  worldToStationLocal,
  type StationFrame,
} from '../../../world/station';
import { add, cross, dot, normalize, rotateAroundAxis, scale, sub } from '../../../math/vec3';
import { v3 } from '../domain/math';

const WEAPON_AIM_ZOOM_SCALE = 0.86;
const WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS = 0.07;

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

export interface StationCameraContext {
  frame: StationFrame;
  roomId: string | null;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Keeps the third-person camera inside the station room the character
 * occupies. Rooms are convex boxes, so a clamped camera always keeps line
 * of sight to the character instead of poking through walls or ceilings.
 */
function clampOffsetToRoom(
  offset: Vec3,
  characterPosition: Vec3,
  station: StationCameraContext,
): Vec3 {
  const room = station.roomId ? getStationRoom(station.roomId) : null;
  if (!room) return offset;
  const frame = station.frame;
  const charLocal = worldToStationLocal(frame, characterPosition);
  const inset = 0.35;
  const open = (side: string) => room.openSides?.includes(side as never) ?? false;
  const camRight = clampValue(
    charLocal.right + dot(offset, frame.right),
    open('minRight') ? -Infinity : room.minRight + inset,
    open('maxRight') ? Infinity : room.maxRight - inset,
  );
  const camUp = clampValue(
    charLocal.up + dot(offset, frame.up),
    room.floorUp + 0.35,
    room.floorUp + room.height - 0.3,
  );
  const camForward = clampValue(
    charLocal.forward + dot(offset, frame.forward),
    open('minForward') ? -Infinity : room.minForward + inset,
    open('maxForward') ? Infinity : room.maxForward - inset,
  );
  return add(
    add(scale(frame.right, camRight - charLocal.right), scale(frame.up, camUp - charLocal.up)),
    scale(frame.forward, camForward - charLocal.forward),
  );
}

function resolveCameraClampVolume(
  shipZoneId: string | null | undefined,
): ShipCameraBounds | null {
  if (!shipZoneId) return null;
  return (
    getShipLayout().cameraBounds.find((bound) => bound.id === shipZoneId) ??
    null
  );
}

/**
 * Keeps the third-person camera inside the ship interior zone the character
 * occupies, so it never pokes through the hull. Ramp volumes skip clamping.
 */
function clampOffsetToShipZone(
  offset: Vec3,
  characterPosition: Vec3,
  world: SpikeRenderWorld,
  shipUp: Vec3,
  shipForward: Vec3,
): Vec3 {
  const zone = resolveCameraClampVolume(world.shipZoneId);
  if (!zone || zone.openToOutside) return offset;
  const up = normalize(shipUp);
  const planarForward = normalize(sub(shipForward, scale(up, dot(shipForward, up))));
  const right = normalize(cross(planarForward, up));
  const delta = sub(characterPosition, world.ship.position);
  const charLocal = {
    right: dot(delta, right),
    up: dot(delta, up),
    forward: dot(delta, planarForward),
  };
  const inset = 0.25;
  const floorUp = zone.floorUp;
  const camRight = clampValue(
    charLocal.right + dot(offset, right),
    zone.minRight + inset,
    zone.maxRight - inset,
  );
  const camUp = clampValue(
    charLocal.up + dot(offset, up),
    floorUp + 0.3,
    zone.ceilingUp - 0.15,
  );
  const camForward = clampValue(
    charLocal.forward + dot(offset, planarForward),
    zone.minForward + inset,
    zone.maxForward - inset,
  );
  return add(
    add(scale(right, camRight - charLocal.right), scale(up, camUp - charLocal.up)),
    scale(planarForward, camForward - charLocal.forward),
  );
}

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

export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  altitudeFactor: number,
  shipUp: Vec3,
  shipForward: Vec3,
  station: StationCameraContext | null = null,
  dt = 0.016,
): void {
  const {
    cameraOrbit = { pitchRadians: -0.35, yawRadians: 0, zoomDistance: 7.4 },
    character = null,
    mode = 'in-ship',
    shipCameraZoom = 1.0,
    shipExteriorWalk = false,
  } = world;
  const stationActive =
    station !== null && (mode === MODE_IN_STATION || mode === MODE_RIDING_ELEVATOR);
  /** Outside hull/ramp near a parked ship — character camera, not ship-zone orbit. */
  const onShipDeckInterior = mode === MODE_ON_SHIP_DECK && !shipExteriorWalk;
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

  const focusPosition =
    mode === 'in-ship' || mode === MODE_IN_BED || !character
      ? world.ship.position
      : character.position;
  const focusVec = new THREE.Vector3(focusPosition.x, focusPosition.y, focusPosition.z);

  if (mode === MODE_IN_BED) {
    camera.userData.smoothedWorldPos = null;
    camera.userData.smoothedWorldTarget = null;

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
    } else {
      if (typeof camera.userData.baseFovDeg === 'number') {
        camera.fov = camera.userData.baseFovDeg;
        camera.updateProjectionMatrix();
      }
      const shipRight = normalize(cross(shipForward, shipUp));
      const bedEye = getBedEyeLocal(world.activeBedId) ?? getPilotEyeLocal();
      const eye = add(
        add(scale(shipRight, bedEye.right), scale(shipUp, bedEye.up)),
        scale(shipForward, bedEye.forward),
      );
      const seatLook = world.seatLook;
      const lookForward =
        seatLook &&
        (Math.abs(seatLook.yawRadians) > 1e-6 || Math.abs(seatLook.pitchRadians) > 1e-6)
          ? resolveShipDeckOrbit(
              shipForward,
              shipUp,
              seatLook.yawRadians,
              seatLook.pitchRadians,
              FIRST_PERSON_PITCH_LIMIT,
            ).forward
          : shipForward;
      const lookMeters = 60;
      camera.position.set(eye.x * renderScale, eye.y * renderScale, eye.z * renderScale);
      cameraTarget.set(
        (eye.x + lookForward.x * lookMeters) * renderScale,
        (eye.y + lookForward.y * lookMeters) * renderScale,
        (eye.z + lookForward.z * lookMeters) * renderScale,
      );
      camera.up.copy(v3(shipUp));
    }
  } else if (mode === 'in-ship' || !character) {
    if ((world.shipCameraView ?? 'cockpit') === 'cockpit') {
      // Cockpit first person: rigidly attached to the ship frame and snapped
      // every frame — smoothing here would drag the eye through the canopy
      // whenever the ship rotates. The ship (render focus) sits at the origin.
      camera.userData.smoothedWorldPos = null;
      camera.userData.smoothedWorldTarget = null;

      const shipRight = normalize(cross(shipForward, shipUp));
      const pilotEye = getPilotEyeLocal();
      const feel = world.flightCameraFeel;
      const shake = feel?.eyeShake;
      const eyeLocal = shake
        ? {
            right: pilotEye.right + shake.right,
            up: pilotEye.up + shake.up,
            forward: pilotEye.forward + shake.forward,
          }
        : pilotEye;
      const eye = add(
        add(scale(shipRight, eyeLocal.right), scale(shipUp, eyeLocal.up)),
        scale(shipForward, eyeLocal.forward),
      );
      const seatLook = world.seatLook;
      const lookForward =
        seatLook &&
        (Math.abs(seatLook.yawRadians) > 1e-6 || Math.abs(seatLook.pitchRadians) > 1e-6)
          ? resolveShipDeckOrbit(
              shipForward,
              shipUp,
              seatLook.yawRadians,
              seatLook.pitchRadians,
              FIRST_PERSON_PITCH_LIMIT,
            ).forward
          : shipForward;
      const lookMeters = 60;
      camera.position.set(eye.x * renderScale, eye.y * renderScale, eye.z * renderScale);
      cameraTarget.set(
        (eye.x + lookForward.x * lookMeters) * renderScale,
        (eye.y + lookForward.y * lookMeters) * renderScale,
        (eye.z + lookForward.z * lookMeters) * renderScale,
      );

      if (typeof camera.userData.baseFovDeg !== 'number') {
        camera.userData.baseFovDeg = camera.fov;
      }
      const fovDelta = feel?.fovDeltaDeg ?? 0;
      camera.fov = (camera.userData.baseFovDeg as number) + fovDelta;
      camera.updateProjectionMatrix();
    } else {
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

      // Smooth cockpit external camera in world space
      smoothVector(camera.userData.smoothedWorldPos, desiredWorldPos, dt, 0.06);
      smoothVector(camera.userData.smoothedWorldTarget, desiredWorldTarget, dt, 0.04);

      camera.position.copy(camera.userData.smoothedWorldPos).sub(focusVec).multiplyScalar(renderScale);
      cameraTarget.copy(camera.userData.smoothedWorldTarget).sub(focusVec).multiplyScalar(renderScale);
    }
    camera.up.copy(v3(shipUp));
  } else {
    const shopFeel = world.entertainmentCameraFeel;
    if (stationActive && shopFeel) {
      camera.userData.smoothedWorldPos = null;
      camera.userData.smoothedWorldTarget = null;
      if (typeof camera.userData.baseFovDeg !== 'number') {
        camera.userData.baseFovDeg = camera.fov;
      }
      camera.fov = (camera.userData.baseFovDeg as number) + shopFeel.fovDeltaDeg;
      camera.updateProjectionMatrix();
      // Station camera is focus-relative (character at origin of render frame).
      camera.position.set(
        (shopFeel.eye.x - focusPosition.x) * renderScale,
        (shopFeel.eye.y - focusPosition.y) * renderScale,
        (shopFeel.eye.z - focusPosition.z) * renderScale,
      );
      cameraTarget.set(
        (shopFeel.lookTarget.x - focusPosition.x) * renderScale,
        (shopFeel.lookTarget.y - focusPosition.y) * renderScale,
        (shopFeel.lookTarget.z - focusPosition.z) * renderScale,
      );
      camera.up.copy(v3(station?.frame.up ?? shipUp));
    } else {
      if (typeof camera.userData.baseFovDeg === 'number') {
        camera.fov = camera.userData.baseFovDeg;
        camera.updateProjectionMatrix();
      }
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
                character.position,
                cameraOrbit.yawRadians,
                cameraOrbit.pitchRadians,
                ORBIT_PITCH_LIMIT,
              );

      const baseZoomDistance = cameraOrbit.zoomDistance ?? 7.4;
      const zoomDistance = baseZoomDistance
        * (1 - (1 - WEAPON_AIM_ZOOM_SCALE) * weaponAimZoom01);
      const rig = resolveCharacterCameraRig(orbit, zoomDistance);
      let positionOffset = rig.positionOffset;
      if (stationActive && station) {
        positionOffset = clampOffsetToRoom(positionOffset, character.position, station);
      } else if (onShipDeckInterior) {
        positionOffset = clampOffsetToShipZone(
          positionOffset,
          character.position,
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

      // Pull the camera in front of the first collider blocking the line
      // from the look target. Applied to the smoothed position (and written
      // back) so the rendered eye never clips geometry: the clamp snaps in
      // instantly, then the smoothing above eases back out once clear.
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
