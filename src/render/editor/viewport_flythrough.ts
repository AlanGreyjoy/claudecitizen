import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const FLY_KEY_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
]);
const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface ViewportFlythrough {
  isFlying: () => boolean;
  update: (dt: number) => void;
  end: () => void;
  dispose: () => void;
}

/**
 * Unity-style RMB flythrough: pointer-lock look + WASD/QE move, wheel speed.
 * OrbitControls stays disabled while flying.
 */
export function createViewportFlythrough(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  orbit: OrbitControls,
): ViewportFlythrough {
  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 12;
  let flyTargetDistance = 10;

  function beginFly(): void {
    if (flying) return;
    flying = true;
    flyTargetDistance = Math.max(4, camera.position.distanceTo(orbit.target));
    flyEuler.setFromQuaternion(camera.quaternion, "YXZ");
    flyEuler.z = 0;
    orbit.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    // Re-aim the orbit pivot in front of the camera so orbiting continues
    // naturally from wherever the flythrough ended.
    camera.getWorldDirection(flyForward);
    orbit.target
      .copy(camera.position)
      .addScaledVector(flyForward, flyTargetDistance);
    orbit.enabled = true;
    orbit.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(
      -FLY_PITCH_LIMIT,
      Math.min(FLY_PITCH_LIMIT, flyEuler.x),
    );
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has("KeyW")) flyMove.add(flyForward);
    if (flyKeys.has("KeyS")) flyMove.sub(flyForward);
    if (flyKeys.has("KeyD")) flyMove.add(flyRight);
    if (flyKeys.has("KeyA")) flyMove.sub(flyRight);
    if (flyKeys.has("KeyE")) flyMove.y += 1;
    if (flyKeys.has("KeyQ")) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight") ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.type === "keydown") flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }

  function onPointerLockChange(): void {
    // Esc releases pointer lock — treat it as ending the flythrough.
    if (flying && document.pointerLockElement !== canvas) endFly();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 2) return;
    // Capture keeps the pointerup on the canvas even if pointer lock is denied.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id (e.g. synthetic events) — flythrough still works.
    }
    beginFly();
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.button === 2) endFly();
  }

  function onWheel(event: WheelEvent): void {
    if (!flying) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    flySpeed = Math.min(
      200,
      Math.max(0.5, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
    );
  }

  window.addEventListener("keydown", onFlyKey);
  window.addEventListener("keyup", onFlyKey);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  canvas.addEventListener("pointermove", onFlyLook);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", endFly);
  canvas.addEventListener("wheel", onWheel, { passive: false, capture: true });

  return {
    isFlying: () => flying,
    update: updateFly,
    end: endFly,
    dispose() {
      endFly();
      window.removeEventListener("keydown", onFlyKey);
      window.removeEventListener("keyup", onFlyKey);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("pointermove", onFlyLook);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", endFly);
      canvas.removeEventListener("wheel", onWheel, true);
    },
  };
}
