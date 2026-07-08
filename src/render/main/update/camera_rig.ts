import * as THREE from 'three';
import type { CharacterRenderState, SpikeRenderWorld, Vec3 } from '../../../types';
import {
  FIRST_PERSON_PITCH_LIMIT,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
  resolveFirstPersonCameraRig,
  resolveOrbitCamera,
} from '../../../player/character_controller';
import {
  MODE_IN_STATION,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from '../../../player/modes';
import { getShipWalkZone } from '../../../player/ship_deck';
import { getPilotEyeLocal } from '../../../player/ship_interaction';
import {
  getStationRoom,
  worldToStationLocal,
  type StationFrame,
} from '../../../world/station';
import { add, cross, dot, normalize, rotateAroundAxis, scale, sub } from '../../../math/vec3';
import { v3 } from '../domain/math';

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

/**
 * Keeps the third-person camera inside the ship interior zone (cabin or
 * cockpit) the character occupies, so it never pokes through the hull.
 * The ramp zone is open to the outside and skips clamping.
 */
function clampOffsetToShipZone(
  offset: Vec3,
  characterPosition: Vec3,
  world: SpikeRenderWorld,
  shipUp: Vec3,
  shipForward: Vec3,
): Vec3 {
  const zone = world.shipZoneId ? getShipWalkZone(world.shipZoneId) : null;
  // Ramp-gated zones are open to the outside and skip clamping.
  if (!zone || zone.gate === 'ramp') return offset;
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
  const floorUp = Math.min(zone.floorUp, zone.slopeMinUp ?? zone.floorUp);
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

const FIRST_PERSON_LOOK_DISTANCE_METERS = 10;

export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  altitudeFactor: number,
  shipUp: Vec3,
  shipForward: Vec3,
  firstPersonActive = false,
  station: StationCameraContext | null = null,
  dt = 0.016,
): void {
  const {
    cameraOrbit = { pitchRadians: -0.35, yawRadians: 0, zoomDistance: 7.4 },
    character = null,
    mode = 'in-ship',
    shipCameraZoom = 1.0,
  } = world;
  const stationActive =
    station !== null && (mode === MODE_IN_STATION || mode === MODE_RIDING_ELEVATOR);

  const focusPosition = mode === 'in-ship' || !character ? world.ship.position : character.position;
  const focusVec = new THREE.Vector3(focusPosition.x, focusPosition.y, focusPosition.z);

  if (mode === 'in-ship' || !character) {
    if ((world.shipCameraView ?? 'cockpit') === 'cockpit') {
      // Cockpit first person: rigidly attached to the ship frame and snapped
      // every frame — smoothing here would drag the eye through the canopy
      // whenever the ship rotates. The ship (render focus) sits at the origin.
      camera.userData.smoothedWorldPos = null;
      camera.userData.smoothedWorldTarget = null;

      const shipRight = normalize(cross(shipForward, shipUp));
      const pilotEye = getPilotEyeLocal();
      const eye = add(
        add(scale(shipRight, pilotEye.right), scale(shipUp, pilotEye.up)),
        scale(shipForward, pilotEye.forward),
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
    } else {
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
    const pitchLimit = firstPersonActive ? FIRST_PERSON_PITCH_LIMIT : ORBIT_PITCH_LIMIT;
    const orbit =
      stationActive && station
        ? resolveShipDeckOrbit(
            station.frame.forward,
            station.frame.up,
            cameraOrbit.yawRadians,
            cameraOrbit.pitchRadians,
            pitchLimit,
          )
        : mode === MODE_ON_SHIP_DECK
          ? resolveShipDeckOrbit(
              shipForward,
              shipUp,
              cameraOrbit.yawRadians,
              cameraOrbit.pitchRadians,
              pitchLimit,
            )
          : resolveOrbitCamera(
              character.position,
              cameraOrbit.yawRadians,
              cameraOrbit.pitchRadians,
              pitchLimit,
            );

    if (firstPersonActive) {
      const rig = resolveFirstPersonCameraRig(orbit);
      const desiredWorldPos = new THREE.Vector3(
        focusPosition.x + rig.positionOffset.x,
        focusPosition.y + rig.positionOffset.y,
        focusPosition.z + rig.positionOffset.z,
      );

      if (!camera.userData.smoothedWorldPos) {
        camera.userData.smoothedWorldPos = new THREE.Vector3().copy(desiredWorldPos);
      }

      // Smooth first-person camera position in world space to iron out physics/terrain bumps
      smoothVector(camera.userData.smoothedWorldPos, desiredWorldPos, dt, 0.05);

      camera.position.copy(camera.userData.smoothedWorldPos).sub(focusVec).multiplyScalar(renderScale);

      // Keep look direction instantaneous to avoid mouse latency
      const lookDir = new THREE.Vector3(orbit.forward.x, orbit.forward.y, orbit.forward.z);
      cameraTarget.copy(camera.position).addScaledVector(lookDir, FIRST_PERSON_LOOK_DISTANCE_METERS * renderScale);
      camera.userData.smoothedWorldTarget = null;
    } else {
      const zoomDistance = cameraOrbit.zoomDistance ?? 7.4;
      const rig = resolveCharacterCameraRig(orbit, zoomDistance);
      let positionOffset = rig.positionOffset;
      if (stationActive && station) {
        positionOffset = clampOffsetToRoom(positionOffset, character.position, station);
      } else if (mode === MODE_ON_SHIP_DECK) {
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

      // Smooth third-person camera position and target in world space
      smoothVector(camera.userData.smoothedWorldPos, desiredWorldPos, dt, 0.05);
      smoothVector(camera.userData.smoothedWorldTarget, desiredWorldTarget, dt, 0.04);

      camera.position.copy(camera.userData.smoothedWorldPos).sub(focusVec).multiplyScalar(renderScale);
      cameraTarget.copy(camera.userData.smoothedWorldTarget).sub(focusVec).multiplyScalar(renderScale);
    }
    camera.up.copy(v3(orbit.up));
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
    speedBlurEffect.setStrength(0.08);
    return;
  }
  if (quantum?.phase === 'spooling') {
    const spoolT = quantum.spoolElapsed / Math.max(quantum.spoolDuration, 0.001);
    speedBlurEffect.setStrength(spoolT * 0.03);
    return;
  }

  const focusVelocity =
    mode === 'in-ship'
      ? ship.velocity
      : (character as CharacterRenderState & { velocity?: Vec3 })!.velocity;
  const speed = focusVelocity ? Math.hypot(focusVelocity.x, focusVelocity.y, focusVelocity.z) : 0;

  if (mode === 'in-ship') {
    const t = Math.max(0, Math.min(1, (speed - 120) / 1000));
    speedBlurEffect.setStrength(t * 0.045);
  } else {
    const t = Math.max(0, Math.min(1, (speed - 6) / 10));
    speedBlurEffect.setStrength(t * 0.012);
  }
}
