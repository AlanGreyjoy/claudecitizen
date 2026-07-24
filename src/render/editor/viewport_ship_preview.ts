import * as THREE from "three";
import {
  BUILTIN_GEAR_HINGES,
  BUILTIN_RAMP_HINGE,
} from "../main/scene/ship_model";
import type { EditorEntity, EditorStore } from "../../editor/document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type { ShipPreviewState } from "./viewport_types";
import { sanitizeNodeName } from "./viewport_transforms";

export interface ViewportShipPreview {
  getState: () => ShipPreviewState;
  setState: (state: ShipPreviewState) => void;
  apply: (options?: { quiet?: boolean }) => void;
  /** Drop once-per-name warning cache (call on full scene rebuild). */
  resetMissingWarnings: () => void;
}

export function createViewportShipPreview(
  store: EditorStore,
  entityRoot: THREE.Group,
): ViewportShipPreview {
  let shipPreview: ShipPreviewState = {
    gearDown: true,
    rampDown: false,
    doorsOpen: {},
  };
  const articulationBase = new WeakMap<
    THREE.Object3D,
    { position: THREE.Vector3; quaternion: THREE.Quaternion }
  >();
  const previewQuat = new THREE.Quaternion();
  const previewAxis = new THREE.Vector3();
  const missingWarned = new Set<string>();
  const PREVIEW_AXES = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  } as const;

  function baseOf(object: THREE.Object3D) {
    let base = articulationBase.get(object);
    if (!base) {
      base = {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
      };
      articulationBase.set(object, base);
    }
    return base;
  }

  /** Resolve a GLB node for gear/ramp/door preview; `under` disambiguates duplicates. */
  function findArticulationNode(
    name: string,
    under: string | undefined,
    quiet: boolean,
  ): THREE.Object3D | null {
    const safeName = sanitizeNodeName(name);
    const scope = under
      ? entityRoot.getObjectByName(sanitizeNodeName(under))
      : entityRoot;
    if (!scope) {
      warnMissing(
        `Editor ship preview: ancestor "${under}" not found for node "${name}".`,
        `ancestor:${under}->${name}`,
        quiet,
      );
      return null;
    }
    const object =
      under && sanitizeNodeName(scope.name) === safeName
        ? scope
        : scope.getObjectByName(safeName);
    if (!object) {
      warnMissing(
        under
          ? `Editor ship preview: node "${name}" not found under "${under}".`
          : `Editor ship preview: node "${name}" not found.`,
        under ? `${under}::${name}` : name,
        quiet,
      );
    }
    return object ?? null;
  }

  function warnMissing(message: string, key: string, quiet: boolean): void {
    if (quiet || missingWarned.has(key)) return;
    missingWarned.add(key);
    console.warn(message);
  }

  function previewHinge(
    name: string,
    radians: number,
    axis: "x" | "y" | "z" = "x",
    under?: string,
    quiet = false,
  ): void {
    const object = findArticulationNode(name, under, quiet);
    if (!object) return;
    const base = baseOf(object);
    previewQuat.setFromAxisAngle(PREVIEW_AXES[axis], radians);
    object.quaternion.copy(base.quaternion).multiply(previewQuat);
  }

  function previewSlide(
    name: string,
    offset: number,
    axis: "x" | "y" | "z",
    under?: string,
    quiet = false,
  ): void {
    const object = findArticulationNode(name, under, quiet);
    if (!object) return;
    const base = baseOf(object);
    previewAxis.copy(PREVIEW_AXES[axis]).multiplyScalar(offset);
    object.position.copy(base.position).add(previewAxis);
  }

  function findShipController(): Extract<
    PrefabComponent,
    { type: "ship-controller" }
  > | null {
    const visit = (entities: EditorEntity[]): Extract<
      PrefabComponent,
      { type: "ship-controller" }
    > | null => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === "ship-controller") return component;
        }
        const child = visit(entity.children);
        if (child) return child;
      }
      return null;
    };
    return visit(store.getState().roots);
  }

  function collectAnimations(): Array<{
    id: string;
    motion: "slide" | "hinge";
    axis: "x" | "y" | "z";
    nodes: { name: string; delta: number; under?: string }[];
    defaultOpen?: boolean;
  }> {
    const byId = new Map<
      string,
      {
        id: string;
        motion: "slide" | "hinge";
        axis: "x" | "y" | "z";
        nodes: { name: string; delta: number; under?: string }[];
        defaultOpen?: boolean;
      }
    >();

    // Legacy: doors still authored on ship-controller.
    const controller = findShipController();
    for (const door of controller?.doors ?? []) {
      byId.set(door.id, {
        id: door.id,
        motion: door.motion,
        axis: door.axis,
        nodes: door.nodes.map((node) => ({
          name: node.name,
          delta: node.delta,
          ...(node.under ? { under: node.under } : {}),
        })),
        defaultOpen: door.defaultOpen,
      });
    }

    // Primary: ship-door / animation markers (win on id conflict).
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === "ship-door" || component.type === "animation") {
            byId.set(component.id, {
              id: component.id,
              motion: component.motion,
              axis: component.axis,
              nodes: component.nodes.map((node) => ({
                name: node.name,
                delta: node.delta,
                ...("under" in node && node.under
                  ? { under: node.under }
                  : {}),
              })),
              defaultOpen: component.defaultOpen,
            });
          }
        }
        visit(entity.children);
      }
    };
    visit(store.getState().roots);

    return [...byId.values()];
  }

  function applyShipGearRampPreview(quiet: boolean): void {
    if (store.getState().kind !== "ship") return;
    const controller = findShipController();
    const gear01 = shipPreview.gearDown ? 1 : 0;
    const gearHinges =
      controller?.gear?.nodes ??
      BUILTIN_GEAR_HINGES.map((hinge) => ({
        name: hinge.name,
        ...(hinge.under ? { under: hinge.under } : {}),
        deployRadians: hinge.deployRadians,
        axis: hinge.axis,
      }));
    for (const hinge of gearHinges) {
      previewHinge(
        hinge.name,
        hinge.deployRadians * gear01,
        hinge.axis ?? "x",
        hinge.under,
        quiet,
      );
    }
    const rampHinge = controller?.ramp?.hinge ?? {
      node: BUILTIN_RAMP_HINGE.name,
      lowerRadians: BUILTIN_RAMP_HINGE.lowerRadians,
      axis: BUILTIN_RAMP_HINGE.axis,
    };
    previewHinge(
      rampHinge.node,
      rampHinge.lowerRadians * (shipPreview.rampDown ? 1 : 0),
      rampHinge.axis ?? "x",
      undefined,
      quiet,
    );
  }

  function applyDoorAnimationPreview(quiet: boolean): void {
    for (const anim of collectAnimations()) {
      const open = shipPreview.doorsOpen[anim.id] ?? anim.defaultOpen ?? false;
      const open01 = open ? 1 : 0;
      for (const node of anim.nodes) {
        if (anim.motion === "slide") {
          previewSlide(
            node.name,
            node.delta * open01,
            anim.axis,
            node.under,
            quiet,
          );
        } else {
          previewHinge(
            node.name,
            node.delta * open01,
            anim.axis,
            node.under,
            quiet,
          );
        }
      }
    }
  }

  function applyShipPreview(options?: { quiet?: boolean }): void {
    const quiet = options?.quiet ?? false;
    applyShipGearRampPreview(quiet);
    applyDoorAnimationPreview(quiet);
  }

  return {
    getState: () => shipPreview,
    setState(state) {
      shipPreview = state;
      applyShipPreview();
    },
    apply: applyShipPreview,
    resetMissingWarnings() {
      missingWarned.clear();
    },
  };
}
