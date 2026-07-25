import type { PrefabComponent } from '../world/prefabs/schema';
import type { EditorStoreCtx } from './document-store-ctx';
import type { EntityTransform, EditorEntity, GlbNodeRef, NodeOverrideComponentsEdit } from './document-types';
import { cloneTransform } from './document-entity-utils';
import {
  findGlbNodeName,
  findGlbNodeUuid,
  glbOverrideKey,
} from './document-glb-tree';

export function attachGlbMethods(ctx: EditorStoreCtx): void {
  function setGlbTree(entityId: string, tree: GlbNodeRef | null): void {
    if (tree) {
      ctx.glbTreesByEntityId.set(entityId, tree);
      if (ctx.subSelection && ctx.subSelection.entityId === entityId && ctx.subSelection.nodeName) {
        const newUuid = findGlbNodeUuid(tree, ctx.subSelection.nodeName);
        if (newUuid && ctx.subSelection.nodeUuid !== newUuid) {
          ctx.subSelection.nodeUuid = newUuid;
          ctx.emit({ type: 'sub-selection', entityId, nodeUuid: newUuid });
        }
      }
    } else {
      ctx.glbTreesByEntityId.delete(entityId);
    }
    ctx.emit({ type: 'glb-tree', entityId });
  }

  function clearGlbTrees(): void {
    if (ctx.glbTreesByEntityId.size === 0) return;
    ctx.glbTreesByEntityId.clear();
    ctx.emit({ type: 'glb-tree', entityId: '' });
  }


  function resolveGlbNodeName(entityId: string, nodeUuid: string): string | null {
    const tree = ctx.glbTreesByEntityId.get(entityId);
    if (!tree) return null;
    return findGlbNodeName(tree, nodeUuid);
  }

  function clearGlbOverridesForEntity(entityId: string): void {
    const prefix = `${entityId}::`;
    for (const key of [...ctx.glbNodeOverrides.keys()]) {
      if (key.startsWith(prefix)) ctx.glbNodeOverrides.delete(key);
    }
    const entity = ctx.locate(entityId)?.entity;
    if (entity) entity.glbNodeTransforms = [];
  }

  function emitGlbTransform(
    entityId: string,
    nodeUuid: string,
    nodeName: string,
  ): void {
    ctx.emit({ type: 'glb-transform', entityId, nodeUuid, nodeName });
  }

  function setGlbOverride(
    entityId: string,
    nodeName: string,
    nodeUuid: string,
    transform: EntityTransform,
  ): void {
    const transformCopy = cloneTransform(transform);
    ctx.glbNodeOverrides.set(glbOverrideKey(entityId, nodeName), transformCopy);
    const entity = ctx.locate(entityId)?.entity;
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
    ctx.markDirty();
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function setNodeOverrideComponentsBatch(
    edits: NodeOverrideComponentsEdit[],
    label = 'Edit node components',
  ): void {
    const unique = new Map<string, NodeOverrideComponentsEdit>();
    for (const edit of edits) {
      if (!ctx.locate(edit.entityId)) continue;
      unique.set(`${edit.entityId}::${edit.nodeName}`, {
        ...edit,
        components: structuredClone(edit.components),
      });
    }
    if (unique.size === 0) return;
    const changes = [...unique.values()].map((edit) => ({
      ...edit,
      before:
        structuredClone(
          ctx.locate(edit.entityId)?.entity.glbNodeTransforms.find(
            (entry) => entry.nodeName === edit.nodeName,
          )?.components ?? [],
        ),
    }));

    const apply = (
      entityId: string,
      nodeName: string,
      components: PrefabComponent[],
    ): void => {
      const target = ctx.locate(entityId)?.entity;
      if (!target) return;
      const override = target.glbNodeTransforms.find(
        (entry) => entry.nodeName === nodeName,
      );
      if (!override) {
        if (components.length > 0) {
          target.glbNodeTransforms.push({
            nodeName,
            components: structuredClone(components),
          });
        }
        return;
      }
      override.components = structuredClone(components);
      if (override.components.length === 0 && !override.transform) {
        target.glbNodeTransforms = target.glbNodeTransforms.filter(
          (entry) => entry.nodeName !== nodeName,
        );
      }
    };

    ctx.history.execute({
      label,
      do() {
        for (const change of changes) {
          apply(change.entityId, change.nodeName, change.components);
        }
        ctx.markDirty();
        ctx.emit({
          type: 'glb-components',
          edits: changes.map((change) => ({
            entityId: change.entityId,
            nodeName: change.nodeName,
          })),
        });
      },
      undo() {
        for (const change of changes) {
          apply(change.entityId, change.nodeName, change.before);
        }
        ctx.emit({
          type: 'glb-components',
          edits: changes.map((change) => ({
            entityId: change.entityId,
            nodeName: change.nodeName,
          })),
        });
      },
    });
  }

  function setNodeOverrideComponents(
    entityId: string,
    nodeName: string,
    components: PrefabComponent[],
  ): void {
    setNodeOverrideComponentsBatch(
      [{ entityId, nodeName, components }],
      `Edit node ${nodeName} components`,
    );
  }

  function getNodeOverrideComponents(
    entityId: string,
    nodeName: string,
  ): PrefabComponent[] {
    const entity = ctx.locate(entityId)?.entity;
    if (!entity) return [];
    const override = entity.glbNodeTransforms.find(
      (entry) => entry.nodeName === nodeName,
    );
    return override ? override.components : [];
  }

  function rebuildGlbOverridesFromState(): void {
    ctx.glbNodeOverrides.clear();
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const override of entity.glbNodeTransforms) {
          if (!override.transform) continue;
          ctx.glbNodeOverrides.set(
            glbOverrideKey(entity.id, override.nodeName),
            cloneTransform(override.transform),
          );
        }
        visit(entity.children);
      }
    };
    visit(ctx.state.roots);
  }

  function notifyGlbNodeTransform(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    emitGlbTransform(entityId, nodeUuid, nodeName);
  }

  function hideGlbNode(entityId: string, nodeUuid: string): void {
    const nodeName = resolveGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    const entity = ctx.locate(entityId)?.entity;
    if (!entity || entity.glbNodeHidden.includes(nodeName)) return;

    const clearSubSelection =
      ctx.subSelection?.entityId === entityId && ctx.subSelection?.nodeUuid === nodeUuid;

    ctx.history.execute({
      label: `Delete mesh ${nodeName}`,
      do() {
        const target = ctx.locate(entityId)?.entity;
        if (!target || target.glbNodeHidden.includes(nodeName)) return;
        target.glbNodeHidden.push(nodeName);
        ctx.markDirty();
        if (clearSubSelection) {
          // Clear the owning entity too. Del is handled by both the window
          // keydown and the Electron Edit → Delete accelerator; if we only
          // drop ctx.subSelection, the second call deletes the whole entity.
          ctx.subSelection = null;
          ctx.selection = null;
          ctx.selectedIds = new Set();
          ctx.emitSelection();
          ctx.emit({ type: 'sub-selection', entityId, nodeUuid: null });
        }
        ctx.emit({ type: 'glb-visibility', entityId, nodeName });
      },
      undo() {
        const target = ctx.locate(entityId)?.entity;
        if (!target) return;
        target.glbNodeHidden = target.glbNodeHidden.filter((n) => n !== nodeName);
        ctx.emit({ type: 'glb-visibility', entityId, nodeName });
      },
    });
  }

  function showGlbNode(entityId: string, nodeName: string): void {
    const entity = ctx.locate(entityId)?.entity;
    if (!entity || !entity.glbNodeHidden.includes(nodeName)) return;
    ctx.history.execute({
      label: `Restore mesh ${nodeName}`,
      do() {
        const target = ctx.locate(entityId)?.entity;
        if (!target) return;
        target.glbNodeHidden = target.glbNodeHidden.filter((n) => n !== nodeName);
        ctx.markDirty();
        ctx.emit({ type: 'glb-visibility', entityId, nodeName });
      },
      undo() {
        const target = ctx.locate(entityId)?.entity;
        if (!target || target.glbNodeHidden.includes(nodeName)) return;
        target.glbNodeHidden.push(nodeName);
        ctx.emit({ type: 'glb-visibility', entityId, nodeName });
      },
    });
  }

  function isGlbNodeHidden(entityId: string, nodeName: string): boolean {
    return ctx.locate(entityId)?.entity.glbNodeHidden.includes(nodeName) ?? false;
  }
  ctx.setGlbTree = setGlbTree;
  ctx.clearGlbTrees = clearGlbTrees;
  ctx.resolveGlbNodeName = resolveGlbNodeName;
  ctx.clearGlbOverridesForEntity = clearGlbOverridesForEntity;
  ctx.setGlbOverride = setGlbOverride;
  ctx.setNodeOverrideComponentsBatch = setNodeOverrideComponentsBatch;
  ctx.setNodeOverrideComponents = setNodeOverrideComponents;
  ctx.getNodeOverrideComponents = getNodeOverrideComponents;
  ctx.rebuildGlbOverridesFromState = rebuildGlbOverridesFromState;
  ctx.notifyGlbNodeTransform = notifyGlbNodeTransform;
  ctx.hideGlbNode = hideGlbNode;
  ctx.showGlbNode = showGlbNode;
  ctx.isGlbNodeHidden = isGlbNodeHidden;
}
