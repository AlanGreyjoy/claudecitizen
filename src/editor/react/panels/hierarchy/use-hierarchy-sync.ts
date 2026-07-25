import {
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { GlbNodeColliderTarget } from '../../../component-actions';
import type { EditorStore } from '../../../document';
import {
  findGlbNodeByName,
  glbSelectionKey,
  glbTarget,
} from '../../../panels/hierarchy-logic';

export type HierarchySyncArgs = {
  store: EditorStore;
  setSearchText: Dispatch<SetStateAction<string>>;
  setSelectedGlbNodes: Dispatch<SetStateAction<Map<string, GlbNodeColliderTarget>>>;
  setComponentFilter: Dispatch<SetStateAction<string>>;
  selectionFromHierarchyRef: MutableRefObject<boolean>;
  glbRangeAnchorKeyRef: MutableRefObject<string | null>;
  prevScrollSelectionKeyRef: MutableRefObject<string | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  ensureGlbExpanded: (entityId: string, nodeUuid?: string | null) => void;
  ensureEntityAncestorsExpanded: (entityId: string) => void;
  componentFilter: string;
  usedTypesKey: string;
  scrollSelectionKey: string;
};

export function useHierarchySync(args: HierarchySyncArgs): void {
  const {
    store,
    setSearchText,
    setSelectedGlbNodes,
    setComponentFilter,
    selectionFromHierarchyRef,
    glbRangeAnchorKeyRef,
    prevScrollSelectionKeyRef,
    bodyRef,
    ensureGlbExpanded,
    ensureEntityAncestorsExpanded,
    componentFilter,
    usedTypesKey,
    scrollSelectionKey,
  } = args;

// Sync GLB multi-select + expand ancestors from store events (viewport / remaps).
useEffect(() => {
  return store.subscribe((event) => {
    if (
      event.type !== 'structure' &&
      event.type !== 'document' &&
      event.type !== 'selection' &&
      event.type !== 'sub-selection' &&
      event.type !== 'glb-tree' &&
      event.type !== 'glb-visibility' &&
      event.type !== 'glb-components' &&
      event.type !== 'entity'
    ) {
      return;
    }

    if (
      (event.type === 'selection' || event.type === 'sub-selection') &&
      event.entityId &&
      !selectionFromHierarchyRef.current
    ) {
      // Viewport pick: drop the hierarchy search so the selected item is visible in context.
      setSearchText((prev) => (prev ? '' : prev));
    }

    if (event.type === 'sub-selection') {
      const fromHierarchy = selectionFromHierarchyRef.current;
      const entityId = event.entityId;
      const nodeUuid = event.nodeUuid;
      setSelectedGlbNodes((prev) => {
        if (!entityId || !nodeUuid) {
          glbRangeAnchorKeyRef.current = null;
          return new Map();
        }
        const nodeName = store.getGlbNodeName(entityId, nodeUuid);
        if (!nodeName) return prev;

        const matching = [...prev.entries()].find(
          ([, target]) =>
            target.entityId === entityId && target.nodeName === nodeName,
        );
        if (matching && matching[1].nodeUuid !== nodeUuid) {
          const [oldKey] = matching;
          const next = new Map(prev);
          next.delete(oldKey);
          const nextKey = glbSelectionKey(entityId, nodeUuid);
          next.set(nextKey, { entityId, nodeUuid, nodeName });
          if (glbRangeAnchorKeyRef.current === oldKey) {
            glbRangeAnchorKeyRef.current = nextKey;
          }
          return next;
        }
        if (fromHierarchy) return prev;
        const key = glbSelectionKey(entityId, nodeUuid);
        glbRangeAnchorKeyRef.current = key;
        return new Map([[key, { entityId, nodeUuid, nodeName }]]);
      });
    } else if (event.type === 'glb-tree') {
      const entityId = event.entityId;
      setSelectedGlbNodes((prev) => {
        const tree = store.getGlbTree(entityId);
        if (!tree) return prev;
        let changed = false;
        const next = new Map(prev);
        for (const [oldKey, target] of [...next.entries()]) {
          if (target.entityId !== entityId) continue;
          const node = findGlbNodeByName(tree, target.nodeName);
          if (!node) {
            next.delete(oldKey);
            changed = true;
            continue;
          }
          const nextKey = glbSelectionKey(entityId, node.uuid);
          if (nextKey === oldKey) continue;
          next.delete(oldKey);
          next.set(nextKey, glbTarget(entityId, node));
          if (glbRangeAnchorKeyRef.current === oldKey) {
            glbRangeAnchorKeyRef.current = nextKey;
          }
          changed = true;
        }
        return changed ? next : prev;
      });
    }

    if (event.type === 'sub-selection' && event.entityId && event.nodeUuid) {
      ensureGlbExpanded(event.entityId, event.nodeUuid);
    } else if (event.type === 'selection' && event.entityId) {
      ensureEntityAncestorsExpanded(event.entityId);
    }
  });
}, [ensureEntityAncestorsExpanded, ensureGlbExpanded, store]);

// Initial expand / GLB sync
useEffect(() => {
  const initialSub = store.getSubSelection();
  if (initialSub?.entityId && initialSub.nodeUuid) {
    const nodeName = store.getGlbNodeName(initialSub.entityId, initialSub.nodeUuid);
    if (nodeName) {
      const key = glbSelectionKey(initialSub.entityId, initialSub.nodeUuid);
      setSelectedGlbNodes(
        new Map([
          [
            key,
            {
              entityId: initialSub.entityId,
              nodeUuid: initialSub.nodeUuid,
              nodeName,
            },
          ],
        ]),
      );
      glbRangeAnchorKeyRef.current = key;
    }
    ensureGlbExpanded(initialSub.entityId, initialSub.nodeUuid);
  } else {
    const initialSelection = store.getSelection();
    if (initialSelection) ensureEntityAncestorsExpanded(initialSelection);
  }
}, [store, ensureGlbExpanded, ensureEntityAncestorsExpanded]);

  // Reset invalid component filter when types change
  useEffect(() => {
    const types = usedTypesKey.length > 0 ? usedTypesKey.split('\0') : [];
    if (componentFilter && !types.includes(componentFilter)) {
      setComponentFilter('');
    }
  }, [componentFilter, usedTypesKey]);

  useLayoutEffect(() => {
    if (prevScrollSelectionKeyRef.current === scrollSelectionKey) return;
    prevScrollSelectionKeyRef.current = scrollSelectionKey;
    bodyRef.current
      ?.querySelector<HTMLElement>('.ed-tree-row.is-selected')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [scrollSelectionKey]);
}
