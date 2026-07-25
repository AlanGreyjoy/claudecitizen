import {
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { GlbNodeColliderTarget } from '../../component-actions';
import type { EditorStore } from '../../document';
import {
  collectUsedComponentTypes,
  type HierarchyPanelOptions,
} from '../../panels/hierarchy-logic';
import { useEditorStore } from '../hooks';
import { HierarchyPanelView } from './hierarchy/HierarchyPanelView';
import { STORE_EVENTS, type ExpandState, type TreeCtx } from './hierarchy/types';
import { useHierarchyMenus } from './hierarchy/use-hierarchy-menus';
import { useHierarchySelection } from './hierarchy/use-hierarchy-selection';
import { useHierarchySync } from './hierarchy/use-hierarchy-sync';
import { useHierarchyTreeActions } from './hierarchy/use-hierarchy-tree-actions';

export type { HierarchyPanelOptions };

export type HierarchyPanelProps = HierarchyPanelOptions & {
  store: EditorStore;
};

/**
 * Hierarchy outliner panel. Mount inside a host with class `ed-hierarchy`
 * (shell layout owns that grid cell).
 */
export function HierarchyPanel({
  store,
  getGlbNodePrefabPosition,
  getGlbNodeBounds,
  onDuplicateGlbNode,
  onExtractGlbNode,
  onPrefabLibraryChanged,
}: HierarchyPanelProps): ReactElement {
  useEditorStore(store, STORE_EVENTS);

  const [searchText, setSearchText] = useState('');
  const searchQuery = searchText.toLowerCase().trim();
  const [componentFilter, setComponentFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [expand, setExpand] = useState<ExpandState>(() => ({
    collapsedEntities: new Set(),
    expandedGlbNodes: new Set(),
  }));
  const [selectedGlbNodes, setSelectedGlbNodes] = useState(
    () => new Map<string, GlbNodeColliderTarget>(),
  );
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rangeAnchorIdRef = useRef<string | null>(null);
  const glbRangeAnchorKeyRef = useRef<string | null>(null);
  /** True while hierarchy UI is driving selection (skip viewport-only side effects). */
  const selectionFromHierarchyRef = useRef(false);
  const selectedGlbNodesRef = useRef(selectedGlbNodes);
  selectedGlbNodesRef.current = selectedGlbNodes;
  const prevScrollSelectionKeyRef = useRef<string | null>(null);

  const visibleEntityIdsRef = useRef<string[]>([]);
  const visibleGlbNodesRef = useRef<GlbNodeColliderTarget[]>([]);
  visibleEntityIdsRef.current = [];
  visibleGlbNodesRef.current = [];

  const {
    ensureEntityAncestorsExpanded,
    ensureGlbExpanded,
    clearSubSelectionIfWithin,
    clearSubSelectionIfWithinEntity,
    autoExpandForFilters,
    handleGlbNodeClick,
    prepareGlbContextSelection,
    handleEntityClick,
    beginRename,
    addEmptyTo,
    addBoxTo,
    spawnPositionForEntity,
    filterByItemName,
    createPrefab,
  } = useHierarchySelection({
    store,
    expand,
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
    bumpLocal: () => {
      bump();
    },
    getGlbNodePrefabPosition,
    onPrefabLibraryChanged,
  });

  const { entityMenuEntries, glbMenuEntries } = useHierarchyMenus({
    store,
    addEmptyTo,
    addBoxTo,
    beginRename,
    createPrefab,
    filterByItemName,
    spawnPositionForEntity,
    getGlbNodePrefabPosition,
    getGlbNodeBounds,
    onDuplicateGlbNode,
    onExtractGlbNode,
  });

  const {
    expandAll,
    collapseAll,
    toggleEntityCollapsed,
    toggleGlbNodeExpanded,
    onEntityDrop,
    onTreeDragOver,
    onTreeDrop,
  } = useHierarchyTreeActions({
    store,
    setExpand,
    setDropTargetId,
    clearSubSelectionIfWithin,
    clearSubSelectionIfWithinEntity,
    onExtractGlbNode,
  });

  const usedTypes = collectUsedComponentTypes(store.getState().roots);
  const usedTypesKey = usedTypes.join('\0');
  const activeFilter =
    componentFilter && usedTypes.includes(componentFilter) ? componentFilter : '';

  const subSelection = store.getSubSelection();
  const scrollSelectionKey = `${store.getSelection() ?? ''}::${subSelection?.nodeUuid ?? ''}`;

  useHierarchySync({
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
  });

  const ctx: TreeCtx = {
    store,
    searchQuery,
    componentFilter: activeFilter,
    renaming,
    expand,
    selectedGlbNodes,
    visibleEntityIds: visibleEntityIdsRef.current,
    visibleGlbNodes: visibleGlbNodesRef.current,
    dropTargetId,
    beginRename,
    setRenaming,
    toggleEntityCollapsed,
    toggleGlbNodeExpanded,
    handleEntityClick,
    handleGlbNodeClick,
    prepareGlbContextSelection,
    entityMenuEntries,
    glbMenuEntries,
    onEntityDrop,
    onTreeDrop,
    onTreeDragOver,
    setDropTargetId,
    canAcceptGlbDrop: Boolean(onExtractGlbNode),
    setRangeAnchorId: (entityId) => {
      rangeAnchorIdRef.current = entityId;
    },
  };

  return (
    <HierarchyPanelView
      store={store}
      ctx={ctx}
      searchText={searchText}
      searchQuery={searchQuery}
      activeFilter={activeFilter}
      usedTypes={usedTypes}
      searchInputRef={searchInputRef}
      bodyRef={bodyRef}
      setSearchText={setSearchText}
      setComponentFilter={setComponentFilter}
      autoExpandForFilters={autoExpandForFilters}
      expandAll={expandAll}
      collapseAll={collapseAll}
      addEmptyTo={addEmptyTo}
      addBoxTo={addBoxTo}
    />
  );
}
