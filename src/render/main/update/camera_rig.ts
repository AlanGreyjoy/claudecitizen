import * as THREE from 'three';
import type { CharacterRenderState, SpikeRenderWorld, Vec3 } from '../../../types';
import { resolveCharacterCameraRig, resolveOrbitCamera } from '../../../player/character_controller';
import { v3 } from '../domain/math';

export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  cameraTarget: THREE.Vector3,
  world: SpikeRenderWorld,
  renderScale: number,
  altitudeFactor: number,
  shipUp: Vec3,
  shipForward: Vec3,
): void {
  const {
    cameraOrbit = { pitchRadians: -0.35, yawRadians: 0, zoomDistance: 7.4 },
    character = null,
    mode = 'in-ship',
    shipCameraZoom = 1.0,
  } = world;

  if (mode === 'in-ship' || !character) {
    const zoom = shipCameraZoom ?? 1.0;
    const cameraBackMeters = (58 + altitudeFactor * 180) * zoom;
    const cameraUpMeters = (9 + altitudeFactor * 136) * zoom;
    const cameraOffset = new THREE.Vector3(
      (-shipForward.x * cameraBackMeters + shipUp.x * cameraUpMeters) * renderScale,
      (-shipForward.y * cameraBackMeters + shipUp.y * cameraUpMeters) * renderScale,
      (-shipForward.z * cameraBackMeters + shipUp.z * cameraUpMeters) * renderScale,
    );
    camera.position.lerp(cameraOffset, 0.12);
    cameraTarget.lerp(
      new THREE.Vector3(
        (shipForward.x * (170 + altitudeFactor * 340) + shipUp.x * (-6 + altitudeFactor * 52)) *
          renderScale,
        (shipForward.y * (170 + altitudeFactor * 340) + shipUp.y * (-6 + altitudeFactor * 52)) *
          renderScale,
        (shipForward.z * (170 + altitudeFactor * 340) + shipUp.z * (-6 + altitudeFactor * 52)) *
          renderScale,
      ),
      0.16,
    );
    camera.up.copy(v3(shipUp));
  } else {
    const orbit = resolveOrbitCamera(
      character.position,
      cameraOrbit.yawRadians,
      cameraOrbit.pitchRadians,
    );
    const zoomDistance = cameraOrbit.zoomDistance ?? 7.4;
    const rig = resolveCharacterCameraRig(orbit, zoomDistance);
    const cameraOffset = new THREE.Vector3(
      rig.positionOffset.x * renderScale,
      rig.positionOffset.y * renderScale,
      rig.positionOffset.z * renderScale,
    );
    camera.position.lerp(cameraOffset, 0.18);
    cameraTarget.lerp(
      new THREE.Vector3(
        rig.targetOffset.x * renderScale,
        rig.targetOffset.y * renderScale,
        rig.targetOffset.z * renderScale,
      ),
      0.24,
    );
    camera.up.copy(v3(orbit.up));
  }

  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}

export function updateSpeedBlur(
  speedBlurEffect: { setStrength: (value: number) => void },
  world: SpikeRenderWorld,
): void {
  const { character = null, mode = 'in-ship', ship } = world;
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
