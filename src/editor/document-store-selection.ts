import type { EditorStoreCtx } from './document-store-ctx';
import type { EntitySelectionMode } from './document-types';
import { applyEntitySelectionMode, pruneEntitySelection } from './document-selection-mode';
import { findGlbNodeName } from './document-glb-tree';

export function attachSelectionMethods(ctx: EditorStoreCtx): void {
  function selectionSetsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const id of a) {
      if (!b.has(id)) return false;
    }
    return true;
  }

  function pruneSelectedIds(): void {
    for (const id of [...ctx.selectedIds]) {
      if (!ctx.locate(id)) ctx.selectedIds.delete(id);
    }
    if (ctx.selection && !ctx.selectedIds.has(ctx.selection)) {
      ctx.selection = ctx.selectedIds.size > 0 ? [...ctx.selectedIds].at(-1)! : null;
    }
    if (ctx.selectedIds.size === 0) ctx.selection = null;
  }

  function emitSelection(): void {
    ctx.emit({
      type: 'selection',
      entityId: ctx.selection,
      selectedIds: [...ctx.selectedIds],
    });
  }

  function removeIdsFromSelection(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (ctx.selectedIds.delete(id)) changed = true;
    }
    if (!changed) return;
    if (ctx.selection && !ctx.selectedIds.has(ctx.selection)) {
      ctx.selection = ctx.selectedIds.size > 0 ? [...ctx.selectedIds].at(-1)! : null;
    }
    emitSelection();
  }

  function clearSelection(): void {
    const hadSelection = ctx.selectedIds.size > 0 || ctx.selection !== null;
    const hadSub = ctx.subSelection !== null;
    ctx.selection = null;
    ctx.selectedIds = new Set();
    ctx.subSelection = null;
    if (hadSelection) emitSelection();
    if (hadSub) {
      ctx.emit({ type: 'sub-selection', entityId: null, nodeUuid: null });
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

    const hadSub = ctx.subSelection !== null;
    ctx.subSelection = null;

    const prevPrimary = ctx.selection;
    const prevSelected = new Set(ctx.selectedIds);
    const applied = applyEntitySelectionMode(
      mode,
      id,
      ctx.selection,
      ctx.selectedIds,
      rangeAnchorId,
      visibleOrder,
    );
    const pruned = pruneEntitySelection(applied.selectedIds, applied.selection, (selectedId) =>
      Boolean(ctx.locate(selectedId)),
    );

    const selectionChanged =
      prevPrimary !== pruned.selection || !selectionSetsEqual(prevSelected, pruned.selectedIds);
    ctx.selection = pruned.selection;
    ctx.selectedIds = pruned.selectedIds;

    if (selectionChanged) emitSelection();
    if (hadSub) {
      ctx.emit({ type: 'sub-selection', entityId: ctx.selection, nodeUuid: null });
    }
  }

  function setSelection(id: string | null): void {
    setEntitySelection(id, 'replace');
  }

  function setSubSelection(entityId: string, nodeUuid: string): void {
    const tree = ctx.glbTreesByEntityId.get(entityId);
    const nodeName = (tree ? findGlbNodeName(tree, nodeUuid) : null) ?? '';
    const prev = ctx.subSelection;
    ctx.subSelection = { entityId, nodeUuid, nodeName };
    const prevPrimary = ctx.selection;
    const prevSelected = new Set(ctx.selectedIds);
    ctx.selection = entityId;
    ctx.selectedIds = new Set([entityId]);
    const selectionChanged =
      prevPrimary !== ctx.selection || !selectionSetsEqual(prevSelected, ctx.selectedIds);
    if (selectionChanged) emitSelection();
    if (
      !prev ||
      prev.entityId !== entityId ||
      prev.nodeUuid !== nodeUuid
    ) {
      ctx.emit({ type: 'sub-selection', entityId, nodeUuid });
    }
  }

  ctx.pruneSelectedIds = pruneSelectedIds;
  ctx.emitSelection = emitSelection;
  ctx.removeIdsFromSelection = removeIdsFromSelection;
  ctx.clearSelection = clearSelection;
  ctx.setEntitySelection = setEntitySelection;
  ctx.setSelection = setSelection;
  ctx.setSubSelection = setSubSelection;
}
