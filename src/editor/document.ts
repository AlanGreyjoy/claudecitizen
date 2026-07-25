import { createCommandStack } from './commands';
import type {
  EditorDocumentState,
  EditorEvent,
  EntityLocation,
  EntityTransform,
  GlbNodeRef,
  SubSelection,
} from './document-types';
import {
  cloneTransform,
  isDescendantOf,
  locateEntity,
} from './document-entity-utils';
import { findGlbNodeName, glbOverrideKey } from './document-glb-tree';
import type { EditorStoreCtx } from './document-store-ctx';
import { attachEntityPropMethods } from './document-store-entity-props';
import { attachGlbMethods } from './document-store-glb';
import { attachSelectionMethods } from './document-store-selection';
import { attachStructureMethods } from './document-store-structure';
import { attachTransformLifecycleMethods } from './document-store-transforms';

export type {
  EditorDocumentType,
  EditorEntity,
  EditorDocumentState,
  EntityTransform,
  GlbNodeTransformOverride,
  NodeOverrideComponentsEdit,
  GlbNodeRef,
  SubSelection,
  EntitySelectionMode,
  EditorEvent,
  EntityLocation,
} from './document-types';

export { createEmptyEntity } from './document-entity-utils';

export type EditorStore = ReturnType<typeof createEditorStore>;

function buildStoreCtx(
  emit: (event: EditorEvent) => void,
): EditorStoreCtx {
  const ctx = {
    state: {
      documentType: 'scene',
      prefabId: '',
      prefabName: 'Untitled Scene',
      kind: 'site',
      sceneKind: 'main-game',
      roots: [],
    } as EditorDocumentState,
    selection: null as string | null,
    selectedIds: new Set<string>(),
    subSelection: null as SubSelection | null,
    glbTreesByEntityId: new Map<string, GlbNodeRef>(),
    glbNodeOverrides: new Map<string, EntityTransform>(),
    dirty: false,
    history: null as unknown as EditorStoreCtx['history'],
  } as EditorStoreCtx;

  ctx.emit = emit;
  ctx.markDirty = (): void => {
    ctx.dirty = true;
  };
  ctx.history = createCommandStack(() => ctx.emit({ type: 'history' }));
  ctx.locate = (id: string): EntityLocation | null => locateEntity(ctx.state.roots, id);
  ctx.isDescendant = (ancestorId: string, id: string): boolean =>
    isDescendantOf(ctx.state.roots, ancestorId, id);

  attachSelectionMethods(ctx);
  attachGlbMethods(ctx);
  attachStructureMethods(ctx);
  attachEntityPropMethods(ctx);
  attachTransformLifecycleMethods(ctx);

  return ctx;
}

export function createEditorStore() {
  const listeners = new Set<(event: EditorEvent) => void>();
  const emit = (event: EditorEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const ctx = buildStoreCtx(emit);

  return {
    subscribe(listener: (event: EditorEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => ctx.state,
    getSelection: () => ctx.selection,
    getSelectedIds: () => [...ctx.selectedIds],
    isEntitySelected: (id: string) => ctx.selectedIds.has(id),
    getSubSelection: () => ctx.subSelection,
    getGlbTree: (entityId: string) => ctx.glbTreesByEntityId.get(entityId) ?? null,
    getGlbNodeName: (entityId: string, nodeUuid: string) => {
      const tree = ctx.glbTreesByEntityId.get(entityId);
      return tree ? findGlbNodeName(tree, nodeUuid) : null;
    },
    getGlbNodeOverride: (entityId: string, nodeUuid: string) => {
      const nodeName = ctx.resolveGlbNodeName(entityId, nodeUuid);
      if (!nodeName) return null;
      return ctx.glbNodeOverrides.get(glbOverrideKey(entityId, nodeName)) ?? null;
    },
    getGlbOverridesForEntity: (entityId: string) => {
      const prefix = `${entityId}::`;
      const overrides: { nodeName: string; transform: EntityTransform }[] = [];
      for (const [key, transform] of ctx.glbNodeOverrides.entries()) {
        if (!key.startsWith(prefix)) continue;
        overrides.push({
          nodeName: key.slice(prefix.length),
          transform: cloneTransform(transform),
        });
      }
      return overrides;
    },
    getGlbHiddenNodes: (entityId: string) =>
      ctx.locate(entityId)?.entity.glbNodeHidden.slice() ?? [],
    isGlbNodeHidden: ctx.isGlbNodeHidden,
    getSelectedEntity: () => (ctx.selection ? ctx.locate(ctx.selection)?.entity ?? null : null),
    isDirty: () => ctx.dirty,
    markSaved: () => {
      ctx.dirty = false;
    },
    /** Restore a suspended dirty bit after `loadDocument` (prefab isolation). */
    setDirty: (value: boolean) => {
      ctx.dirty = value;
    },
    locate: ctx.locate,
    setSelection: ctx.setSelection,
    setEntitySelection: ctx.setEntitySelection,
    clearSelection: ctx.clearSelection,
    setSubSelection: ctx.setSubSelection,
    setGlbTree: ctx.setGlbTree,
    clearGlbTrees: ctx.clearGlbTrees,
    notifyGlbNodeTransform: ctx.notifyGlbNodeTransform,
    hideGlbNode: ctx.hideGlbNode,
    showGlbNode: ctx.showGlbNode,
    addEntity: ctx.addEntity,
    deleteEntity: ctx.deleteEntity,
    deleteEntities: ctx.deleteEntities,
    duplicateEntity: ctx.duplicateEntity,
    duplicateGlbNode: ctx.duplicateGlbNode,
    extractGlbNode: ctx.extractGlbNode,
    duplicateEntities: ctx.duplicateEntities,
    reparentEntity: ctx.reparentEntity,
    reparentEntities: ctx.reparentEntities,
    groupSelectedInEmpty: ctx.groupSelectedInEmpty,
    replaceEntityWithPrefabInstance: ctx.replaceEntityWithPrefabInstance,
    renameEntity: ctx.renameEntity,
    setVisible: ctx.setVisible,
    setPrimitive: ctx.setPrimitive,
    setAsset: ctx.setAsset,
    setMaterialOverride: ctx.setMaterialOverride,
    setComponents: ctx.setComponents,
    setNodeOverrideComponents: ctx.setNodeOverrideComponents,
    setNodeOverrideComponentsBatch: ctx.setNodeOverrideComponentsBatch,
    getNodeOverrideComponents: ctx.getNodeOverrideComponents,
    setTransform: ctx.setTransform,
    beginTransformGesture: ctx.beginTransformGesture,
    previewTransform: ctx.previewTransform,
    endTransformGesture: ctx.endTransformGesture,
    beginGlbTransformGesture: ctx.beginGlbTransformGesture,
    previewGlbTransform: ctx.previewGlbTransform,
    endGlbTransformGesture: ctx.endGlbTransformGesture,
    commitGlbNodeTransform: ctx.commitGlbNodeTransform,
    newDocument: ctx.newDocument,
    newScene: ctx.newScene,
    loadDocument: ctx.loadDocument,
    setPrefabMeta: ctx.setPrefabMeta,
    setDocumentMeta: ctx.setDocumentMeta,
    undo: () => ctx.history.undo(),
    redo: () => ctx.history.redo(),
    canUndo: () => ctx.history.canUndo(),
    canRedo: () => ctx.history.canRedo(),
  };
}
