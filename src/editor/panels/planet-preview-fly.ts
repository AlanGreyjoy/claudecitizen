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

export interface PlanetPreviewFlySession {
  beginFly: () => void;
  endFly: () => void;
  updateFly: (dt: number) => void;
  isFlying: () => boolean;
  bindCanvas: (canvas: HTMLCanvasElement) => void;
  onPointerLockChange: () => void;
  onFlyKey: (event: KeyboardEvent) => void;
}

/**
 * RMB + WASD flythrough for the planet heightfield preview.
 * Canvas is rebound whenever the preview WebGPU device is recreated.
 */
export function createPlanetPreviewFlySession(input: {
  camera: THREE.PerspectiveCamera;
  getOrbit: () => OrbitControls | null;
  getCanvas: () => HTMLCanvasElement | null;
  isActive: () => boolean;
}): PlanetPreviewFlySession {
  const { camera } = input;
  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 80;
  let flyTargetDistance = 400;

  function beginFly(): void {
    const orbit = input.getOrbit();
    const canvas = input.getCanvas();
    if (flying || !input.isActive() || !orbit || !canvas) return;
    flying = true;
    flyTargetDistance = Math.max(40, camera.position.distanceTo(orbit.target));
    flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    flyEuler.z = 0;
    orbit.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    const canvas = input.getCanvas();
    if (canvas && document.pointerLockElement === canvas) document.exitPointerLock();
    camera.getWorldDirection(flyForward);
    const orbit = input.getOrbit();
    if (orbit) {
      orbit.target.copy(camera.position).addScaledVector(flyForward, flyTargetDistance);
      orbit.enabled = true;
      orbit.update();
    }
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
    const canvas = input.getCanvas();
    if (flying && canvas && document.pointerLockElement !== canvas) endFly();
  }

  function onCanvasContextMenu(event: Event): void {
    event.preventDefault();
  }

  function onCanvasPointerDown(event: PointerEvent): void {
    const canvas = input.getCanvas();
    if (event.button !== 2 || !canvas) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id — flythrough still works.
    }
    beginFly();
  }

  function onCanvasPointerUp(event: PointerEvent): void {
    if (event.button === 2) endFly();
  }

  function onCanvasWheel(event: WheelEvent): void {
    if (!flying) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    flySpeed = Math.min(
      800,
      Math.max(2, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
    );
  }

  function bindCanvas(target: HTMLCanvasElement): void {
    target.addEventListener('contextmenu', onCanvasContextMenu);
    target.addEventListener('pointermove', onFlyLook);
    target.addEventListener('pointerdown', onCanvasPointerDown);
    target.addEventListener('pointerup', onCanvasPointerUp);
    target.addEventListener('pointercancel', endFly);
    target.addEventListener('wheel', onCanvasWheel, { passive: false });
  }

  return {
    beginFly,
    endFly,
    updateFly,
    isFlying: () => flying,
    bindCanvas,
    onPointerLockChange,
    onFlyKey,
  };
}
