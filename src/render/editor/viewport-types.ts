import type { EntityTransform } from "../../editor/document";
import type { ParticlePreviewControls } from "../../editor/panels/particle_fields";
import type { Vec3 } from "../../types";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoSpace = "local" | "world";

export interface ShipPreviewState {
  gearDown: boolean;
  rampDown: boolean;
  /** Open/closed per ship-door id. */
  doorsOpen: Record<string, boolean>;
}

export interface EditorViewportOptions {
  /** Called when an asset card is dropped onto the scene. */
  onDropAsset: (payload: string, position: Vec3) => void;
}

export interface EditorViewport {
  setGizmoMode: (mode: GizmoMode) => void;
  setGizmoSpace: (space: GizmoSpace) => void;
  setSnap: (
    enabled: boolean,
    translateStep: number,
    rotateStepDegrees: number,
  ) => void;
  /**
   * Unity-style in-editor Play: Scene view becomes Play view in place.
   * Disables edit picking/gizmos; flythrough camera remains available.
   */
  setPlayMode: (playing: boolean) => void;
  isPlayMode: () => boolean;
  /** Ship kind only: articulates gear/ramp/doors on loaded models for preview. */
  setShipPreview: (state: ShipPreviewState) => void;
  focusSelection: () => void;
  getGlbNodePrefabPosition: (entityId: string, nodeUuid: string) => Vec3 | null;
  getGlbNodePrefabTransform: (
    entityId: string,
    nodeUuid: string,
    parentEntityId?: string | null,
  ) => EntityTransform | null;
  getGlbNodeBounds: (entityId: string, nodeUuid: string) => { min: Vec3; max: Vec3 } | null;
  getGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
  ) => EntityTransform | null;
  setGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ) => void;
  /** True while the RMB flythrough owns the camera (WASD is flying, not tool shortcuts). */
  isFlying: () => boolean;
  particlePreview: ParticlePreviewControls;
  dispose: () => void;
}
