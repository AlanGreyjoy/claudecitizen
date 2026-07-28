import type { EntityTransform } from "../../editor/document";
import type { ParticlePreviewControls } from '../../editor/panels/particle-preview';
import type { PrefabMaterialOverride } from "../../world/prefabs/schema";
import type { Vec3 } from "../../types";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoSpace = "local" | "world";

export interface ShipPreviewState {
  gearDown: boolean;
  rampDown: boolean;
  canopyOpen: boolean;
  /**
   * Continuous ramp blend while the ramp preview is playing. Overrides
   * `rampDown` when set; cleared once the animation settles.
   */
  ramp01?: number;
  /** Continuous canopy blend while the canopy preview is playing. */
  canopy01?: number;
  /** Open/closed per ship-door id. */
  doorsOpen: Record<string, boolean>;
}

export interface EditorViewportOptions {
  /** Called when an asset card is dropped onto the scene. */
  onDropAsset: (payload: string, position: Vec3) => void;
  /** Called when a prefab card is dropped onto the scene. */
  onDropPrefab: (prefabId: string, position: Vec3) => void;
}

export interface EditorViewport {
  setGizmoMode: (mode: GizmoMode) => void;
  setGizmoSpace: (space: GizmoSpace) => void;
  setSnap: (
    enabled: boolean,
    translateStep: number,
    rotateStepDegrees: number,
  ) => void;
  /** Toggle editor hemi/sun/fill so authored point/spot/area lights read clearly. */
  setEnvironmentLights: (enabled: boolean) => void;
  /**
   * Unity-style in-editor Play: Scene view becomes Play view in place.
   * Disables edit picking/gizmos; flythrough camera remains available.
   */
  setPlayMode: (playing: boolean) => void;
  isPlayMode: () => boolean;
  /** Ship kind only: articulates gear/ramp/doors on loaded models for preview. */
  setShipPreview: (state: ShipPreviewState) => void;
  focusSelection: () => void;
  /** Orbit pivot (what the Scene view is centred on) in a parent's local space. */
  getViewFocusPosition: (parentEntityId: string | null) => Vec3;
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
  /**
   * Uncommitted material scrub for the Material inspector: repaints the live
   * entity every frame while a slider is dragged, without writing to the
   * document. Pass `null` to restore the committed materials.
   */
  setMaterialPreview: (
    entityId: string,
    material: string,
    override: PrefabMaterialOverride | null,
  ) => void;
  /** True while the RMB flythrough owns the camera (WASD is flying, not tool shortcuts). */
  isFlying: () => boolean;
  particlePreview: ParticlePreviewControls;
  dispose: () => void;
}
