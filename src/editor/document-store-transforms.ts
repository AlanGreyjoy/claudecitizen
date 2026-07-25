import type { EditorStoreCtx } from './document-store-ctx';
import type { EditorDocumentState, EntityTransform } from './document-types';
import { cloneTransform, cloneVec } from './document-entity-utils';
import { glbOverrideKey } from './document-glb-tree';

export function attachTransformLifecycleMethods(ctx: EditorStoreCtx): void {
  // Gizmo drags preview live and collapse into a single undo entry on release.
  let gesture: { entityId: string; before: EntityTransform } | null = null;
  let glbGesture: {
    entityId: string;
    nodeUuid: string;
    nodeName: string;
    before: EntityTransform;
  } | null = null;

  function beginGlbTransformGesture(
    entityId: string,
    nodeUuid: string,
    before: EntityTransform,
  ): void {
    const nodeName = ctx.resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    glbGesture = {
      entityId,
      nodeUuid,
      nodeName,
      before: cloneTransform(before),
    };
  }

  function previewGlbTransform(
    entityId: string,
    nodeUuid: string,
    transform: EntityTransform,
  ): void {
    const nodeName = ctx.resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    ctx.setGlbOverride(entityId, nodeName, nodeUuid, transform);
  }

  function endGlbTransformGesture(): void {
    if (!glbGesture) return;
    const { entityId, nodeUuid, nodeName, before } = glbGesture;
    glbGesture = null;
    const key = glbOverrideKey(entityId, nodeName);
    const after = ctx.glbNodeOverrides.get(key);
    if (!after) return;
    const afterCopy = cloneTransform(after);
    const beforeCopy = cloneTransform(before);
    if (JSON.stringify(beforeCopy) === JSON.stringify(afterCopy)) return;
    ctx.history.execute({
      label: `Transform mesh ${nodeName}`,
      do() {
        ctx.setGlbOverride(entityId, nodeName, nodeUuid, afterCopy);
      },
      undo() {
        ctx.setGlbOverride(entityId, nodeName, nodeUuid, beforeCopy);
      },
    });
  }

  function commitGlbNodeTransform(
    entityId: string,
    nodeUuid: string,
    before: EntityTransform,
    after: EntityTransform,
  ): void {
    const nodeName = ctx.resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    const beforeCopy = cloneTransform(before);
    const afterCopy = cloneTransform(after);
    if (JSON.stringify(beforeCopy) === JSON.stringify(afterCopy)) return;
    ctx.history.execute({
      label: `Transform mesh ${nodeName}`,
      do() {
        ctx.setGlbOverride(entityId, nodeName, nodeUuid, afterCopy);
      },
      undo() {
        ctx.setGlbOverride(entityId, nodeName, nodeUuid, beforeCopy);
      },
    });
  }

  function beginTransformGesture(id: string): void {
    const entity = ctx.locate(id)?.entity;
    if (!entity) return;
    gesture = { entityId: id, before: cloneTransform(entity) };
  }

  function previewTransform(id: string, transform: EntityTransform): void {
    const entity = ctx.locate(id)?.entity;
    if (!entity) return;
    entity.position = cloneVec(transform.position);
    entity.rotation = cloneVec(transform.rotation);
    entity.scale = cloneVec(transform.scale);
    ctx.markDirty();
    ctx.emit({ type: 'transform', entityId: id });
  }

  function endTransformGesture(): void {
    if (!gesture) return;
    const { entityId, before } = gesture;
    gesture = null;
    const entity = ctx.locate(entityId)?.entity;
    if (!entity) return;
    const after = cloneTransform(entity);
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    if (unchanged) return;
    ctx.history.execute({
      label: `Transform ${entity.name}`,
      do() {
        const target = ctx.locate(entityId)?.entity;
        if (!target) return;
        target.position = cloneVec(after.position);
        target.rotation = cloneVec(after.rotation);
        target.scale = cloneVec(after.scale);
        ctx.markDirty();
        ctx.emit({ type: 'transform', entityId });
      },
      undo() {
        const target = ctx.locate(entityId)?.entity;
        if (!target) return;
        target.position = cloneVec(before.position);
        target.rotation = cloneVec(before.rotation);
        target.scale = cloneVec(before.scale);
        ctx.emit({ type: 'transform', entityId });
      },
    });
  }

  function resetSessionAfterDocumentChange(): void {
    ctx.selection = null;
    ctx.selectedIds = new Set();
    ctx.subSelection = null;
    ctx.glbTreesByEntityId.clear();
    ctx.glbNodeOverrides.clear();
    ctx.dirty = false;
    ctx.history.clear();
    ctx.emit({ type: 'document' });
    ctx.emit({ type: 'structure' });
    ctx.emit({ type: 'selection', entityId: null, selectedIds: [] });
  }

  function newDocument(): void {
    ctx.state = {
      documentType: 'prefab',
      prefabId: '',
      prefabName: 'Untitled Prefab',
      kind: 'station',
      sceneKind: 'main-game',
      roots: [],
    };
    resetSessionAfterDocumentChange();
  }

  /**
   * Empty scene shell. Callers that want a starting GameObject set load
   * `createSceneEditorStateFromTemplate()` instead.
   */
  function newScene(): void {
    ctx.state = {
      documentType: 'scene',
      prefabId: '',
      prefabName: 'Untitled Scene',
      kind: 'site',
      sceneKind: 'main-game',
      roots: [],
    };
    resetSessionAfterDocumentChange();
  }

  function loadDocument(next: EditorDocumentState): void {
    ctx.state = {
      documentType: next.documentType ?? 'prefab',
      prefabId: next.prefabId,
      prefabName: next.prefabName,
      kind: next.kind,
      sceneKind: next.sceneKind ?? 'main-game',
      roots: next.roots,
    };
    ctx.selection = null;
    ctx.selectedIds = new Set();
    ctx.subSelection = null;
    ctx.glbTreesByEntityId.clear();
    ctx.rebuildGlbOverridesFromState();
    ctx.dirty = false;
    ctx.history.clear();
    ctx.emit({ type: 'document' });
    ctx.emit({ type: 'structure' });
    ctx.emit({ type: 'selection', entityId: null, selectedIds: [] });
  }

  function setPrefabMeta(
    meta: Partial<Pick<EditorDocumentState, 'prefabId' | 'prefabName' | 'kind'>>,
  ): void {
    ctx.state = { ...ctx.state, ...meta };
    ctx.markDirty();
    ctx.emit({ type: 'document' });
  }

  function setDocumentMeta(
    meta: Partial<
      Pick<
        EditorDocumentState,
        | 'documentType'
        | 'prefabId'
        | 'prefabName'
        | 'kind'
        | 'sceneKind'
      >
    >,
  ): void {
    ctx.state = { ...ctx.state, ...meta };
    ctx.markDirty();
    ctx.emit({ type: 'document' });
  }
  ctx.beginGlbTransformGesture = beginGlbTransformGesture;
  ctx.previewGlbTransform = previewGlbTransform;
  ctx.endGlbTransformGesture = endGlbTransformGesture;
  ctx.commitGlbNodeTransform = commitGlbNodeTransform;
  ctx.beginTransformGesture = beginTransformGesture;
  ctx.previewTransform = previewTransform;
  ctx.endTransformGesture = endTransformGesture;
  ctx.newDocument = newDocument;
  ctx.newScene = newScene;
  ctx.loadDocument = loadDocument;
  ctx.setPrefabMeta = setPrefabMeta;
  ctx.setDocumentMeta = setDocumentMeta;
}
