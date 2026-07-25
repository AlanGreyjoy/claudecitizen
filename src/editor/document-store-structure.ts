import type { PrefabKind } from '../world/prefabs/schema';
import type { EditorStoreCtx } from './document-store-ctx';
import type { EditorEntity, EntityTransform } from './document-types';
import {
  cloneTransform,
  cloneVec,
  createEmptyEntity,
  regenerateIds,
} from './document-entity-utils';
import {
  collectGlbNodeNames,
  findGlbNodeRef,
  glbOverrideKey,
} from './document-glb-tree';

export function attachStructureMethods(ctx: EditorStoreCtx): void {
  function insertEntity(entity: EditorEntity, parentId: string | null, index?: number): void {
    const list = parentId === null ? ctx.state.roots : ctx.locate(parentId)?.entity.children;
    if (!list) return;
    list.splice(index ?? list.length, 0, entity);
  }

  function detachEntity(id: string): { entity: EditorEntity; parentId: string | null; index: number } | null {
    const location = ctx.locate(id);
    if (!location) return null;
    location.siblings.splice(location.index, 1);
    return {
      entity: location.entity,
      parentId: location.parent?.id ?? null,
      index: location.index,
    };
  }

  function addEntity(entity: EditorEntity, parentId: string | null = null): string {
    ctx.history.execute({
      label: `Add ${entity.name}`,
      do() {
        insertEntity(entity, parentId);
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        detachEntity(entity.id);
        ctx.removeIdsFromSelection([entity.id]);
        ctx.emit({ type: 'structure' });
      },
    });
    ctx.setSelection(entity.id);
    return entity.id;
  }

  function deleteEntity(id: string): void {
    deleteEntities([id]);
  }

  function deleteEntities(ids: string[]): void {
    const unique = [...new Set(ids)].filter((id) => ctx.locate(id));
    if (unique.length === 0) return;

    const snapshots = unique.map((id) => {
      const location = ctx.locate(id)!;
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

    ctx.history.execute({
      label,
      do() {
        for (const id of unique) {
          detachEntity(id);
          ctx.clearGlbOverridesForEntity(id);
        }
        ctx.removeIdsFromSelection(unique);
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        for (const snapshot of snapshots) {
          insertEntity(snapshot.entity, snapshot.parentId, snapshot.index);
        }
        ctx.emit({ type: 'structure' });
      },
    });
  }

  function duplicateEntity(id: string): string | null {
    const results = duplicateEntities([id]);
    return results[0] ?? null;
  }

  function createGlbNodeEntity(
    source: EditorEntity,
    nodeName: string,
    transform: EntityTransform,
    subtreeNodeNames = new Set([nodeName]),
    entityName = `${nodeName} Copy`,
  ): EditorEntity {
    const copy = createEmptyEntity(entityName);
    copy.position = cloneVec(transform.position);
    copy.rotation = cloneVec(transform.rotation);
    copy.scale = cloneVec(transform.scale);
    copy.asset = { ...source.asset!, node: nodeName };
    copy.materialOverrides = structuredClone(source.materialOverrides);
    const rootOverride = source.glbNodeTransforms.find(
      (candidate) => candidate.nodeName === nodeName,
    );
    const sourceComponents =
      rootOverride?.components ??
      (source.asset?.node === nodeName ? source.components : []);
    copy.components = structuredClone(sourceComponents);
    copy.glbNodeTransforms = structuredClone(
      source.glbNodeTransforms.filter(
        (override) =>
          override.nodeName !== nodeName && subtreeNodeNames.has(override.nodeName),
      ),
    );
    return copy;
  }

  function clearGlbOverrideMapForEntityId(entityId: string): void {
    const prefix = `${entityId}::`;
    for (const key of [...ctx.glbNodeOverrides.keys()]) {
      if (key.startsWith(prefix)) ctx.glbNodeOverrides.delete(key);
    }
  }

  function syncGlbOverrideMapForEntity(entity: EditorEntity): void {
    clearGlbOverrideMapForEntityId(entity.id);
    for (const override of entity.glbNodeTransforms) {
      if (!override.transform) continue;
      ctx.glbNodeOverrides.set(
        glbOverrideKey(entity.id, override.nodeName),
        cloneTransform(override.transform),
      );
    }
  }

  function duplicateGlbNode(
    entityId: string,
    nodeName: string,
    transform: EntityTransform,
  ): string | null {
    const source = ctx.locate(entityId)?.entity;
    if (!source?.asset) return null;

    const copy = createGlbNodeEntity(source, nodeName, transform);

    ctx.history.execute({
      label: `Duplicate ${nodeName}`,
      do() {
        insertEntity(copy, entityId);
        syncGlbOverrideMapForEntity(copy);
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        detachEntity(copy.id);
        clearGlbOverrideMapForEntityId(copy.id);
        ctx.removeIdsFromSelection([copy.id]);
        ctx.emit({ type: 'structure' });
      },
    });

    ctx.selection = copy.id;
    ctx.selectedIds = new Set([copy.id]);
    ctx.subSelection = null;
    ctx.emitSelection();
    return copy.id;
  }

  function extractGlbNode(
    entityId: string,
    nodeUuid: string,
    targetParentId: string | null,
    transform: EntityTransform,
  ): string | null {
    const source = ctx.locate(entityId)?.entity;
    const tree = ctx.glbTreesByEntityId.get(entityId);
    const node = tree ? findGlbNodeRef(tree, nodeUuid) : null;
    if (!source?.asset || !node) return null;
    if (targetParentId !== null && !ctx.locate(targetParentId)) return null;

    const subtreeNodeNames = collectGlbNodeNames(node);
    const copy = createGlbNodeEntity(
      source,
      node.name,
      transform,
      subtreeNodeNames,
      node.name,
    );
    const sourceOverridesBefore = structuredClone(source.glbNodeTransforms);
    const hiddenNodesBefore = [...source.glbNodeHidden];

    ctx.history.execute({
      label: `Move ${node.name} out of model`,
      do() {
        const target = ctx.locate(entityId)?.entity;
        if (!target) return;
        target.glbNodeTransforms = target.glbNodeTransforms.filter(
          (override) => !subtreeNodeNames.has(override.nodeName),
        );
        if (!target.glbNodeHidden.includes(node.name)) {
          target.glbNodeHidden.push(node.name);
        }
        syncGlbOverrideMapForEntity(target);
        insertEntity(copy, targetParentId);
        syncGlbOverrideMapForEntity(copy);
        if (ctx.subSelection?.entityId === entityId && ctx.subSelection.nodeUuid === nodeUuid) {
          ctx.subSelection = null;
          ctx.emit({ type: 'sub-selection', entityId, nodeUuid: null });
        }
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        detachEntity(copy.id);
        clearGlbOverrideMapForEntityId(copy.id);
        const target = ctx.locate(entityId)?.entity;
        if (target) {
          target.glbNodeTransforms = structuredClone(sourceOverridesBefore);
          target.glbNodeHidden = [...hiddenNodesBefore];
          syncGlbOverrideMapForEntity(target);
        }
        ctx.removeIdsFromSelection([copy.id]);
        ctx.emit({ type: 'structure' });
      },
    });

    ctx.selection = copy.id;
    ctx.selectedIds = new Set([copy.id]);
    ctx.subSelection = null;
    ctx.emitSelection();
    return copy.id;
  }

  function duplicateEntities(ids: string[]): string[] {
    const unique = [...new Set(ids)].filter((id) => ctx.locate(id));
    if (unique.length === 0) return [];

    const snapshots = unique.map((id) => {
      const location = ctx.locate(id)!;
      const copy = structuredClone(location.entity);
      regenerateIds(copy);
      copy.name = `${copy.name} Copy`;
      return {
        copy,
        parentId: location.parent?.id ?? null,
        index: location.index + 1,
      };
    });

    const label =
      unique.length === 1
        ? `Duplicate ${ctx.locate(unique[0])!.entity.name}`
        : `Duplicate ${unique.length} entities`;

    ctx.history.execute({
      label,
      do() {
        for (const snapshot of snapshots) {
          insertEntity(snapshot.copy, snapshot.parentId, snapshot.index);
        }
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        for (const snapshot of snapshots) {
          detachEntity(snapshot.copy.id);
          ctx.removeIdsFromSelection([snapshot.copy.id]);
        }
        ctx.emit({ type: 'structure' });
      },
    });

    const copyIds = snapshots.map((snapshot) => snapshot.copy.id);
    ctx.selection = copyIds[copyIds.length - 1] ?? null;
    ctx.selectedIds = new Set(copyIds);
    ctx.subSelection = null;
    ctx.emitSelection();
    return copyIds;
  }

  function reparentEntity(id: string, newParentId: string | null): void {
    reparentEntities([id], newParentId);
  }

  function reparentEntities(ids: string[], newParentId: string | null): void {
    const validIds = ids.filter((id) => {
      if (id === newParentId) return false;
      if (newParentId && ctx.isDescendant(id, newParentId)) return false;
      const location = ctx.locate(id);
      if (!location) return false;
      const oldParentId = location.parent?.id ?? null;
      return oldParentId !== newParentId;
    });
    if (validIds.length === 0) return;

    const snapshots = validIds.map((id) => {
      const location = ctx.locate(id)!;
      return {
        id,
        parentId: location.parent?.id ?? null,
        index: location.index,
      };
    });

    const label =
      validIds.length === 1
        ? `Move ${ctx.locate(validIds[0])!.entity.name}`
        : `Move ${validIds.length} entities`;

    ctx.history.execute({
      label,
      do() {
        for (const id of validIds) {
          const detached = detachEntity(id);
          if (detached) insertEntity(detached.entity, newParentId);
        }
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        for (let index = snapshots.length - 1; index >= 0; index -= 1) {
          const snapshot = snapshots[index];
          const detached = detachEntity(snapshot.id);
          if (detached) insertEntity(detached.entity, snapshot.parentId, snapshot.index);
        }
        ctx.emit({ type: 'structure' });
      },
    });
  }

  function groupSelectedInEmpty(): string | null {
    ctx.pruneSelectedIds();
    const ids = [...ctx.selectedIds];
    if (ids.length === 0) return null;

    const parents = ids.map((id) => ctx.locate(id)?.parent?.id ?? null);
    const sharedParent = parents.every((parent) => parent === parents[0])
      ? parents[0]
      : null;

    const empty = createEmptyEntity('Empty');
    const entitySnapshots = ids.map((id) => {
      const location = ctx.locate(id)!;
      return {
        id,
        parentId: location.parent?.id ?? null,
        index: location.index,
      };
    });

    ctx.history.execute({
      label: `Group ${ids.length} entities`,
      do() {
        insertEntity(empty, sharedParent);
        for (const id of ids) {
          const detached = detachEntity(id);
          if (detached) insertEntity(detached.entity, empty.id);
        }
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        for (let index = entitySnapshots.length - 1; index >= 0; index -= 1) {
          const snapshot = entitySnapshots[index];
          const detached = detachEntity(snapshot.id);
          if (detached) insertEntity(detached.entity, snapshot.parentId, snapshot.index);
        }
        detachEntity(empty.id);
        ctx.emit({ type: 'structure' });
      },
    });

    ctx.setSelection(empty.id);
    return empty.id;
  }

  /**
   * Swaps an authored subtree for a single `prefab-instance` GameObject after
   * the subtree has been extracted into a prefab document. The instance keeps
   * the original transform so nothing appears to move.
   */
  function replaceEntityWithPrefabInstance(
    id: string,
    prefabId: string,
    prefabKind: PrefabKind,
  ): string | null {
    const location = ctx.locate(id);
    if (!location) return null;

    const parentId = location.parent?.id ?? null;
    const index = location.index;
    const original = location.entity;
    const instance: EditorEntity = {
      ...createEmptyEntity(original.name),
      position: { ...original.position },
      rotation: { ...original.rotation },
      scale: { ...original.scale },
      components: [{ type: 'prefab-instance', prefabId, prefabKind }],
    };

    ctx.history.execute({
      label: `Create prefab "${prefabId}"`,
      do() {
        detachEntity(id);
        insertEntity(instance, parentId, index);
        ctx.markDirty();
        ctx.emit({ type: 'structure' });
      },
      undo() {
        detachEntity(instance.id);
        insertEntity(original, parentId, index);
        ctx.emit({ type: 'structure' });
      },
    });

    ctx.setSelection(instance.id);
    return instance.id;
  }
  ctx.insertEntity = insertEntity;
  ctx.detachEntity = detachEntity;
  ctx.addEntity = addEntity;
  ctx.deleteEntity = deleteEntity;
  ctx.deleteEntities = deleteEntities;
  ctx.duplicateEntity = duplicateEntity;
  ctx.duplicateGlbNode = duplicateGlbNode;
  ctx.extractGlbNode = extractGlbNode;
  ctx.duplicateEntities = duplicateEntities;
  ctx.reparentEntity = reparentEntity;
  ctx.reparentEntities = reparentEntities;
  ctx.groupSelectedInEmpty = groupSelectedInEmpty;
  ctx.replaceEntityWithPrefabInstance = replaceEntityWithPrefabInstance;
}
