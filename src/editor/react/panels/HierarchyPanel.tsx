import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ENTITY_DND_TYPE } from '../../api';
import {
  addColliderShapeMenuEntries,
  addColliderToEntities,
  addColliderToGlbNodes,
  buildEntityComponentsSubmenu,
  buildGlbAuthoringMenu,
  collectComponentTypesOnEntities,
  collectComponentTypesOnGlbNodes,
  removeComponentTypeFromEntities,
  removeComponentTypeFromGlbNodes,
  removeComponentTypeMenuEntries,
  type GlbNodeColliderTarget,
} from '../../component_actions';
import { createEmptyEntity, type EditorEntity, type EditorStore, type GlbNodeRef } from '../../document';
import { showContextMenu, type ContextMenuEntry } from '../../dom';
import {
  collectEntitySubtreeIds,
  collectExpandUuids,
  collectGlbNodeUuids,
  collectUsedComponentTypes,
  componentBadge,
  createMoveToPanel,
  entitySubtreeHasMatch,
  filterBaseName,
  findEntityAncestorIds,
  findGlbNodeByName,
  getAllGlbNodeNames,
  getBoundEntitiesForNode,
  getNodeOverrideComponentBadge,
  GLB_NODE_DND_TYPE,
  glbNodeIsAncestorOrSelf,
  glbSelectionKey,
  glbSubtreeHasDescendantMatch,
  glbSubtreeHasMatch,
  glbTarget,
  idsToReparent,
  isEntityBoundToGlb,
  parseDraggedEntityIds,
  parseDraggedGlbNode,
  resolveGlbClickSelection,
  type HierarchyPanelOptions,
} from '../../panels/hierarchy_logic';
import { getComponentDef } from '../../../world/prefabs/component_registry';
import type { PrefabComponentType } from '../../../world/prefabs/schema';
import type { Vec3 } from '../../../types';
import { UiIcons } from '../../../ui/icons';
import { useEditorStore } from '../hooks';
import { UiIcon } from '../UiIcon';

export type { HierarchyPanelOptions };

const STORE_EVENTS = [
  'structure',
  'document',
  'selection',
  'sub-selection',
  'glb-tree',
  'glb-visibility',
  'glb-components',
  'entity',
] as const;

export type HierarchyPanelProps = HierarchyPanelOptions & {
  store: EditorStore;
};

type ExpandState = {
  collapsedEntities: Set<string>;
  expandedGlbEntities: Set<string>;
  expandedGlbNodes: Set<string>;
};

type TreeCtx = {
  store: EditorStore;
  searchQuery: string;
  componentFilter: string;
  renaming: string | null;
  expand: ExpandState;
  selectedGlbNodes: Map<string, GlbNodeColliderTarget>;
  visibleEntityIds: string[];
  visibleGlbNodes: GlbNodeColliderTarget[];
  dropTargetId: string | null;
  beginRename: (entityId: string) => void;
  setRenaming: (entityId: string | null) => void;
  toggleEntityCollapsed: (entityId: string) => void;
  toggleGlbEntityExpanded: (entityId: string) => void;
  toggleGlbNodeExpanded: (entityId: string, nodeUuid: string) => void;
  handleEntityClick: (event: MouseEvent, entityId: string) => void;
  handleGlbNodeClick: (event: MouseEvent, target: GlbNodeColliderTarget) => void;
  prepareGlbContextSelection: (target: GlbNodeColliderTarget) => GlbNodeColliderTarget[];
  entityMenuEntries: (entity: EditorEntity) => ContextMenuEntry[];
  glbMenuEntries: (
    entityId: string,
    node: GlbNodeRef,
    targets: GlbNodeColliderTarget[],
  ) => ContextMenuEntry[];
  onEntityDrop: (event: DragEvent, parentId: string) => void;
  onTreeDrop: (event: DragEvent) => void;
  onTreeDragOver: (event: DragEvent) => void;
  setDropTargetId: (id: string | null) => void;
  canAcceptGlbDrop: boolean;
  setRangeAnchorId: (entityId: string) => void;
};

function Chevron({ expanded, muted = false }: { expanded: boolean; muted?: boolean }): ReactElement {
  return (
    <UiIcon
      icon={expanded ? UiIcons.chevronDown : UiIcons.chevronRight}
      className={muted ? 'ed-ui-icon ed-ui-icon-muted' : 'ed-ui-icon'}
      size={muted ? 12 : 14}
      strokeWidth={2}
    />
  );
}

function hasActiveFilters(searchQuery: string, componentFilter: string): boolean {
  return Boolean(searchQuery || componentFilter);
}

function GlbNodeRow({
  ctx,
  entityId,
  node,
  depth,
  parentHidden = false,
}: {
  ctx: TreeCtx;
  entityId: string;
  node: GlbNodeRef;
  depth: number;
  parentHidden?: boolean;
}): ReactElement | null {
  const { store } = ctx;
  const isHidden = parentHidden || store.isGlbNodeHidden(entityId, node.name);
  if (isHidden) return null;

  const sub = store.getSubSelection();
  const selected = sub?.entityId === entityId && sub.nodeUuid === node.uuid;
  const target = glbTarget(entityId, node);
  const inSelection = ctx.selectedGlbNodes.has(glbSelectionKey(entityId, node.uuid));
  ctx.visibleGlbNodes.push(target);

  const bound = getBoundEntitiesForNode(store, entityId, node.name);
  const nodeBadge = getNodeOverrideComponentBadge(store, entityId, node.name);
  const hasChildren = node.children.length > 0 || bound.length > 0;
  const expanded = ctx.expand.expandedGlbNodes.has(node.uuid);
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);
  const rowClass = `ed-tree-row ed-tree-row-glb${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}`;

  return (
    <>
      <div
        className={rowClass}
        draggable
        data-glb-uuid={node.uuid}
        data-entity-id={entityId}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={(event) => ctx.handleGlbNodeClick(event, target)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu(
            event.clientX,
            event.clientY,
            ctx.glbMenuEntries(entityId, node, ctx.prepareGlbContextSelection(target)),
          );
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData(
            GLB_NODE_DND_TYPE,
            JSON.stringify({ entityId, nodeUuid: node.uuid }),
          );
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`ed-tree-chevron${expanded ? ' is-expanded' : ''}`}
            title={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              ctx.toggleGlbNodeExpanded(entityId, node.uuid);
            }}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="ed-tree-chevron-spacer" />
        )}
        <span className="ed-tree-name ed-tree-name-glb" title={node.name}>
          {node.name}
        </span>
        {nodeBadge ? <span className="ed-tree-badge">{nodeBadge}</span> : null}
      </div>
      {hasChildren && expanded
        ? [
            ...node.children
              .filter(
                (child) =>
                  !filtering ||
                  glbSubtreeHasMatch(
                    store,
                    entityId,
                    child,
                    ctx.searchQuery,
                    ctx.componentFilter,
                  ),
              )
              .map((child) => (
                <GlbNodeRow
                  key={child.uuid}
                  ctx={ctx}
                  entityId={entityId}
                  node={child}
                  depth={depth + 1}
                  parentHidden={isHidden}
                />
              )),
            ...bound
              .filter(
                (boundEntity) =>
                  !filtering ||
                  entitySubtreeHasMatch(
                    store,
                    boundEntity,
                    ctx.searchQuery,
                    ctx.componentFilter,
                  ),
              )
              .map((boundEntity) => (
                <EntityRow
                  key={boundEntity.id}
                  ctx={ctx}
                  entity={boundEntity}
                  depth={depth + 1}
                />
              )),
          ]
        : null}
    </>
  );
}

function GlbSubtree({
  ctx,
  entity,
  depth,
}: {
  ctx: TreeCtx;
  entity: EditorEntity;
  depth: number;
}): ReactElement | null {
  const tree = ctx.store.getGlbTree(entity.id);
  if (!tree) return null;

  const expanded = ctx.expand.expandedGlbEntities.has(entity.id);

  const toggle = (): void => {
    ctx.toggleGlbEntityExpanded(entity.id);
  };

  return (
    <>
      <div
        className="ed-tree-row ed-tree-row-glb ed-tree-row-glb-asset"
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <button
          type="button"
          className={`ed-tree-chevron ed-tree-chevron-asset${expanded ? ' is-expanded' : ''}`}
          title={expanded ? 'Collapse model' : 'Expand model'}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          <Chevron expanded={expanded} />
        </button>
        <span className="ed-tree-label-muted">Model</span>
      </div>
      {expanded ? (
        <GlbNodeRow ctx={ctx} entityId={entity.id} node={tree} depth={depth + 1} />
      ) : null}
    </>
  );
}

function entityRowClassName(
  selected: boolean,
  inSelection: boolean,
  parentSelected: boolean,
  isDropTarget: boolean,
): string {
  return `ed-tree-row${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}${parentSelected ? ' is-parent-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}`;
}

function EntityRowName({
  ctx,
  entity,
}: {
  ctx: TreeCtx;
  entity: EditorEntity;
}): ReactNode {
  if (ctx.renaming === entity.id) {
    return (
      <input
        className="ed-input ed-tree-rename"
        type="text"
        defaultValue={entity.name}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          ctx.setRenaming(null);
          ctx.store.renameEntity(
            entity.id,
            event.currentTarget.value.trim() || entity.name,
          );
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') ctx.setRenaming(null);
          event.stopPropagation();
        }}
      />
    );
  }
  return (
    <span className={`ed-tree-name${entity.visible ? '' : ' is-hidden-entity'}`}>
      {entity.name}
    </span>
  );
}

function shouldShowEntityGlbSubtree(
  entity: EditorEntity,
  glbTree: GlbNodeRef | null,
  ctx: TreeCtx,
  store: EditorStore,
): boolean {
  if (!entity.asset || !glbTree) return false;
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);
  if (!filtering) return true;
  return glbSubtreeHasMatch(store, entity.id, glbTree, ctx.searchQuery, ctx.componentFilter);
}

function filterEntityRowChildren(
  children: EditorEntity[],
  glbNodeNames: Set<string>,
  ctx: TreeCtx,
  store: EditorStore,
): EditorEntity[] {
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);
  return children.filter((child) => {
    if (isEntityBoundToGlb(child, glbNodeNames)) return false;
    if (filtering && !entitySubtreeHasMatch(store, child, ctx.searchQuery, ctx.componentFilter)) {
      return false;
    }
    return true;
  });
}

function EntityRow({
  ctx,
  entity,
  depth,
}: {
  ctx: TreeCtx;
  entity: EditorEntity;
  depth: number;
}): ReactElement {
  const { store } = ctx;
  ctx.visibleEntityIds.push(entity.id);

  const glbTree = store.getGlbTree(entity.id);
  const glbNodeNames = getAllGlbNodeNames(glbTree);
  const hasChildren = entity.children.length > 0 || Boolean(entity.asset && glbTree);
  const expanded = !ctx.expand.collapsedEntities.has(entity.id);
  const selection = store.getSelection();
  const sub = store.getSubSelection();
  const inSelection = store.isEntitySelected(entity.id);
  const selected = selection === entity.id && !sub;
  const parentSelected =
    selection === entity.id && Boolean(sub) && sub?.entityId === entity.id;
  const badge = componentBadge(entity);
  const isDropTarget = ctx.dropTargetId === entity.id;

  return (
    <>
      <div
        className={entityRowClassName(selected, inSelection, parentSelected, isDropTarget)}
        draggable
        data-entity-id={entity.id}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={(event) => ctx.handleEntityClick(event, entity.id)}
        onDoubleClick={() => ctx.beginRename(entity.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!store.isEntitySelected(entity.id)) {
            store.setSelection(entity.id);
            ctx.setRangeAnchorId(entity.id);
          }
          showContextMenu(event.clientX, event.clientY, ctx.entityMenuEntries(entity));
        }}
        onDragStart={(event) => {
          const ids = store.isEntitySelected(entity.id)
            ? store.getSelectedIds()
            : [entity.id];
          event.dataTransfer?.setData(ENTITY_DND_TYPE, JSON.stringify(ids));
        }}
        onDragOver={(event) => {
          const supportsEntity = event.dataTransfer?.types.includes(ENTITY_DND_TYPE);
          const supportsGlbNode =
            event.dataTransfer?.types.includes(GLB_NODE_DND_TYPE) && ctx.canAcceptGlbDrop;
          if (!supportsEntity && !supportsGlbNode) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          ctx.setDropTargetId(entity.id);
        }}
        onDragLeave={() => {
          if (ctx.dropTargetId === entity.id) ctx.setDropTargetId(null);
        }}
        onDrop={(event) => ctx.onEntityDrop(event, entity.id)}
      >
        <button
          type="button"
          className="ed-eye"
          title={entity.visible ? 'Hide' : 'Show'}
          onClick={(event) => {
            event.stopPropagation();
            store.setVisible(entity.id, !entity.visible);
          }}
        >
          {entity.visible ? '◉' : '◌'}
        </button>
        {hasChildren ? (
          <button
            type="button"
            className={`ed-tree-chevron${expanded ? ' is-expanded' : ''}`}
            title={expanded ? 'Collapse' : 'Expand'}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              ctx.toggleEntityCollapsed(entity.id);
            }}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="ed-tree-chevron-spacer" />
        )}
        <EntityRowName ctx={ctx} entity={entity} />
        {badge ? <span className="ed-tree-badge">{badge}</span> : null}
      </div>
      {expanded ? (
        <>
          {shouldShowEntityGlbSubtree(entity, glbTree, ctx, store) ? (
            <GlbSubtree ctx={ctx} entity={entity} depth={depth + 1} />
          ) : null}
          {filterEntityRowChildren(entity.children, glbNodeNames, ctx, store).map((child) => (
            <EntityRow key={child.id} ctx={ctx} entity={child} depth={depth + 1} />
          ))}
        </>
      ) : null}
    </>
  );
}

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
}: HierarchyPanelProps): ReactElement {
  useEditorStore(store, STORE_EVENTS);

  const [searchText, setSearchText] = useState('');
  const searchQuery = searchText.toLowerCase().trim();
  const [componentFilter, setComponentFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [expand, setExpand] = useState<ExpandState>(() => ({
    collapsedEntities: new Set(),
    expandedGlbEntities: new Set(),
    expandedGlbNodes: new Set(),
  }));
  const [selectedGlbNodes, setSelectedGlbNodes] = useState(
    () => new Map<string, GlbNodeColliderTarget>(),
  );
  const [, bumpLocal] = useReducer((n: number) => n + 1, 0);

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
        const nextGlbEntities = new Set(prev.expandedGlbEntities);
        nextGlbEntities.add(entityId);
        const nextGlbNodes = new Set(prev.expandedGlbNodes);
        const tree = store.getGlbTree(entityId);
        if (tree && nodeUuid) {
          const path = collectExpandUuids(tree, nodeUuid);
          if (path) {
            for (const uuid of path) nextGlbNodes.add(uuid);
            nextGlbNodes.add(nodeUuid);
          }
        }
        return {
          collapsedEntities: nextCollapsed,
          expandedGlbEntities: nextGlbEntities,
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
        const nextGlbEntities = new Set(prev.expandedGlbEntities);
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
          if (
            entity.asset &&
            glbTree &&
            glbSubtreeHasDescendantMatch(store, entity.id, glbTree, query, filter)
          ) {
            nextGlbEntities.add(entity.id);
          }
          if (glbTree) {
            const expandGlb = (node: GlbNodeRef): void => {
              if (glbSubtreeHasDescendantMatch(store, entity.id, node, query, filter)) {
                nextGlbNodes.add(node.uuid);
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
          expandedGlbEntities: nextGlbEntities,
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

  const entityMenuEntries = useCallback(
    (entity: EditorEntity): ContextMenuEntry[] => {
      const selectedIds = store.getSelectedIds();
      const multi = selectedIds.length > 1 && store.isEntitySelected(entity.id);

      if (multi) {
        const allVisible = selectedIds.every(
          (id) => store.locate(id)?.entity.visible ?? true,
        );
        const removableTypes = collectComponentTypesOnEntities(store, selectedIds);
        return [
          { label: 'Group in Empty', action: () => store.groupSelectedInEmpty() },
          {
            label: 'Move To',
            panel: () => {
              const excludedIds = new Set<string>();
              for (const id of selectedIds) {
                collectEntitySubtreeIds(store, id, excludedIds);
              }
              return createMoveToPanel(
                store,
                (parentId) => store.reparentEntities(selectedIds, parentId),
                excludedIds,
              );
            },
          },
          {
            label: 'Add Collider',
            children: addColliderShapeMenuEntries((shape) =>
              addColliderToEntities(store, selectedIds, shape),
            ),
          },
          {
            label: 'Remove Component',
            children: removeComponentTypeMenuEntries(removableTypes, (type) =>
              removeComponentTypeFromEntities(store, selectedIds, type),
            ),
          },
          { label: 'Filter', action: () => filterByItemName(entity.name) },
          'sep',
          { label: 'Duplicate', action: () => store.duplicateEntities(selectedIds) },
          {
            label: allVisible ? 'Hide' : 'Show',
            action: () => {
              for (const id of selectedIds) {
                store.setVisible(id, !allVisible);
              }
            },
          },
          'sep',
          { label: 'Delete', action: () => store.deleteEntities(selectedIds) },
        ];
      }

      return [
        { label: 'Add Child Empty', action: () => addEmptyTo(entity.id) },
        { label: 'Add Child Box', action: () => addBoxTo(entity.id) },
        {
          label: 'Move To',
          panel: () => {
            const excludedIds = new Set<string>();
            collectEntitySubtreeIds(store, entity.id, excludedIds);
            return createMoveToPanel(
              store,
              (parentId) => store.reparentEntity(entity.id, parentId),
              excludedIds,
            );
          },
        },
        'sep',
        buildEntityComponentsSubmenu(store, entity.id, spawnPositionForEntity(entity.id)),
        'sep',
        { label: 'Filter', action: () => filterByItemName(entity.name) },
        { label: 'Rename', action: () => beginRename(entity.id) },
        { label: 'Duplicate', action: () => store.duplicateEntity(entity.id) },
        {
          label: entity.visible ? 'Hide' : 'Show',
          action: () => store.setVisible(entity.id, !entity.visible),
        },
        'sep',
        { label: 'Delete', action: () => store.deleteEntity(entity.id) },
      ];
    },
    [
      addBoxTo,
      addEmptyTo,
      beginRename,
      filterByItemName,
      spawnPositionForEntity,
      store,
    ],
  );

  const glbMenuEntries = useCallback(
    (
      entityId: string,
      node: GlbNodeRef,
      targets: GlbNodeColliderTarget[],
    ): ContextMenuEntry[] => {
      const getPosition = getGlbNodePrefabPosition ?? (() => null);
      const getBounds = getGlbNodeBounds ?? (() => null);
      const removableTypes =
        targets.length > 1
          ? collectComponentTypesOnGlbNodes(store, targets)
          : [];
      const batchEntries: ContextMenuEntry[] =
        targets.length > 1
          ? [
              {
                label: `Add Collider to ${targets.length} Nodes`,
                children: addColliderShapeMenuEntries((shape) =>
                  addColliderToGlbNodes(store, targets, getGlbNodeBounds, shape),
                ),
              },
              {
                label: 'Remove Component',
                children: removeComponentTypeMenuEntries(removableTypes, (type) =>
                  removeComponentTypeFromGlbNodes(store, targets, type),
                ),
              },
              'sep',
            ]
          : [];
      return [
        ...batchEntries,
        ...buildGlbAuthoringMenu(
          store,
          entityId,
          node.uuid,
          getPosition,
          getBounds,
          node.name,
        ),
        'sep',
        ...(onDuplicateGlbNode
          ? [
              {
                label: 'Duplicate',
                action: () => onDuplicateGlbNode(entityId, node.uuid),
              } satisfies ContextMenuEntry,
            ]
          : []),
        ...(onExtractGlbNode
          ? [
              {
                label: 'Move To',
                panel: () =>
                  createMoveToPanel(store, (parentId) =>
                    onExtractGlbNode(entityId, node.uuid, parentId),
                  ),
              } satisfies ContextMenuEntry,
            ]
          : []),
        { label: 'Filter', action: () => filterByItemName(node.name) },
        { label: 'Delete', action: () => store.hideGlbNode(entityId, node.uuid) },
      ];
    },
    [
      filterByItemName,
      getGlbNodeBounds,
      getGlbNodePrefabPosition,
      onDuplicateGlbNode,
      onExtractGlbNode,
      store,
    ],
  );

  const expandAll = useCallback((): void => {
    const nextCollapsed = new Set<string>();
    const nextGlbEntities = new Set<string>();
    const nextGlbNodes = new Set<string>();
    const walkEntity = (entity: EditorEntity): void => {
      const glbTree = store.getGlbTree(entity.id);
      if (entity.asset && glbTree) {
        nextGlbEntities.add(entity.id);
        collectGlbNodeUuids(glbTree, nextGlbNodes);
      }
      for (const child of entity.children) walkEntity(child);
    };
    for (const root of store.getState().roots) walkEntity(root);
    setExpand({
      collapsedEntities: nextCollapsed,
      expandedGlbEntities: nextGlbEntities,
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
      expandedGlbEntities: new Set(),
      expandedGlbNodes: new Set(),
    });
  }, [store]);

  const toggleEntityCollapsed = useCallback((entityId: string): void => {
    setExpand((prev) => {
      const nextCollapsed = new Set(prev.collapsedEntities);
      if (nextCollapsed.has(entityId)) nextCollapsed.delete(entityId);
      else nextCollapsed.add(entityId);
      return { ...prev, collapsedEntities: nextCollapsed };
    });
  }, []);

  const toggleGlbEntityExpanded = useCallback(
    (entityId: string): void => {
      setExpand((prev) => {
        const next = new Set(prev.expandedGlbEntities);
        if (next.has(entityId)) {
          next.delete(entityId);
          clearSubSelectionIfWithinEntity(entityId);
        } else {
          next.add(entityId);
        }
        return { ...prev, expandedGlbEntities: next };
      });
    },
    [clearSubSelectionIfWithinEntity],
  );

  const toggleGlbNodeExpanded = useCallback(
    (entityId: string, nodeUuid: string): void => {
      setExpand((prev) => {
        const next = new Set(prev.expandedGlbNodes);
        if (next.has(nodeUuid)) {
          next.delete(nodeUuid);
          clearSubSelectionIfWithin(entityId, nodeUuid);
        } else {
          next.add(nodeUuid);
        }
        return { ...prev, expandedGlbNodes: next };
      });
    },
    [clearSubSelectionIfWithin],
  );

  const onEntityDrop = useCallback(
    (event: DragEvent, parentId: string): void => {
      setDropTargetId(null);
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

  const usedTypes = collectUsedComponentTypes(store.getState().roots);
  const usedTypesKey = usedTypes.join('\0');
  const activeFilter =
    componentFilter && usedTypes.includes(componentFilter) ? componentFilter : '';

  // Reset invalid component filter when types change
  useEffect(() => {
    const types = usedTypesKey.length > 0 ? usedTypesKey.split('\0') : [];
    if (componentFilter && !types.includes(componentFilter)) {
      setComponentFilter('');
    }
  }, [componentFilter, usedTypesKey]);

  const subSelection = store.getSubSelection();
  const scrollSelectionKey = `${store.getSelection() ?? ''}::${subSelection?.nodeUuid ?? ''}`;
  useLayoutEffect(() => {
    if (prevScrollSelectionKeyRef.current === scrollSelectionKey) return;
    prevScrollSelectionKeyRef.current = scrollSelectionKey;
    bodyRef.current
      ?.querySelector<HTMLElement>('.ed-tree-row.is-selected')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [scrollSelectionKey]);

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
    toggleGlbEntityExpanded,
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

  const roots = store.getState().roots;
  const filtering = hasActiveFilters(searchQuery, activeFilter);
  const visibleRoots = filtering
    ? roots.filter((entity) =>
        entitySubtreeHasMatch(store, entity, searchQuery, activeFilter),
      )
    : roots;

  let bodyContent: ReactNode;
  if (roots.length === 0) {
    bodyContent = (
      <div className="ed-empty-note">
        Empty scene. Right-click or use the toolbar to add a Box / Empty, or drop assets
        from the Project panel.
      </div>
    );
  } else if (filtering && visibleRoots.length === 0) {
    const filterParts: string[] = [];
    if (searchQuery) filterParts.push(`search "${searchQuery}"`);
    if (activeFilter) {
      const label =
        getComponentDef(activeFilter as PrefabComponentType)?.label ?? activeFilter;
      filterParts.push(`component "${label}"`);
    }
    bodyContent = (
      <div className="ed-empty-note">
        No entities match {filterParts.join(' and ')}
      </div>
    );
  } else {
    bodyContent = (
      <div
        className="ed-tree"
        onDragOver={onTreeDragOver}
        onDrop={onTreeDrop}
      >
        {visibleRoots.map((entity) => (
          <EntityRow key={entity.id} ctx={ctx} entity={entity} depth={0} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="ed-panel-title">
        <span>Hierarchy</span>
        <div className="ed-panel-title-actions">
          <button
            type="button"
            className="ed-btn"
            title="Expand all"
            aria-label="Expand all"
            onClick={expandAll}
          >
            ⊞
          </button>
          <button
            type="button"
            className="ed-btn"
            title="Collapse all"
            aria-label="Collapse all"
            onClick={collapseAll}
          >
            ⊟
          </button>
          <select
            className="ed-select ed-hierarchy-filter-select"
            title="Filter by component"
            aria-label="Filter by component"
            value={activeFilter}
            disabled={usedTypes.length === 0}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setComponentFilter(next);
              autoExpandForFilters(searchQuery, next);
            }}
          >
            <option value="">All components</option>
            {usedTypes.map((type) => (
              <option key={type} value={type}>
                {getComponentDef(type as PrefabComponentType)?.label ?? type}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="ed-hierarchy-search">
        <input
          ref={searchInputRef}
          className="ed-input ed-hierarchy-search-input"
          type="text"
          placeholder="Search..."
          spellCheck={false}
          autoComplete="off"
          value={searchText}
          onChange={(event) => {
            const nextText = event.currentTarget.value;
            setSearchText(nextText);
            autoExpandForFilters(nextText.toLowerCase().trim(), activeFilter);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setSearchText('');
              event.currentTarget.blur();
              autoExpandForFilters('', activeFilter);
            }
            event.stopPropagation();
          }}
        />
        <button
          type="button"
          className={`ed-hierarchy-search-clear${searchQuery ? ' is-visible' : ''}`}
          title="Clear search"
          onClick={() => {
            setSearchText('');
            autoExpandForFilters('', activeFilter);
            searchInputRef.current?.focus();
          }}
        >
          ×
        </button>
      </div>
      <div
        ref={bodyRef}
        className="ed-panel-body"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('.ed-tree-row')) return;
          event.preventDefault();
          showContextMenu(event.clientX, event.clientY, [
            { label: 'Add Empty', action: () => addEmptyTo(null) },
            { label: 'Add Box', action: () => addBoxTo(null) },
          ]);
        }}
      >
        {bodyContent}
      </div>
    </>
  );
}
