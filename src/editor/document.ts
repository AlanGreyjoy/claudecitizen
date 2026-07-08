import { createCommandStack } from './commands';
import type {
  PrefabComponent,
  PrefabKind,
  PrefabMaterialOverride,
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
  glbNodeTransforms: GlbNodeTransformOverride[];
  /** Names of GLB nodes hidden (deleted) for this entity instance. */
  glbNodeHidden: string[];
  materialOverrides: PrefabMaterialOverride[];
  components: PrefabComponent[];
  /** GLB node name this entity is parented under in the hierarchy outliner. */
  glbAnchor?: string;
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

export interface GlbNodeTransformOverride {
  nodeName: string;
  transform?: EntityTransform;
  components: PrefabComponent[];
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
    glbNodeTransforms: [],
    glbNodeHidden: [],
    materialOverrides: [],
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
  let selectedIds = new Set<string>();
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

  function pruneSelectedIds(): void {
    for (const id of [...selectedIds]) {
      if (!locate(id)) selectedIds.delete(id);
    }
    if (selection && !selectedIds.has(selection)) {
      selection = selectedIds.size > 0 ? [...selectedIds].at(-1)! : null;
    }
    if (selectedIds.size === 0) selection = null;
  }

  function selectionSetsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const id of a) {
      if (!b.has(id)) return false;
    }
    return true;
  }

  function emitSelection(): void {
    emit({
      type: 'selection',
      entityId: selection,
      selectedIds: [...selectedIds],
    });
  }

  function removeIdsFromSelection(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (selectedIds.delete(id)) changed = true;
    }
    if (!changed) return;
    if (selection && !selectedIds.has(selection)) {
      selection = selectedIds.size > 0 ? [...selectedIds].at(-1)! : null;
    }
    emitSelection();
  }

  function clearSelection(): void {
    const hadSelection = selectedIds.size > 0 || selection !== null;
    const hadSub = subSelection !== null;
    selection = null;
    selectedIds = new Set();
    subSelection = null;
    if (hadSelection) emitSelection();
    if (hadSub) {
      emit({ type: 'sub-selection', entityId: null, nodeUuid: null });
    }
  }

  function setEntitySelection(
    id: string | null,
    mode: EntitySelectionMode = 'replace',
    rangeAnchorId?: string,
    visibleOrder?: readonly string[],
  ): void {
    if (id === null) {
      clearSelection();
      return;
    }

    const hadSub = subSelection !== null;
    subSelection = null;

    const prevPrimary = selection;
    const prevSelected = new Set(selectedIds);
    let nextSelected = new Set(selectedIds);

    if (mode === 'replace') {
      nextSelected = new Set([id]);
      selection = id;
    } else if (mode === 'toggle') {
      if (nextSelected.has(id)) {
        nextSelected.delete(id);
        if (selection === id) {
          selection = nextSelected.size > 0 ? [...nextSelected].at(-1)! : null;
        }
      } else {
        nextSelected.add(id);
        selection = id;
      }
    } else if (mode === 'range') {
      const anchor = rangeAnchorId ?? selection;
      if (!anchor || !visibleOrder || visibleOrder.length === 0) {
        nextSelected = new Set([id]);
      } else {
        const anchorIndex = visibleOrder.indexOf(anchor);
        const clickIndex = visibleOrder.indexOf(id);
        if (anchorIndex === -1 || clickIndex === -1) {
          nextSelected.add(id);
        } else {
          const start = Math.min(anchorIndex, clickIndex);
          const end = Math.max(anchorIndex, clickIndex);
          for (let index = start; index <= end; index += 1) {
            nextSelected.add(visibleOrder[index]);
          }
        }
      }
      selection = id;
    }

    for (const selectedId of [...nextSelected]) {
      if (!locate(selectedId)) nextSelected.delete(selectedId);
    }
    if (selection && !nextSelected.has(selection)) {
      selection = nextSelected.size > 0 ? [...nextSelected].at(-1)! : null;
    }
    if (nextSelected.size === 0) selection = null;

    const selectionChanged =
      prevPrimary !== selection || !selectionSetsEqual(prevSelected, nextSelected);
    selectedIds = nextSelected;

    if (selectionChanged) emitSelection();
    if (hadSub) {
      emit({ type: 'sub-selection', entityId: selection, nodeUuid: null });
    }
  }

  function setSelection(id: string | null): void {
    setEntitySelection(id, 'replace');
  }

  function setSubSelection(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid) ?? '';
    const prev = subSelection;
    subSelection = { entityId, nodeUuid, nodeName };
    const prevPrimary = selection;
    const prevSelected = new Set(selectedIds);
    selection = entityId;
    selectedIds = new Set([entityId]);
    const selectionChanged =
      prevPrimary !== selection || !selectionSetsEqual(prevSelected, selectedIds);
    if (selectionChanged) emitSelection();
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

  function findGlbNodeUuid(tree: GlbNodeRef, nodeName: string): string | null {
    if (tree.name === nodeName) return tree.uuid;
    for (const child of tree.children) {
      const uuid = findGlbNodeUuid(child, nodeName);
      if (uuid) return uuid;
    }
    return null;
  }

  function setGlbTree(entityId: string, tree: GlbNodeRef | null): void {
    if (tree) {
      glbTreesByEntityId.set(entityId, tree);
      if (subSelection && subSelection.entityId === entityId && subSelection.nodeName) {
        const newUuid = findGlbNodeUuid(tree, subSelection.nodeName);
        if (newUuid && subSelection.nodeUuid !== newUuid) {
          subSelection.nodeUuid = newUuid;
          emit({ type: 'sub-selection', entityId, nodeUuid: newUuid });
        }
      }
    } else {
      glbTreesByEntityId.delete(entityId);
    }
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
    const entity = locate(entityId)?.entity;
    if (entity) entity.glbNodeTransforms = [];
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
    const transformCopy = cloneTransform(transform);
    glbNodeOverrides.set(glbOverrideKey(entityId, nodeName), transformCopy);
    const entity = locate(entityId)?.entity;
    if (entity) {
      const existing = entity.glbNodeTransforms.find(
        (entry) => entry.nodeName === nodeName,
      );
      if (existing) {
        existing.transform = cloneTransform(transformCopy);
      } else {
        entity.glbNodeTransforms.push({
          nodeName,
          transform: cloneTransform(transformCopy),
          components: [],
        });
      }
    }
    markDirty();
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function setNodeOverrideComponents(
    entityId: string,
    nodeName: string,
    components: PrefabComponent[],
  ): void {
    const entity = locate(entityId)?.entity;
    if (!entity) return;
    const before = entity.glbNodeTransforms.find(
      (entry) => entry.nodeName === nodeName,
    )?.components ?? [];
    const beforeCopy = structuredClone(before);
    const nextCopy = structuredClone(components);
    history.execute({
      label: `Edit node ${nodeName} components`,
      do() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        const override = target.glbNodeTransforms.find(
          (entry) => entry.nodeName === nodeName,
        );
        if (!override) {
          target.glbNodeTransforms.push({
            nodeName,
            components: structuredClone(nextCopy),
          });
        } else {
          override.components = structuredClone(nextCopy);
        }
        markDirty();
        emit({ type: 'entity', entityId });
      },
      undo() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        const override = target.glbNodeTransforms.find(
          (entry) => entry.nodeName === nodeName,
        );
        if (override) {
          override.components = structuredClone(beforeCopy);
          if (override.components.length === 0 && !override.transform) {
            target.glbNodeTransforms = target.glbNodeTransforms.filter((o) => o.nodeName !== nodeName);
          }
        }
        emit({ type: 'entity', entityId });
      },
    });
  }

  function getNodeOverrideComponents(
    entityId: string,
    nodeName: string,
  ): PrefabComponent[] {
    const entity = locate(entityId)?.entity;
    if (!entity) return [];
    const override = entity.glbNodeTransforms.find(
      (entry) => entry.nodeName === nodeName,
    );
    return override ? override.components : [];
  }

  function rebuildGlbOverridesFromState(): void {
    glbNodeOverrides.clear();
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const override of entity.glbNodeTransforms) {
          if (!override.transform) continue;
          glbNodeOverrides.set(
            glbOverrideKey(entity.id, override.nodeName),
            cloneTransform(override.transform),
          );
        }
        visit(entity.children);
      }
    };
    visit(state.roots);
  }

  function notifyGlbNodeTransform(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function hideGlbNode(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    const entity = locate(entityId)?.entity;
    if (!entity || entity.glbNodeHidden.includes(nodeName)) return;

    const clearSubSelection =
      subSelection?.entityId === entityId && subSelection?.nodeUuid === nodeUuid;

    history.execute({
      label: `Delete mesh ${nodeName}`,
      do() {
        const target = locate(entityId)?.entity;
        if (!target || target.glbNodeHidden.includes(nodeName)) return;
        target.glbNodeHidden.push(nodeName);
        markDirty();
        if (clearSubSelection) {
          subSelection = null;
          emit({ type: 'sub-selection', entityId, nodeUuid: null });
        }
        emit({ type: 'glb-visibility', entityId, nodeName });
      },
      undo() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        target.glbNodeHidden = target.glbNodeHidden.filter((n) => n !== nodeName);
        emit({ type: 'glb-visibility', entityId, nodeName });
      },
    });
  }

  function showGlbNode(entityId: string, nodeName: string): void {
    const entity = locate(entityId)?.entity;
    if (!entity || !entity.glbNodeHidden.includes(nodeName)) return;
    history.execute({
      label: `Restore mesh ${nodeName}`,
      do() {
        const target = locate(entityId)?.entity;
        if (!target) return;
        target.glbNodeHidden = target.glbNodeHidden.filter((n) => n !== nodeName);
        markDirty();
        emit({ type: 'glb-visibility', entityId, nodeName });
      },
      undo() {
        const target = locate(entityId)?.entity;
        if (!target || target.glbNodeHidden.includes(nodeName)) return;
        target.glbNodeHidden.push(nodeName);
        emit({ type: 'glb-visibility', entityId, nodeName });
      },
    });
  }

  function isGlbNodeHidden(entityId: string, nodeName: string): boolean {
    return locate(entityId)?.entity.glbNodeHidden.includes(nodeName) ?? false;
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
        removeIdsFromSelection([entity.id]);
        emit({ type: 'structure' });
      },
    });
    setSelection(entity.id);
    return entity.id;
  }

  function deleteEntity(id: string): void {
    deleteEntities([id]);
  }

  function deleteEntities(ids: string[]): void {
    const unique = [...new Set(ids)].filter((id) => locate(id));
    if (unique.length === 0) return;

    const snapshots = unique.map((id) => {
      const location = locate(id)!;
      return {
        entity: structuredClone(location.entity),
        parentId: location.parent?.id ?? null,
        index: location.index,
      };
    });

    const label =
      unique.length === 1
        ? `Delete ${snapshots[0].entity.name}`
        : `Delete ${unique.length} entities`;

    history.execute({
      label,
      do() {
        for (const id of unique) {
          detachEntity(id);
          clearGlbOverridesForEntity(id);
        }
        removeIdsFromSelection(unique);
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        for (const snapshot of snapshots) {
          insertEntity(snapshot.entity, snapshot.parentId, snapshot.index);
        }
        emit({ type: 'structure' });
      },
    });
  }

  function duplicateEntity(id: string): string | null {
    const results = duplicateEntities([id]);
    return results[0] ?? null;
  }

  function duplicateEntities(ids: string[]): string[] {
    const unique = [...new Set(ids)].filter((id) => locate(id));
    if (unique.length === 0) return [];

    const snapshots = unique.map((id, offset) => {
      const location = locate(id)!;
      const copy = structuredClone(location.entity);
      regenerateIds(copy);
      copy.name = `${copy.name} Copy`;
      copy.position = { ...copy.position, x: copy.position.x + 1 + offset * 0.25 };
      return {
        copy,
        parentId: location.parent?.id ?? null,
        index: location.index + 1,
      };
    });

    const label =
      unique.length === 1
        ? `Duplicate ${locate(unique[0])!.entity.name}`
        : `Duplicate ${unique.length} entities`;

    history.execute({
      label,
      do() {
        for (const snapshot of snapshots) {
          insertEntity(snapshot.copy, snapshot.parentId, snapshot.index);
        }
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        for (const snapshot of snapshots) {
          detachEntity(snapshot.copy.id);
          removeIdsFromSelection([snapshot.copy.id]);
        }
        emit({ type: 'structure' });
      },
    });

    const copyIds = snapshots.map((snapshot) => snapshot.copy.id);
    selection = copyIds[copyIds.length - 1] ?? null;
    selectedIds = new Set(copyIds);
    subSelection = null;
    emitSelection();
    return copyIds;
  }

  function reparentEntity(id: string, newParentId: string | null): void {
    reparentEntities([id], newParentId);
  }

  function reparentEntities(ids: string[], newParentId: string | null): void {
    const validIds = ids.filter((id) => {
      if (id === newParentId) return false;
      if (newParentId && isDescendant(id, newParentId)) return false;
      const location = locate(id);
      if (!location) return false;
      const oldParentId = location.parent?.id ?? null;
      return oldParentId !== newParentId;
    });
    if (validIds.length === 0) return;

    const snapshots = validIds.map((id) => {
      const location = locate(id)!;
      return {
        id,
        parentId: location.parent?.id ?? null,
        index: location.index,
      };
    });

    const label =
      validIds.length === 1
        ? `Move ${locate(validIds[0])!.entity.name}`
        : `Move ${validIds.length} entities`;

    history.execute({
      label,
      do() {
        for (const id of validIds) {
          const detached = detachEntity(id);
          if (detached) insertEntity(detached.entity, newParentId);
        }
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        for (let index = snapshots.length - 1; index >= 0; index -= 1) {
          const snapshot = snapshots[index];
          const detached = detachEntity(snapshot.id);
          if (detached) insertEntity(detached.entity, snapshot.parentId, snapshot.index);
        }
        emit({ type: 'structure' });
      },
    });
  }

  function groupSelectedInEmpty(): string | null {
    pruneSelectedIds();
    const ids = [...selectedIds];
    if (ids.length === 0) return null;

    const parents = ids.map((id) => locate(id)?.parent?.id ?? null);
    const sharedParent = parents.every((parent) => parent === parents[0])
      ? parents[0]
      : null;

    const empty = createEmptyEntity('Empty');
    const entitySnapshots = ids.map((id) => {
      const location = locate(id)!;
      return {
        id,
        parentId: location.parent?.id ?? null,
        index: location.index,
      };
    });

    history.execute({
      label: `Group ${ids.length} entities`,
      do() {
        insertEntity(empty, sharedParent);
        for (const id of ids) {
          const detached = detachEntity(id);
          if (detached) insertEntity(detached.entity, empty.id);
        }
        markDirty();
        emit({ type: 'structure' });
      },
      undo() {
        for (let index = entitySnapshots.length - 1; index >= 0; index -= 1) {
          const snapshot = entitySnapshots[index];
          const detached = detachEntity(snapshot.id);
          if (detached) insertEntity(detached.entity, snapshot.parentId, snapshot.index);
        }
        detachEntity(empty.id);
        emit({ type: 'structure' });
      },
    });

    setSelection(empty.id);
    return empty.id;
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
    const beforeOverrides = locate(id)?.entity.materialOverrides ?? [];
    const beforeOverridesCopy = structuredClone(beforeOverrides);
    patchEntity(
      id,
      'Edit asset',
      (entity) => {
        const nextAsset = asset ? { ...asset } : null;
        entity.asset = nextAsset;
        if (before?.url !== nextAsset?.url) entity.materialOverrides = [];
      },
      (entity) => {
        entity.asset = before ? { ...before } : null;
        entity.materialOverrides = structuredClone(beforeOverridesCopy);
      },
    );
  }

  function setMaterialOverride(
    id: string,
    material: string,
    override: PrefabMaterialOverride | null,
  ): void {
    const before = locate(id)?.entity.materialOverrides;
    if (!before) return;
    const beforeCopy = structuredClone(before);
    const next = beforeCopy.filter((entry) => entry.material !== material);
    if (override) next.push(structuredClone(override));
    next.sort((a, b) => a.material.localeCompare(b.material));
    if (JSON.stringify(beforeCopy) === JSON.stringify(next)) return;
    patchEntity(
      id,
      `Edit material ${material}`,
      (entity) => {
        entity.materialOverrides = structuredClone(next);
      },
      (entity) => {
        entity.materialOverrides = structuredClone(beforeCopy);
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
    selectedIds = new Set();
    subSelection = null;
    glbTreesByEntityId.clear();
    glbNodeOverrides.clear();
    dirty = false;
    history.clear();
    emit({ type: 'document' });
    emit({ type: 'structure' });
    emit({ type: 'selection', entityId: null, selectedIds: [] });
  }

  function loadDocument(next: EditorDocumentState): void {
    state = next;
    selection = null;
    selectedIds = new Set();
    subSelection = null;
    glbTreesByEntityId.clear();
    rebuildGlbOverridesFromState();
    dirty = false;
    history.clear();
    emit({ type: 'document' });
    emit({ type: 'structure' });
    emit({ type: 'selection', entityId: null, selectedIds: [] });
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
    getSelectedIds: () => [...selectedIds],
    isEntitySelected: (id: string) => selectedIds.has(id),
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
    getGlbHiddenNodes: (entityId: string) =>
      locate(entityId)?.entity.glbNodeHidden.slice() ?? [],
    isGlbNodeHidden,
    getSelectedEntity: () => (selection ? locate(selection)?.entity ?? null : null),
    isDirty: () => dirty,
    markSaved: () => {
      dirty = false;
    },
    locate,
    setSelection,
    setEntitySelection,
    clearSelection,
    setSubSelection,
    setGlbTree,
    clearGlbTrees,
    notifyGlbNodeTransform,
    hideGlbNode,
    showGlbNode,
    addEntity,
    deleteEntity,
    deleteEntities,
    duplicateEntity,
    duplicateEntities,
    reparentEntity,
    reparentEntities,
    groupSelectedInEmpty,
    renameEntity,
    setVisible,
    setPrimitive,
    setAsset,
    setMaterialOverride,
    setComponents,
    setNodeOverrideComponents,
    getNodeOverrideComponents,
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
