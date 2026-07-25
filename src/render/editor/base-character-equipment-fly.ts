import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const FLY_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
]);
const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface BaseCharacterFlyCamera {
  isFlying: () => boolean;
  beginFly: () => void;
  endFly: () => void;
  updateFly: (dt: number) => void;
  dispose: () => void;
}

export function createBaseCharacterFlyCamera(opts: {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  controls: OrbitControls;
  isPlayTestActive: () => boolean;
  getAuthoringCameraSuspended: () => boolean;
  setAuthoringCameraSuspended: (value: boolean) => void;
  isDisposed: () => boolean;
  isActive: () => boolean;
}): BaseCharacterFlyCamera {
  const {
    camera,
    canvas,
    controls,
    isPlayTestActive,
    getAuthoringCameraSuspended,
    isDisposed,
    isActive,
  } = opts;

  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 12;
  let flyTargetDistance = 10;

  function beginFly(): void {
    if (flying || isPlayTestActive() || getAuthoringCameraSuspended() || isDisposed() || !isActive()) return;
    flying = true;
    flyTargetDistance = Math.max(4, camera.position.distanceTo(controls.target));
    flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    flyEuler.z = 0;
    controls.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.getWorldDirection(flyForward);
    controls.target
      .copy(camera.position)
      .addScaledVector(flyForward, flyTargetDistance);
    if (!isPlayTestActive()) controls.enabled = true;
    controls.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(-FLY_PITCH_LIMIT, Math.min(FLY_PITCH_LIMIT, flyEuler.x));
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has('KeyW')) flyMove.add(flyForward);
    if (flyKeys.has('KeyS')) flyMove.sub(flyForward);
    if (flyKeys.has('KeyD')) flyMove.add(flyRight);
    if (flyKeys.has('KeyA')) flyMove.sub(flyRight);
    if (flyKeys.has('KeyE')) flyMove.y += 1;
    if (flyKeys.has('KeyQ')) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight') ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    if (event.type === 'keydown') flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }

  function onPointerLockChange(): void {
    if (getAuthoringCameraSuspended() || isPlayTestActive()) return;
    if (flying && document.pointerLockElement !== canvas) endFly();
  }

  window.addEventListener('keydown', onFlyKey);
  window.addEventListener('keyup', onFlyKey);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointermove', onFlyLook);
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 || isPlayTestActive() || getAuthoringCameraSuspended()) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id — flythrough still works.
    }
    beginFly();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 2) endFly();
  });
  canvas.addEventListener('pointercancel', () => endFly());
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!flying) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flySpeed = Math.min(
        200,
        Math.max(0.5, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
      );
    },
    { passive: false, capture: true },
  );

  return {
    isFlying: () => flying,
    beginFly,
    endFly,
    updateFly,
    dispose: () => {
      window.removeEventListener('keydown', onFlyKey);
      window.removeEventListener('keyup', onFlyKey);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    },
  };
}
