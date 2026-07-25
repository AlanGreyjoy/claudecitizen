import type {
  PrefabComponent,
  PrefabKind,
  PrefabMaterialOverride,
  PrefabPrimitive,
} from '../world/prefabs/schema';
import type { SceneKind } from '../world/scenes/schema';
import type { Vec3 } from '../types';

export type EditorDocumentType = 'scene' | 'prefab';

/**
 * Editor-side document model. Rotations are stored as XYZ euler degrees
 * (friendlier for inspector fields); serialization converts to quaternions.
 * Coordinates are prefab/scene axes — what you see in the viewport is what
 * the game renders.
 */
export interface EditorEntity {
  id: string;
  name: string;
  position: Vec3;
  /** Euler XYZ in degrees. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  asset: { url: string; castShadow?: boolean; node?: string } | null;
  primitive: PrefabPrimitive | null;
  glbNodeTransforms: GlbNodeTransformOverride[];
  /** Names of GLB nodes hidden (deleted) for this entity instance. */
  glbNodeHidden: string[];
  materialOverrides: PrefabMaterialOverride[];
  components: PrefabComponent[];
  /** GLB node name this entity is parented under in the hierarchy outliner. */
  glbAnchor?: string;
  children: EditorEntity[];
}

/**
 * Shared GameObject-tree document. `prefabId`/`prefabName` are the document
 * id/name for both scenes and prefabs (legacy field names). Scene-only fields
 * are ignored when `documentType === 'prefab'`.
 */
export interface EditorDocumentState {
  documentType: EditorDocumentType;
  prefabId: string;
  prefabName: string;
  kind: PrefabKind;
  sceneKind: SceneKind;
  roots: EditorEntity[];
}

export interface EntityTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface GlbNodeTransformOverride {
  nodeName: string;
  transform?: EntityTransform;
  components: PrefabComponent[];
}

export interface NodeOverrideComponentsEdit {
  entityId: string;
  nodeName: string;
  components: PrefabComponent[];
}

/** Read-only GLB scene graph node cached after model load (not serialized). */
export interface GlbNodeRef {
  uuid: string;
  name: string;
  children: GlbNodeRef[];
  /**
   * Identity Group with exactly one child and no own mesh/light/camera.
   * Hierarchy may hide these export/loader wrappers; the live graph keeps them.
   */
  passthrough?: boolean;
}

export interface SubSelection {
  entityId: string;
  nodeUuid: string;
  nodeName: string;
}

export type EntitySelectionMode = 'replace' | 'toggle' | 'range';

export type EditorEvent =
  | { type: 'structure' }
  | { type: 'transform'; entityId: string }
  | { type: 'entity'; entityId: string }
  | { type: 'selection'; entityId: string | null; selectedIds: string[] }
  | { type: 'sub-selection'; entityId: string | null; nodeUuid: string | null }
  | { type: 'glb-tree'; entityId: string }
  | { type: 'glb-transform'; entityId: string; nodeUuid: string; nodeName: string }
  | { type: 'glb-visibility'; entityId: string; nodeName: string }
  | {
      type: 'glb-components';
      edits: ReadonlyArray<{ entityId: string; nodeName: string }>;
    }
  | { type: 'document' }
  | { type: 'history' };

export interface EntityLocation {
  entity: EditorEntity;
  /** Sibling list that contains the entity (roots for top-level). */
  siblings: EditorEntity[];
  index: number;
  parent: EditorEntity | null;
}
