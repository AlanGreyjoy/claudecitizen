import { useCallback, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { ENTITY_DND_TYPE, PREFAB_DND_TYPE } from '../../../api';
import type { EditorEntity, EditorStore } from '../../../document';
import { addPrefabInstanceEntity } from '../../../session-helpers';
import {
  collectGlbExpandKeys,
  GLB_NODE_DND_TYPE,
  glbExpandKey,
  idsToReparent,
  parseDraggedEntityIds,
  parseDraggedGlbNode,
  type HierarchyPanelOptions,
} from '../../../panels/hierarchy-logic';
import type { ExpandState } from './types';

export type HierarchyTreeActionsArgs = {
  store: EditorStore;
  setExpand: Dispatch<SetStateAction<ExpandState>>;
  setDropTargetId: Dispatch<SetStateAction<string | null>>;
  clearSubSelectionIfWithin: (entityId: string, collapsedNodeUuid: string) => void;
  clearSubSelectionIfWithinEntity: (entityId: string) => void;
  onExtractGlbNode: HierarchyPanelOptions['onExtractGlbNode'];
};

export function useHierarchyTreeActions(args: HierarchyTreeActionsArgs) {
  const {
    store,
    setExpand,
    setDropTargetId,
    clearSubSelectionIfWithin,
    clearSubSelectionIfWithinEntity,
    onExtractGlbNode,
  } = args;

const expandAll = useCallback((): void => {
  const nextCollapsed = new Set<string>();
  const nextGlbNodes = new Set<string>();
  const walkEntity = (entity: EditorEntity): void => {
    const glbTree = store.getGlbTree(entity.id);
    if (entity.asset && glbTree) {
      collectGlbExpandKeys(entity.id, glbTree, nextGlbNodes);
    }
    for (const child of entity.children) walkEntity(child);
  };
  for (const root of store.getState().roots) walkEntity(root);
  setExpand({
    collapsedEntities: nextCollapsed,
    expandedGlbNodes: nextGlbNodes,
  });
}, [store]);

const collapseAll = useCallback((): void => {
  const sub = store.getSubSelection();
  if (sub?.entityId) {
    store.setEntitySelection(sub.entityId, 'replace');
  }
  const nextCollapsed = new Set<string>();
  const walkEntity = (entity: EditorEntity): void => {
    const glbTree = store.getGlbTree(entity.id);
    if (entity.children.length > 0 || (entity.asset && glbTree)) {
      nextCollapsed.add(entity.id);
    }
    for (const child of entity.children) walkEntity(child);
  };
  for (const root of store.getState().roots) walkEntity(root);
  setExpand({
    collapsedEntities: nextCollapsed,
    expandedGlbNodes: new Set(),
  });
}, [store]);

const toggleEntityCollapsed = useCallback(
  (entityId: string): void => {
    setExpand((prev) => {
      const nextCollapsed = new Set(prev.collapsedEntities);
      if (nextCollapsed.has(entityId)) {
        nextCollapsed.delete(entityId);
      } else {
        nextCollapsed.add(entityId);
        clearSubSelectionIfWithinEntity(entityId);
      }
      return { ...prev, collapsedEntities: nextCollapsed };
    });
  },
  [clearSubSelectionIfWithinEntity],
);

const toggleGlbNodeExpanded = useCallback(
  (entityId: string, nodeName: string, nodeUuid: string): void => {
    const key = glbExpandKey(entityId, nodeName);
    setExpand((prev) => {
      const next = new Set(prev.expandedGlbNodes);
      if (next.has(key)) {
        next.delete(key);
        clearSubSelectionIfWithin(entityId, nodeUuid);
      } else {
        next.add(key);
      }
      return { ...prev, expandedGlbNodes: next };
    });
  },
  [clearSubSelectionIfWithin],
);

const onEntityDrop = useCallback(
  (event: DragEvent, parentId: string): void => {
    setDropTargetId(null);
    const prefabId = event.dataTransfer?.getData(PREFAB_DND_TYPE) ?? '';
    if (prefabId) {
      event.preventDefault();
      event.stopPropagation();
      addPrefabInstanceEntity(store, prefabId, { x: 0, y: 0, z: 0 }, parentId);
      return;
    }
    const draggedGlbNode = parseDraggedGlbNode(
      event.dataTransfer?.getData(GLB_NODE_DND_TYPE) ?? '',
    );
    if (draggedGlbNode && onExtractGlbNode) {
      event.preventDefault();
      event.stopPropagation();
      if (
        onExtractGlbNode(
          draggedGlbNode.entityId,
          draggedGlbNode.nodeUuid,
          parentId,
        )
      ) {
        setExpand((prev) => {
          const nextCollapsed = new Set(prev.collapsedEntities);
          nextCollapsed.delete(parentId);
          return { ...prev, collapsedEntities: nextCollapsed };
        });
      }
      return;
    }
    const draggedIds = parseDraggedEntityIds(
      event.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
    );
    const idsToMove = idsToReparent(draggedIds, store).filter((id) => id !== parentId);
    if (idsToMove.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    store.reparentEntities(idsToMove, parentId);
  },
  [onExtractGlbNode, store],
);

const onTreeDragOver = useCallback(
  (event: DragEvent): void => {
    if (
      event.dataTransfer?.types.includes(ENTITY_DND_TYPE) ||
      event.dataTransfer?.types.includes(PREFAB_DND_TYPE) ||
      (event.dataTransfer?.types.includes(GLB_NODE_DND_TYPE) && onExtractGlbNode)
    ) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  },
  [onExtractGlbNode],
);

const onTreeDrop = useCallback(
  (event: DragEvent): void => {
    const prefabId = event.dataTransfer?.getData(PREFAB_DND_TYPE) ?? '';
    if (prefabId) {
      event.preventDefault();
      addPrefabInstanceEntity(store, prefabId, { x: 0, y: 0, z: 0 }, null);
      return;
    }
    const draggedGlbNode = parseDraggedGlbNode(
      event.dataTransfer?.getData(GLB_NODE_DND_TYPE) ?? '',
    );
    if (draggedGlbNode && onExtractGlbNode) {
      event.preventDefault();
      onExtractGlbNode(draggedGlbNode.entityId, draggedGlbNode.nodeUuid, null);
      return;
    }
    const draggedIds = parseDraggedEntityIds(
      event.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
    );
    const idsToMove = idsToReparent(draggedIds, store);
    if (idsToMove.length === 0) return;
    event.preventDefault();
    store.reparentEntities(idsToMove, null);
  },
  [onExtractGlbNode, store],
);

  return {
    expandAll,
    collapseAll,
    toggleEntityCollapsed,
    toggleGlbNodeExpanded,
    onEntityDrop,
    onTreeDragOver,
    onTreeDrop,
  };
}
