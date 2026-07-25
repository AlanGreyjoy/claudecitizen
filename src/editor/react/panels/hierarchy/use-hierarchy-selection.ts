import {
  useCallback,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { GlbNodeColliderTarget } from '../../../component-actions';
import { createEmptyEntity, type EditorEntity, type EditorStore, type GlbNodeRef } from '../../../document';
import { createPrefabFromSelection } from '../../../create-prefab-from-selection';
import type { PrefabKind } from '../../../../world/prefabs/schema';
import {
  collectExpandKeys,
  entitySubtreeHasMatch,
  findEntityAncestorIds,
  filterBaseName,
  glbExpandKey,
  glbNodeIsAncestorOrSelf,
  glbSelectionKey,
  glbSubtreeHasDescendantMatch,
  glbSubtreeHasMatch,
  resolveGlbClickSelection,
  type HierarchyPanelOptions,
} from '../../../panels/hierarchy-logic';
import type { Vec3 } from '../../../../types';
import type { ExpandState } from './types';

export type HierarchySelectionArgs = {
  store: EditorStore;
  expand: ExpandState;
  setExpand: Dispatch<SetStateAction<ExpandState>>;
  setSelectedGlbNodes: Dispatch<SetStateAction<Map<string, GlbNodeColliderTarget>>>;
  setSearchText: Dispatch<SetStateAction<string>>;
  setComponentFilter: Dispatch<SetStateAction<string>>;
  setRenaming: Dispatch<SetStateAction<string | null>>;
  selectionFromHierarchyRef: MutableRefObject<boolean>;
  selectedGlbNodesRef: MutableRefObject<Map<string, GlbNodeColliderTarget>>;
  glbRangeAnchorKeyRef: MutableRefObject<string | null>;
  rangeAnchorIdRef: MutableRefObject<string | null>;
  visibleEntityIdsRef: MutableRefObject<string[]>;
  visibleGlbNodesRef: MutableRefObject<GlbNodeColliderTarget[]>;
  bumpLocal: () => void;
  getGlbNodePrefabPosition: HierarchyPanelOptions['getGlbNodePrefabPosition'];
  onPrefabLibraryChanged: HierarchyPanelOptions['onPrefabLibraryChanged'];
};

export function useHierarchySelection(args: HierarchySelectionArgs) {
  const {
    store,
    setExpand,
    setSelectedGlbNodes,
    setSearchText,
    setComponentFilter,
    setRenaming,
    selectionFromHierarchyRef,
    selectedGlbNodesRef,
    glbRangeAnchorKeyRef,
    rangeAnchorIdRef,
    visibleEntityIdsRef,
    visibleGlbNodesRef,
    bumpLocal,
    getGlbNodePrefabPosition,
    onPrefabLibraryChanged,
  } = args;

const ensureEntityAncestorsExpanded = useCallback((entityId: string): void => {
  const ancestors = findEntityAncestorIds(store.getState().roots, entityId);
  if (!ancestors || ancestors.length === 0) return;
  setExpand((prev) => {
    let changed = false;
    const nextCollapsed = new Set(prev.collapsedEntities);
    for (const ancestorId of ancestors) {
      if (nextCollapsed.delete(ancestorId)) changed = true;
    }
    return changed
      ? { ...prev, collapsedEntities: nextCollapsed }
      : prev;
  });
}, [store]);

const ensureGlbExpanded = useCallback(
  (entityId: string, nodeUuid?: string | null): void => {
    ensureEntityAncestorsExpanded(entityId);
    setExpand((prev) => {
      const nextCollapsed = new Set(prev.collapsedEntities);
      nextCollapsed.delete(entityId);
      const nextGlbNodes = new Set(prev.expandedGlbNodes);
      const tree = store.getGlbTree(entityId);
      if (tree && nodeUuid) {
        const path = collectExpandKeys(entityId, tree, nodeUuid);
        if (path) {
          for (const key of path) nextGlbNodes.add(key);
          const nodeName = store.getGlbNodeName(entityId, nodeUuid);
          if (nodeName) nextGlbNodes.add(glbExpandKey(entityId, nodeName));
        }
      }
      return {
        collapsedEntities: nextCollapsed,
        expandedGlbNodes: nextGlbNodes,
      };
    });
  },
  [ensureEntityAncestorsExpanded, store],
);

const clearSubSelectionIfWithin = useCallback(
  (entityId: string, collapsedNodeUuid: string): void => {
    const sub = store.getSubSelection();
    if (!sub || sub.entityId !== entityId || !sub.nodeUuid) return;
    const tree = store.getGlbTree(entityId);
    if (!tree) return;
    if (glbNodeIsAncestorOrSelf(tree, collapsedNodeUuid, sub.nodeUuid)) {
      store.setEntitySelection(entityId, 'replace');
    }
  },
  [store],
);

const clearSubSelectionIfWithinEntity = useCallback(
  (entityId: string): void => {
    const sub = store.getSubSelection();
    if (sub?.entityId === entityId) {
      store.setEntitySelection(entityId, 'replace');
    }
  },
  [store],
);

const autoExpandForFilters = useCallback(
  (query: string, filter: string): void => {
    if (!query && !filter) return;
    setExpand((prev) => {
      const nextCollapsed = new Set(prev.collapsedEntities);
      const nextGlbNodes = new Set(prev.expandedGlbNodes);

      const walkEntity = (entity: EditorEntity): void => {
        const glbTree = store.getGlbTree(entity.id);
        if (
          entity.children.some((child) =>
            entitySubtreeHasMatch(store, child, query, filter),
          ) ||
          (glbTree && glbSubtreeHasMatch(store, entity.id, glbTree, query, filter))
        ) {
          nextCollapsed.delete(entity.id);
        }
        if (glbTree) {
          const expandGlb = (node: GlbNodeRef): void => {
            if (glbSubtreeHasDescendantMatch(store, entity.id, node, query, filter)) {
              nextGlbNodes.add(glbExpandKey(entity.id, node.name));
            }
            for (const child of node.children) expandGlb(child);
          };
          expandGlb(glbTree);
        }
        for (const child of entity.children) walkEntity(child);
      };
      for (const root of store.getState().roots) walkEntity(root);

      return {
        collapsedEntities: nextCollapsed,
        expandedGlbNodes: nextGlbNodes,
      };
    });
  },
  [store],
);

const setPrimaryGlbSelection = useCallback(
  (target: GlbNodeColliderTarget | null, fallbackEntityId?: string): boolean => {
    const current = store.getSubSelection();
    if (
      target &&
      current?.entityId === target.entityId &&
      current.nodeUuid === target.nodeUuid
    ) {
      return false;
    }
    if (!target && !current) return false;
    selectionFromHierarchyRef.current = true;
    try {
      if (target) {
        ensureGlbExpanded(target.entityId, target.nodeUuid);
        store.setSubSelection(target.entityId, target.nodeUuid);
      } else {
        store.setEntitySelection(fallbackEntityId ?? null, 'replace');
      }
    } finally {
      selectionFromHierarchyRef.current = false;
    }
    return true;
  },
  [ensureGlbExpanded, store],
);

const handleGlbNodeClick = useCallback(
  (event: MouseEvent, target: GlbNodeColliderTarget): void => {
    const resolved = resolveGlbClickSelection(
      event,
      target,
      selectedGlbNodesRef.current,
      glbRangeAnchorKeyRef.current,
      visibleGlbNodesRef.current,
      store.getSubSelection(),
    );
    glbRangeAnchorKeyRef.current = resolved.nextAnchorKey;
    setSelectedGlbNodes(resolved.nextSelection);
    let primaryChanged = false;
    if (resolved.updatePrimary) {
      primaryChanged = setPrimaryGlbSelection(
        resolved.primaryTarget,
        resolved.primaryFallbackEntityId,
      );
    }
    if (!primaryChanged) bumpLocal();
  },
  [setPrimaryGlbSelection, store],
);

const prepareGlbContextSelection = useCallback(
  (target: GlbNodeColliderTarget): GlbNodeColliderTarget[] => {
    const key = glbSelectionKey(target.entityId, target.nodeUuid);
    let next = selectedGlbNodesRef.current;
    const changedSet = !next.has(key);
    if (changedSet) {
      next = new Map([[key, target]]);
      glbRangeAnchorKeyRef.current = key;
      setSelectedGlbNodes(next);
    }
    const primaryChanged = setPrimaryGlbSelection(target);
    if (changedSet && !primaryChanged) bumpLocal();
    return [...next.values()];
  },
  [setPrimaryGlbSelection],
);

const handleEntityClick = useCallback(
  (event: MouseEvent, entityId: string): void => {
    setSelectedGlbNodes(new Map());
    glbRangeAnchorKeyRef.current = null;
    selectionFromHierarchyRef.current = true;
    try {
      if (event.shiftKey) {
        store.setEntitySelection(
          entityId,
          'range',
          rangeAnchorIdRef.current ?? undefined,
          visibleEntityIdsRef.current,
        );
      } else if (event.ctrlKey || event.metaKey) {
        store.setEntitySelection(entityId, 'toggle');
        rangeAnchorIdRef.current = entityId;
        return;
      } else {
        store.setEntitySelection(entityId, 'replace');
      }
      rangeAnchorIdRef.current = entityId;
    } finally {
      selectionFromHierarchyRef.current = false;
    }
  },
  [store],
);

const beginRename = useCallback((entityId: string): void => {
  setRenaming(entityId);
}, []);

const addEmptyTo = useCallback(
  (parentId: string | null): void => {
    const entity = createEmptyEntity('Empty');
    store.addEntity(entity, parentId);
    beginRename(entity.id);
  },
  [beginRename, store],
);

const addBoxTo = useCallback(
  (parentId: string | null): void => {
    const entity = createEmptyEntity('Box');
    entity.primitive = { shape: 'box', size: { x: 2, y: 2, z: 2 }, color: '#4c5663' };
    if (parentId === null) entity.position = { x: 0, y: 1, z: 0 };
    store.addEntity(entity, parentId);
  },
  [store],
);

const spawnPositionForEntity = useCallback(
  (entityId: string): (() => Vec3 | null) | undefined => {
    const sub = store.getSubSelection();
    if (!sub || sub.entityId !== entityId || !getGlbNodePrefabPosition) {
      return undefined;
    }
    return () => getGlbNodePrefabPosition(sub.entityId, sub.nodeUuid);
  },
  [getGlbNodePrefabPosition, store],
);

const filterByItemName = useCallback(
  (name: string): void => {
    const baseName = filterBaseName(name);
    setSearchText(baseName);
    setComponentFilter('');
    autoExpandForFilters(baseName.toLowerCase().trim(), '');
  },
  [autoExpandForFilters],
);

const createPrefab = useCallback(
  async (entityId: string, kind: PrefabKind): Promise<void> => {
    const id = await createPrefabFromSelection(store, entityId, kind);
    if (id) onPrefabLibraryChanged?.();
  },
  [onPrefabLibraryChanged, store],
);

  return {
    ensureEntityAncestorsExpanded,
    ensureGlbExpanded,
    clearSubSelectionIfWithin,
    clearSubSelectionIfWithinEntity,
    autoExpandForFilters,
    setPrimaryGlbSelection,
    handleGlbNodeClick,
    prepareGlbContextSelection,
    handleEntityClick,
    beginRename,
    addEmptyTo,
    addBoxTo,
    spawnPositionForEntity,
    filterByItemName,
    createPrefab,
  };
}
