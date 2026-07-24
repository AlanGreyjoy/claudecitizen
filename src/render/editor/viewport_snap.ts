import type { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { DEG_TO_RAD } from "./viewport_transforms";

export interface ViewportSnap {
  isEnabled: () => boolean;
  getTranslateStep: () => number;
  setSnap: (
    enabled: boolean,
    translateStep: number,
    rotateStepDegrees: number,
  ) => void;
  dispose: () => void;
}

export function createViewportSnap(gizmo: TransformControls): ViewportSnap {
  let snapEnabled = true;
  let snapTranslate = 0.25;
  let snapRotateDegrees = 15;
  let ctrlHeld = false;

  function applySnapState(): void {
    const active = snapEnabled !== ctrlHeld; // Ctrl temporarily inverts snapping
    gizmo.setTranslationSnap(active ? snapTranslate : null);
    gizmo.setRotationSnap(active ? snapRotateDegrees * DEG_TO_RAD : null);
    gizmo.setScaleSnap(active ? 0.1 : null);
  }
  applySnapState();

  function onKeyChange(event: KeyboardEvent): void {
    if (event.key === "Control" || event.ctrlKey !== ctrlHeld) {
      ctrlHeld =
        event.type === "keydown"
          ? event.ctrlKey || event.key === "Control"
          : event.ctrlKey;
      applySnapState();
    }
  }
  window.addEventListener("keydown", onKeyChange);
  window.addEventListener("keyup", onKeyChange);

  return {
    isEnabled: () => snapEnabled,
    getTranslateStep: () => snapTranslate,
    setSnap(enabled, translateStep, rotateStepDegrees) {
      snapEnabled = enabled;
      snapTranslate = Math.max(0.01, translateStep);
      snapRotateDegrees = Math.max(1, rotateStepDegrees);
      applySnapState();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyChange);
      window.removeEventListener("keyup", onKeyChange);
    },
  };
}
