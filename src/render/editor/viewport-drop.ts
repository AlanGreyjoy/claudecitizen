import * as THREE from "three";
import type { Vec3 } from "../../types";

export interface ViewportDropOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  isSnapEnabled: () => boolean;
  getTranslateStep: () => number;
  isPlayMode?: () => boolean;
  onDropAsset: (payload: string, position: Vec3) => void;
}

export interface ViewportDrop {
  dispose: () => void;
}

export function attachViewportDrop(options: ViewportDropOptions): ViewportDrop {
  const {
    container,
    canvas,
    camera,
    isSnapEnabled,
    getTranslateStep,
    isPlayMode,
    onDropAsset,
  } = options;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dropPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dropPoint = new THREE.Vector3();

  function dropPositionFromEvent(event: DragEvent): Vec3 {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(dropPlane, dropPoint);
    if (!hit) {
      raycaster.ray.at(12, dropPoint);
    }
    const snap = isSnapEnabled() ? getTranslateStep() : 0;
    const snapValue = (value: number) =>
      snap > 0 ? Math.round(value / snap) * snap : value;
    return {
      x: snapValue(dropPoint.x),
      y: Math.max(0, snapValue(dropPoint.y)),
      z: snapValue(dropPoint.z),
    };
  }

  function onDragOver(event: DragEvent): void {
    if (isPlayMode?.()) return;
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    container.classList.add("ed-drop-active");
  }

  function onDragLeave(): void {
    container.classList.remove("ed-drop-active");
  }

  function onDrop(event: DragEvent): void {
    container.classList.remove("ed-drop-active");
    if (isPlayMode?.()) return;
    const payload =
      event.dataTransfer?.getData("application/x-claudecitizen-asset") ||
      event.dataTransfer?.getData("text/plain");
    if (!payload) return;
    event.preventDefault();
    onDropAsset(payload, dropPositionFromEvent(event));
  }

  container.addEventListener("dragover", onDragOver);
  container.addEventListener("dragleave", onDragLeave);
  container.addEventListener("drop", onDrop);

  return {
    dispose() {
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("dragleave", onDragLeave);
      container.removeEventListener("drop", onDrop);
      container.classList.remove("ed-drop-active");
    },
  };
}
