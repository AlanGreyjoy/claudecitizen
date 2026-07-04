import { createCommandStack } from './commands';
import type {
  PrefabComponent,
  PrefabKind,
  PrefabPrimitive,
} from '../world/prefabs/schema';
import type { Vec3 } from '../types';

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
  asset: { url: string; castShadow?: boolean } | null;
  primitive: PrefabPrimitive | null;
  components: PrefabComponent[];
  children: EditorEntity[];
}

export interface EditorDocumentState {
  prefabId: string;
  prefabName: string;
  kind: PrefabKind;
  roots: EditorEntity[];
}

export interface EntityTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** Read-only GLB scene graph node cached after model load (not serialized). */
export interface GlbNodeRef {
  uuid: string;
  name: string;
  children: GlbNodeRef[];
}

export interface SubSelection {
  entityId: string;
  nodeUuid: string;
}

export type EditorEvent =
  | { type: 'structure' }
  | { type: 'transform'; entityId: string }
  | { type: 'entity'; entityId: string }
  | { type: 'selection'; entityId: string | null }
  | { type: 'sub-selection'; entityId: string | null; nodeUuid: string | null }
  | { type: 'glb-tree'; entityId: string }
  | { type: 'glb-transform'; entityId: string; nodeUuid: string; nodeName: string }
  | { type: 'document' }
  | { type: 'history' };

export interface EntityLocation {
  entity: EditorEntity;
  /** Sibling list that contains the entity (roots for top-level). */
  siblings: EditorEntity[];
  index: number;
  parent: EditorEntity | null;
}

function makeEntityId(): string {
  return `e-${crypto.randomUUID().slice(0, 8)}`;
}

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function cloneTransform(t: EntityTransform): EntityTransform {
  return { position: cloneVec(t.position), rotation: cloneVec(t.rotation), scale: cloneVec(t.scale) };
}

export function createEmptyEntity(name: string): EditorEntity {
  return {
    id: makeEntityId(),
    name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    asset: null,
    primitive: null,
    components: [],
    children: [],
  };
}

function regenerateIds(entity: EditorEntity): void {
  entity.id = makeEntityId();
  for (const child of entity.children) regenerateIds(child);
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore() {
  let state: EditorDocumentState = {
    prefabId: '',
    prefabName: 'Untitled Prefab',
    kind: 'station',
    roots: [],
  };
  let selection: string | null = null;
  let subSelection: SubSelection | null = null;
  const glbTreesByEntityId = new Map<string, GlbNodeRef>();
  const glbNodeOverrides = new Map<string, EntityTransform>();
  let dirty = false;

  const listeners = new Set<(event: EditorEvent) => void>();

  function emit(event: EditorEvent): void {
    for (const listener of listeners) listener(event);
  }

  const history = createCommandStack(() => emit({ type: 'history' }));

  function markDirty(): void {
    dirty = true;
  }

  function locate(id: string): EntityLocation | null {
    const stack: { list: EditorEntity[]; parent: EditorEntity | null }[] = [
      { list: state.roots, parent: null },
    ];
    while (stack.length > 0) {
      const { list, parent } = stack.pop()!;
      for (let index = 0; index < list.length; index += 1) {
        const entity = list[index];
        if (entity.id === id) return { entity, siblings: list, index, parent };
        stack.push({ list: entity.children, parent: entity });
      }
    }
    return null;
  }

  function isDescendant(ancestorId: string, id: string): boolean {
    const ancestor = locate(ancestorId)?.entity;
    if (!ancestor) return false;
    const stack = [...ancestor.children];
    while (stack.length > 0) {
      const entity = stack.pop()!;
      if (entity.id === id) return true;
      stack.push(...entity.children);
    }
    return false;
  }

  function setSelection(id: string | null): void {
    const selectionChanged = selection !== id;
    const hadSub = subSelection !== null;
    subSelection = null;
    if (selectionChanged) {
      selection = id;
      emit({ type: 'selection', entityId: id });
    }
    if (hadSub) {
      emit({ type: 'sub-selection', entityId: id, nodeUuid: null });
    }
  }

  function setSubSelection(entityId: string, nodeUuid: string): void {
    const prev = subSelection;
    subSelection = { entityId, nodeUuid };
    if (selection !== entityId) {
      selection = entityId;
      emit({ type: 'selection', entityId });
    }
    if (
      !prev ||
      prev.entityId !== entityId ||
      prev.nodeUuid !== nodeUuid
    ) {
      emit({ type: 'sub-selection', entityId, nodeUuid });
    }
  }

  function findGlbNodeName(tree: GlbNodeRef, nodeUuid: string): string | null {
    if (tree.uuid === nodeUuid) return tree.name;
    for (const child of tree.children) {
      const name = findGlbNodeName(child, nodeUuid);
      if (name) return name;
    }
    return null;
  }

  function setGlbTree(entityId: string, tree: GlbNodeRef | null): void {
    if (tree) glbTreesByEntityId.set(entityId, tree);
    else glbTreesByEntityId.delete(entityId);
    emit({ type: 'glb-tree', entityId });
  }

  function clearGlbTrees(): void {
    if (glbTreesByEntityId.size === 0) return;
    glbTreesByEntityId.clear();
    emit({ type: 'glb-tree', entityId: '' });
  }

  function glbOverrideKey(entityId: string, nodeName: string): string {
    return `${entityId}::${nodeName}`;
  }

  function resolveGlbNodeName(entityId: string, nodeUuid: string): string | null {
    const tree = glbTreesByEntityId.get(entityId);
    if (!tree) return null;
    return findGlbNodeName(tree, nodeUuid);
  }

  function clearGlbOverridesForEntity(entityId: string): void {
    const prefix = `${entityId}::`;
    for (const key of [...glbNodeOverrides.keys()]) {
      if (key.startsWith(prefix)) glbNodeOverrides.delete(key);
    }
  }

  function emitGlbTransform(
    entityId: string,
    nodeUuid: string,
    nodeName: string,
  ): void {
    emit({ type: 'glb-transform', entityId, nodeUuid, nodeName });
  }

  function setGlbOverride(
    entityId: string,
    nodeName: string,
    nodeUuid: string,
    transform: EntityTransform,
  ): void {
    glbNodeOverrides.set(
      glbOverrideKey(entityId, nodeName),
      cloneTransform(transform),
    );
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function notifyGlbNodeTransform(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function insertEntity(entity: EditorEntity, parentId: string | null, index?: number): void {
    const list = parentId === null ? state.roots : locate(parentId)?.entity.children;
    if (!list) return;
    list.splice(index ?? list.length, 0, entity);
  }

  function detachEntity(id: string): { entity: EditorEntity; parentId: string | null; index: number } | null {
    const location = locate(id);
    if (!location) return null;
    location.siblings.splice(location.index, 1);
    return {
      entity: location.entity,
      parentId: location.parent?.id ?? null,
      index: location.index,
    };
  }

  function addEntity(entity: EditorEntity, parentId: string | null = null): string {
    history.execute({
      label: `Add ${entity.name}`,
      do() {
        insertEntity(entity, parentId);
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        detachEntity(entity.id);
        if (selection === entity.id) setSelection(null);
        emit({ type: 'structure' });
      },
    });
    setSelection(entity.id);
    return entity.id;
  }

  function deleteEntity(id: string): void {
    const location = locate(id);
    if (!location) return;
    const { entity } = location;
    const parentId = location.parent?.id ?? null;
    const index = location.index;
    history.execute({
      label: `Delete ${entity.name}`,
      do() {
        detachEntity(id);
        clearGlbOverridesForEntity(id);
        if (selection === id) setSelection(null);
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        insertEntity(entity, parentId, index);
        emit({ type: 'structure' });
      },
    });
  }

  function duplicateEntity(id: string): string | null {
    const location = locate(id);
    if (!location) return null;
    const copy = structuredClone(location.entity);
    regenerateIds(copy);
    copy.name = `${copy.name} Copy`;
    copy.position = { ...copy.position, x: copy.position.x + 1 };
    const parentId = location.parent?.id ?? null;
    history.execute({
      label: `Duplicate ${location.entity.name}`,
      do() {
        insertEntity(copy, parentId, location.index + 1);
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        detachEntity(copy.id);
        if (selection === copy.id) setSelection(null);
        emit({ type: 'structure' });
      },
    });
    setSelection(copy.id);
    return copy.id;
  }

  function reparentEntity(id: string, newParentId: string | null): void {
    if (id === newParentId) return;
    if (newParentId && isDescendant(id, newParentId)) return;
    const location = locate(id);
    if (!location) return;
    const oldParentId = location.parent?.id ?? null;
    if (oldParentId === newParentId) return;
    const oldIndex = location.index;
    history.execute({
      label: `Move ${location.entity.name}`,
      do() {
        const detached = detachEntity(id);
        if (detached) insertEntity(detached.entity, newParentId);
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        const detached = detachEntity(id);
        if (detached) insertEntity(detached.entity, oldParentId, oldIndex);
        emit({ type: 'structure' });
      },
    });
  }

  function patchEntity(
    id: string,
    label: string,
    apply: (entity: EditorEntity) => void,
    revert: (entity: EditorEntity) => void,
  ): void {
    history.execute({
      label,
      do() {
        const entity = locate(id)?.entity;
        if (!entity) return;
        apply(entity);
        markDirty();
        emit({ type: 'entity', entityId: id });
      },
      undo() {
        const entity = locate(id)?.entity;
        if (!entity) return;
        revert(entity);
        emit({ type: 'entity', entityId: id });
      },
    });
  }

  function renameEntity(id: string, name: string): void {
    const before = locate(id)?.entity.name;
    if (before === undefined || before === name) return;
    patchEntity(
      id,
      `Rename to ${name}`,
      (entity) => {
        entity.name = name;
      },
      (entity) => {
        entity.name = before;
      },
    );
  }

  function setVisible(id: string, visible: boolean): void {
    const before = locate(id)?.entity.visible;
    if (before === undefined || before === visible) return;
    patchEntity(
      id,
      visible ? 'Show' : 'Hide',
      (entity) => {
        entity.visible = visible;
      },
      (entity) => {
        entity.visible = before;
      },
    );
  }

  function setPrimitive(id: string, primitive: PrefabPrimitive | null): void {
    const before = locate(id)?.entity.primitive ?? null;
    patchEntity(
      id,
      'Edit primitive',
      (entity) => {
        entity.primitive = primitive ? structuredClone(primitive) : null;
      },
      (entity) => {
        entity.primitive = before ? structuredClone(before) : null;
      },
    );
  }

  function setAsset(id: string, asset: { url: string; castShadow?: boolean } | null): void {
    const before = locate(id)?.entity.asset ?? null;
    patchEntity(
      id,
      'Edit asset',
      (entity) => {
        entity.asset = asset ? { ...asset } : null;
      },
      (entity) => {
        entity.asset = before ? { ...before } : null;
      },
    );
  }

  function setComponents(id: string, components: PrefabComponent[]): void {
    const before = locate(id)?.entity.components;
    if (!before) return;
    const beforeCopy = structuredClone(before);
    const nextCopy = structuredClone(components);
    patchEntity(
      id,
      'Edit components',
      (entity) => {
        entity.components = structuredClone(nextCopy);
      },
      (entity) => {
        entity.components = structuredClone(beforeCopy);
      },
    );
  }

  function setTransform(id: string, transform: EntityTransform): void {
    const entity = locate(id)?.entity;
    if (!entity) return;
    const before = cloneTransform(entity);
    const after = cloneTransform(transform);
    history.execute({
      label: `Transform ${entity.name}`,
      do() {
        const target = locate(id)?.entity;
        if (!target) return;
        target.position = cloneVec(after.position);
        target.rotation = cloneVec(after.rotation);
        target.scale = cloneVec(after.scale);
        markDirty();
        emit({ type: 'transform', entityId: id });
      },
      undo() {
        const target = locate(id)?.entity;
        if (!target) return;
        target.position = cloneVec(before.position);
        target.rotation = cloneVec(before.rotation);
        target.scale = cloneVec(before.scale);
        emit({ type: 'transform', entityId: id });
      },
    });
  }

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
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
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
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    setGlbOverride(entityId, nodeName, nodeUuid, transform);
  }

  function endGlbTransformGesture(): void {
    if (!glbGesture) return;
    const { entityId, nodeUuid, nodeName, before } = glbGesture;
    glbGesture = null;
    const key = glbOverrideKey(entityId, nodeName);
    const after = glbNodeOverrides.get(key);
    if (!after) return;
    const afterCopy = cloneTransform(after);
    const beforeCopy = cloneTransform(before);
    if (JSON.stringify(beforeCopy) === JSON.stringify(afterCopy)) return;
    history.execute({
      label: `Transform mesh ${nodeName}`,
      do() {
        setGlbOverride(entityId, nodeName, nodeUuid, afterCopy);
      },
      undo() {
        setGlbOverride(entityId, nodeName, nodeUuid, beforeCopy);
      },
    });
  }

  function commitGlbNodeTransform(
    entityId: string,
    nodeUuid: string,
    before: EntityTransform,
    after: EntityTransform,
  ): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    const beforeCopy = cloneTransform(before);
    const afterCopy = cloneTransform(after);
    if (JSON.stringify(beforeCopy) === JSON.stringify(afterCopy)) return;
    history.execute({
      label: `Transform mesh ${nodeName}`,
      do() {
        setGlbOverride(entityId, nodeName, nodeUuid, afterCopy);
      },
      undo() {
        setGlbOverride(entityId, nodeName, nodeUuid, beforeCopy);
      },
    });
  }

  function beginTransformGesture(id: string): void {
    const entity = locate(id)?.entity;
    if (!entity) return;
    gesture = { entityId: id, before: cloneTransform(entity) };
  }

  function previewTransform(id: string, transform: EntityTransform): void {
    const entity = locate(id)?.entity;
    if (!entity) return;
    entity.position = cloneVec(transform.position);
    entity.rotation = cloneVec(transform.rotation);
    entity.scale = cloneVec(transform.scale);
    markDirty();
    emit({ type: 'transform', entityId: id });
  }

  function endTransformGesture(): void {
    if (!gesture) return;
    const { entityId, before } = gesture;
    gesture = null;
    const entity = locate(entityId)?.entity;
    if (!entity) return;
    const after = cloneTransform(entity);
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    if (unchanged) return;
    history.execute({
      label: `Transform ${entity.name}`,
      do() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        target.position = cloneVec(after.position);
        target.rotation = cloneVec(after.rotation);
        target.scale = cloneVec(after.scale);
        markDirty();
        emit({ type: 'transform', entityId });
      },
      undo() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        target.position = cloneVec(before.position);
        target.rotation = cloneVec(before.rotation);
        target.scale = cloneVec(before.scale);
        emit({ type: 'transform', entityId });
      },
    });
  }

  function newDocument(): void {
    state = { prefabId: '', prefabName: 'Untitled Prefab', kind: 'station', roots: [] };
    selection = null;
    subSelection = null;
    glbTreesByEntityId.clear();
    glbNodeOverrides.clear();
    dirty = false;
    history.clear();
    emit({ type: 'document' });
    emit({ type: 'structure' });
    emit({ type: 'selection', entityId: null });
  }

  function loadDocument(next: EditorDocumentState): void {
    state = next;
    selection = null;
    subSelection = null;
    glbTreesByEntityId.clear();
    glbNodeOverrides.clear();
    dirty = false;
    history.clear();
    emit({ type: 'document' });
    emit({ type: 'structure' });
    emit({ type: 'selection', entityId: null });
  }

  function setPrefabMeta(meta: Partial<Pick<EditorDocumentState, 'prefabId' | 'prefabName' | 'kind'>>): void {
    state = { ...state, ...meta };
    markDirty();
    emit({ type: 'document' });
  }

  return {
    subscribe(listener: (event: EditorEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    getSelection: () => selection,
    getSubSelection: () => subSelection,
    getGlbTree: (entityId: string) => glbTreesByEntityId.get(entityId) ?? null,
    getGlbNodeName: (entityId: string, nodeUuid: string) => {
      const tree = glbTreesByEntityId.get(entityId);
      return tree ? findGlbNodeName(tree, nodeUuid) : null;
    },
    getGlbNodeOverride: (entityId: string, nodeUuid: string) => {
      const nodeName = resolveGlbNodeName(entityId, nodeUuid);
      if (!nodeName) return null;
      return glbNodeOverrides.get(glbOverrideKey(entityId, nodeName)) ?? null;
    },
    getGlbOverridesForEntity: (entityId: string) => {
      const prefix = `${entityId}::`;
      const overrides: { nodeName: string; transform: EntityTransform }[] = [];
      for (const [key, transform] of glbNodeOverrides.entries()) {
        if (!key.startsWith(prefix)) continue;
        overrides.push({
          nodeName: key.slice(prefix.length),
          transform: cloneTransform(transform),
        });
      }
      return overrides;
    },
    getSelectedEntity: () => (selection ? locate(selection)?.entity ?? null : null),
    isDirty: () => dirty,
    markSaved: () => {
      dirty = false;
    },
    locate,
    setSelection,
    setSubSelection,
    setGlbTree,
    clearGlbTrees,
    notifyGlbNodeTransform,
    addEntity,
    deleteEntity,
    duplicateEntity,
    reparentEntity,
    renameEntity,
    setVisible,
    setPrimitive,
    setAsset,
    setComponents,
    setTransform,
    beginTransformGesture,
    previewTransform,
    endTransformGesture,
    beginGlbTransformGesture,
    previewGlbTransform,
    endGlbTransformGesture,
    commitGlbNodeTransform,
    newDocument,
    loadDocument,
    setPrefabMeta,
    undo: () => history.undo(),
    redo: () => history.redo(),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
  };
}
