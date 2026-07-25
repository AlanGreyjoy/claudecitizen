import type { EntitySelectionMode } from './document-types';

export function applyEntitySelectionMode(
  mode: EntitySelectionMode,
  id: string,
  currentSelection: string | null,
  currentSelected: Set<string>,
  rangeAnchorId?: string,
  visibleOrder?: readonly string[],
): { selection: string | null; selectedIds: Set<string> } {
  if (mode === 'replace') {
    return { selection: id, selectedIds: new Set([id]) };
  }

  const nextSelected = new Set(currentSelected);
  let nextSelection = currentSelection;

  if (mode === 'toggle') {
    if (nextSelected.has(id)) {
      nextSelected.delete(id);
      if (currentSelection === id) {
        nextSelection = nextSelected.size > 0 ? [...nextSelected].at(-1)! : null;
      }
    } else {
      nextSelected.add(id);
      nextSelection = id;
    }
    return { selection: nextSelection, selectedIds: nextSelected };
  }

  const anchor = rangeAnchorId ?? currentSelection;
  if (!anchor || !visibleOrder || visibleOrder.length === 0) {
    return { selection: id, selectedIds: new Set([id]) };
  }
  const anchorIndex = visibleOrder.indexOf(anchor);
  const clickIndex = visibleOrder.indexOf(id);
  if (anchorIndex === -1 || clickIndex === -1) {
    nextSelected.add(id);
  } else {
    const start = Math.min(anchorIndex, clickIndex);
    const end = Math.max(anchorIndex, clickIndex);
    for (let index = start; index <= end; index += 1) {
      nextSelected.add(visibleOrder[index]!);
    }
  }
  return { selection: id, selectedIds: nextSelected };
}

export function pruneEntitySelection(
  selectedIds: Set<string>,
  selection: string | null,
  exists: (id: string) => boolean,
): { selection: string | null; selectedIds: Set<string> } {
  const nextSelected = new Set(selectedIds);
  for (const selectedId of [...nextSelected]) {
    if (!exists(selectedId)) nextSelected.delete(selectedId);
  }
  let nextSelection = selection;
  if (nextSelection && !nextSelected.has(nextSelection)) {
    nextSelection = nextSelected.size > 0 ? [...nextSelected].at(-1)! : null;
  }
  if (nextSelected.size === 0) nextSelection = null;
  return { selection: nextSelection, selectedIds: nextSelected };
}
