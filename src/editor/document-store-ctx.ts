import type { CommandStack } from './commands';
import type {
  EditorDocumentState,
  EditorEntity,
  EditorEvent,
  EntityLocation,
  EntityTransform,
  GlbNodeRef,
  NodeOverrideComponentsEdit,
  SubSelection,
  EntitySelectionMode,
} from './document-types';
import type { PrefabComponent, PrefabKind, PrefabMaterialOverride, PrefabPrimitive } from '../world/prefabs/schema';

export type EditorCommandStack = CommandStack;

/**
 * Mutable bag shared by store method modules. Factories assign methods onto
 * this object so cross-module calls stay behavior-identical to the old closure.
 */
export type EditorStoreCtx = {
  state: EditorDocumentState;
  selection: string | null;
  selectedIds: Set<string>;
  subSelection: SubSelection | null;
  glbTreesByEntityId: Map<string, GlbNodeRef>;
  glbNodeOverrides: Map<string, EntityTransform>;
  dirty: boolean;
  history: EditorCommandStack;
  emit: (event: EditorEvent) => void;
  markDirty: () => void;
  locate: (id: string) => EntityLocation | null;
  isDescendant: (ancestorId: string, id: string) => boolean;

  // selection
  pruneSelectedIds: () => void;
  emitSelection: () => void;
  removeIdsFromSelection: (ids: Iterable<string>) => void;
  clearSelection: () => void;
  setEntitySelection: (
    id: string | null,
    mode?: EntitySelectionMode,
    rangeAnchorId?: string,
    visibleOrder?: readonly string[],
  ) => void;
  setSelection: (id: string | null) => void;
  setSubSelection: (entityId: string, nodeUuid: string) => void;

  // glb
  setGlbTree: (entityId: string, tree: GlbNodeRef | null) => void;
  clearGlbTrees: () => void;
  resolveGlbNodeName: (entityId: string, nodeUuid: string) => string | null;
  clearGlbOverridesForEntity: (entityId: string) => void;
  setGlbOverride: (
    entityId: string,
    nodeName: string,
    nodeUuid: string,
    transform: EntityTransform,
  ) => void;
  setNodeOverrideComponentsBatch: (
    edits: NodeOverrideComponentsEdit[],
    label?: string,
  ) => void;
  setNodeOverrideComponents: (
    entityId: string,
    nodeName: string,
    components: PrefabComponent[],
  ) => void;
  getNodeOverrideComponents: (entityId: string, nodeName: string) => PrefabComponent[];
  rebuildGlbOverridesFromState: () => void;
  notifyGlbNodeTransform: (entityId: string, nodeUuid: string) => void;
  hideGlbNode: (entityId: string, nodeUuid: string) => void;
  showGlbNode: (entityId: string, nodeName: string) => void;
  isGlbNodeHidden: (entityId: string, nodeName: string) => boolean;

  // structure
  insertEntity: (entity: EditorEntity, parentId: string | null, index?: number) => void;
  detachEntity: (
    id: string,
  ) => { entity: EditorEntity; parentId: string | null; index: number } | null;
  addEntity: (entity: EditorEntity, parentId?: string | null) => string;
  deleteEntity: (id: string) => void;
  deleteEntities: (ids: string[]) => void;
  duplicateEntity: (id: string) => string | null;
  duplicateGlbNode: (
    entityId: string,
    nodeName: string,
    transform: EntityTransform,
  ) => string | null;
  extractGlbNode: (
    entityId: string,
    nodeUuid: string,
    targetParentId: string | null,
    transform: EntityTransform,
    adoptedChildren?: ReadonlyArray<{ id: string; transform: EntityTransform }>,
  ) => string | null;
  duplicateEntities: (ids: string[]) => string[];
  reparentEntity: (id: string, newParentId: string | null) => void;
  reparentEntities: (ids: string[], newParentId: string | null) => void;
  groupSelectedInEmpty: () => string | null;
  replaceEntityWithPrefabInstance: (
    id: string,
    prefabId: string,
    prefabKind: PrefabKind,
  ) => string | null;

  // entity props
  renameEntity: (id: string, name: string) => void;
  setVisible: (id: string, visible: boolean) => void;
  setPrimitive: (id: string, primitive: PrefabPrimitive | null) => void;
  setAsset: (id: string, asset: { url: string; castShadow?: boolean } | null) => void;
  setMaterialOverride: (
    id: string,
    material: string,
    override: PrefabMaterialOverride | null,
  ) => void;
  setMaterialOverridesBatch: (
    edits: ReadonlyArray<{
      entityId: string;
      material: string;
      override: PrefabMaterialOverride | null;
    }>,
    label?: string,
  ) => void;
  setComponents: (id: string, components: PrefabComponent[]) => void;
  setTransform: (id: string, transform: EntityTransform) => void;

  // gestures
  beginGlbTransformGesture: (
    entityId: string,
    nodeUuid: string,
    before: EntityTransform,
  ) => void;
  previewGlbTransform: (
    entityId: string,
    nodeUuid: string,
    transform: EntityTransform,
  ) => void;
  endGlbTransformGesture: () => void;
  commitGlbNodeTransform: (
    entityId: string,
    nodeUuid: string,
    before: EntityTransform,
    after: EntityTransform,
  ) => void;
  beginTransformGesture: (id: string) => void;
  previewTransform: (id: string, transform: EntityTransform) => void;
  endTransformGesture: () => void;

  // lifecycle
  newDocument: () => void;
  newScene: () => void;
  loadDocument: (next: EditorDocumentState) => void;
  setPrefabMeta: (
    meta: Partial<Pick<EditorDocumentState, 'prefabId' | 'prefabName' | 'kind'>>,
  ) => void;
  setDocumentMeta: (
    meta: Partial<
      Pick<
        EditorDocumentState,
        | 'documentType'
        | 'prefabId'
        | 'prefabName'
        | 'kind'
        | 'sceneKind'
        | 'sceneRuntime'
      >
    >,
  ) => void;
};
