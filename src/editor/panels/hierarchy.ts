import { clearChildren, el, showContextMenu, type ContextMenuEntry } from '../dom';
import { entityBoundToAnyGlbNode, entityTargetsGlbNode } from '../glb_binding';
import { createEmptyEntity, type EditorEntity, type EditorStore, type GlbNodeRef } from '../document';
import {
  addColliderToEntities,
  addColliderToGlbNodes,
  buildEntityComponentsSubmenu,
  buildGlbAuthoringMenu,
  type GlbNodeColliderTarget,
} from '../component_actions';
import { getComponentDef } from '../../world/prefabs/component_registry';
import type { PrefabComponentType } from '../../world/prefabs/schema';
import type { Vec3 } from '../../types';

const ENTITY_DND_TYPE = 'application/x-claudecitizen-entity';

function parseDraggedEntityIds(data: string): string[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    // Legacy single-id payload.
  }
  return [data];
}

function idsToReparent(draggedIds: string[], store: EditorStore): string[] {
  if (draggedIds.length === 0) return [];
  const primary = draggedIds[0];
  return store.isEntitySelected(primary) ? store.getSelectedIds() : draggedIds;
}

export interface HierarchyPanelOptions {
  getGlbNodePrefabPosition?: (entityId: string, nodeUuid: string) => Vec3 | null;
  getGlbNodeBounds?: (entityId: string, nodeUuid: string) => { min: Vec3; max: Vec3 } | null;
}

function componentBadge(entity: EditorEntity): string | null {
  if (entity.components.length === 0) return null;
  if (entity.components.length === 1) return entity.components[0].type;
  return `${entity.components.length} components`;
}

function collectExpandUuids(
  tree: GlbNodeRef,
  targetUuid: string,
  path: string[] = [],
): string[] | null {
  if (tree.uuid === targetUuid) return path;
  for (const child of tree.children) {
    const found = collectExpandUuids(child, targetUuid, [...path, tree.uuid]);
    if (found) return found;
  }
  return null;
}

function collectGlbNodeUuids(node: GlbNodeRef, out: Set<string>): void {
  out.add(node.uuid);
  for (const child of node.children) {
    collectGlbNodeUuids(child, out);
  }
}

function findGlbNodeByName(node: GlbNodeRef, name: string): GlbNodeRef | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findGlbNodeByName(child, name);
    if (found) return found;
  }
  return null;
}

function collectUsedComponentTypes(roots: readonly EditorEntity[]): string[] {
  const types = new Set<string>();
  const walk = (entity: EditorEntity): void => {
    for (const component of entity.components) types.add(component.type);
    for (const override of entity.glbNodeTransforms) {
      for (const component of override.components) types.add(component.type);
    }
    for (const child of entity.children) walk(child);
  };
  for (const root of roots) walk(root);
  return [...types].sort((a, b) => a.localeCompare(b));
}

export function createHierarchyPanel(
  container: HTMLElement,
  store: EditorStore,
  options: HierarchyPanelOptions = {},
): void {
  const body = el('div', { className: 'ed-panel-body' });
  let renaming: string | null = null;
  const expandedGlbEntities = new Set<string>();
  const expandedGlbNodes = new Set<string>();
  let searchQuery = '';
  let componentFilter = '';
  let visibleEntityIds: string[] = [];
  let visibleGlbNodes: GlbNodeColliderTarget[] = [];
  let rangeAnchorId: string | null = null;
  let glbRangeAnchorKey: string | null = null;
  let changingGlbSelectionFromHierarchy = false;
  const selectedGlbNodes = new Map<string, GlbNodeColliderTarget>();

  const searchInput = el('input', {
    className: 'ed-input ed-hierarchy-search-input',
    attrs: {
      type: 'text',
      placeholder: 'Search...',
      spellcheck: 'false',
      autocomplete: 'off',
    },
    on: {
      input: (event) => {
        searchQuery = (event.target as HTMLInputElement).value.toLowerCase().trim();
        if (searchQuery) {
          clearBtn.classList.add('is-visible');
        } else {
          clearBtn.classList.remove('is-visible');
        }
        autoExpandForFilters();
        render();
      },
      keydown: (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Escape') {
          const input = event.target as HTMLInputElement;
          input.value = '';
          searchQuery = '';
          clearBtn.classList.remove('is-visible');
          input.blur();
          autoExpandForFilters();
          render();
        }
        event.stopPropagation();
      },
    },
  }) as HTMLInputElement;

  const clearBtn = el('button', {
    className: 'ed-hierarchy-search-clear',
    text: '×',
    title: 'Clear search',
    on: {
      click: () => {
        searchInput.value = '';
        searchQuery = '';
        clearBtn.classList.remove('is-visible');
        searchInput.focus();
        autoExpandForFilters();
        render();
      },
    },
  });

  const searchContainer = el('div', { className: 'ed-hierarchy-search' }, [
    searchInput,
    clearBtn,
  ]);

  function expandAll(): void {
    function walkEntity(entity: EditorEntity): void {
      const glbTree = store.getGlbTree(entity.id);
      if (entity.asset && glbTree) {
        expandedGlbEntities.add(entity.id);
        collectGlbNodeUuids(glbTree, expandedGlbNodes);
      }
      for (const child of entity.children) {
        walkEntity(child);
      }
    }
    for (const root of store.getState().roots) {
      walkEntity(root);
    }
    render();
  }

  function collapseAll(): void {
    expandedGlbEntities.clear();
    expandedGlbNodes.clear();
    const sub = store.getSubSelection();
    if (sub?.entityId) {
      store.setEntitySelection(sub.entityId, 'replace');
    }
    render();
  }

  const expandAllBtn = el('button', {
    className: 'ed-btn',
    text: '⊞',
    title: 'Expand all',
    attrs: { 'aria-label': 'Expand all' },
    on: { click: () => expandAll() },
  });

  const collapseAllBtn = el('button', {
    className: 'ed-btn',
    text: '⊟',
    title: 'Collapse all',
    attrs: { 'aria-label': 'Collapse all' },
    on: { click: () => collapseAll() },
  });

  const componentFilterSelect = el('select', {
    className: 'ed-select ed-hierarchy-filter-select',
    title: 'Filter by component',
    attrs: { 'aria-label': 'Filter by component' },
    on: {
      change: (event) => {
        componentFilter = (event.target as HTMLSelectElement).value;
        autoExpandForFilters();
        render();
      },
    },
  }) as HTMLSelectElement;

  function refreshComponentFilterOptions(): void {
    const usedTypes = collectUsedComponentTypes(store.getState().roots);
    const previous = componentFilter;
    clearChildren(componentFilterSelect);
    componentFilterSelect.append(
      el('option', { text: 'All components', attrs: { value: '' } }),
    );
    for (const type of usedTypes) {
      const label = getComponentDef(type as PrefabComponentType)?.label ?? type;
      componentFilterSelect.append(
        el('option', { text: label, attrs: { value: type } }),
      );
    }
    if (previous && usedTypes.includes(previous)) {
      componentFilterSelect.value = previous;
    } else {
      componentFilter = '';
      componentFilterSelect.value = '';
    }
    componentFilterSelect.disabled = usedTypes.length === 0;
  }

  function filterByItemName(name: string): void {
    const baseName = name.replace(/[\s_]*\(\d+\)$/, '').trim() || name.trim();
    searchInput.value = baseName;
    searchQuery = baseName.toLowerCase();
    clearBtn.classList.toggle('is-visible', Boolean(searchQuery));
    componentFilter = '';
    componentFilterSelect.value = '';
    autoExpandForFilters();
    render();
  }

  container.append(
    el('div', { className: 'ed-panel-title' }, [
      el('span', { text: 'Hierarchy' }),
      el('div', { className: 'ed-panel-title-actions' }, [
        expandAllBtn,
        collapseAllBtn,
        componentFilterSelect,
      ]),
    ]),
    searchContainer,
    body,
  );

  function beginRename(entityId: string): void {
    renaming = entityId;
    render();
    (body.querySelector('.ed-tree-rename') as HTMLInputElement | null)?.select();
  }

  function addEmptyTo(parentId: string | null): void {
    const entity = createEmptyEntity('Empty');
    store.addEntity(entity, parentId);
    beginRename(entity.id);
  }

  function addBoxTo(parentId: string | null): void {
    const entity = createEmptyEntity('Box');
    entity.primitive = { shape: 'box', size: { x: 2, y: 2, z: 2 }, color: '#4c5663' };
    if (parentId === null) entity.position = { x: 0, y: 1, z: 0 };
    store.addEntity(entity, parentId);
  }

  function spawnPositionForEntity(entityId: string): (() => Vec3 | null) | undefined {
    const sub = store.getSubSelection();
    if (!sub || sub.entityId !== entityId || !options.getGlbNodePrefabPosition) {
      return undefined;
    }
    return () => options.getGlbNodePrefabPosition!(sub.entityId, sub.nodeUuid);
  }

  function glbSelectionKey(entityId: string, nodeUuid: string): string {
    return `${entityId}::${nodeUuid}`;
  }

  function glbTarget(entityId: string, node: GlbNodeRef): GlbNodeColliderTarget {
    return { entityId, nodeUuid: node.uuid, nodeName: node.name };
  }

  function setPrimaryGlbSelection(
    target: GlbNodeColliderTarget | null,
    fallbackEntityId?: string,
  ): boolean {
    const current = store.getSubSelection();
    if (
      target &&
      current?.entityId === target.entityId &&
      current.nodeUuid === target.nodeUuid
    ) {
      return false;
    }
    if (!target && !current) return false;
    changingGlbSelectionFromHierarchy = true;
    try {
      if (target) {
        ensureGlbExpanded(target.entityId, target.nodeUuid);
        store.setSubSelection(target.entityId, target.nodeUuid);
      } else {
        store.setEntitySelection(fallbackEntityId ?? null, 'replace');
      }
    } finally {
      changingGlbSelectionFromHierarchy = false;
    }
    return true;
  }

  function handleGlbNodeClick(
    event: MouseEvent,
    target: GlbNodeColliderTarget,
  ): void {
    const key = glbSelectionKey(target.entityId, target.nodeUuid);
    let primaryChanged = false;

    if (event.shiftKey && glbRangeAnchorKey) {
      const anchorIndex = visibleGlbNodes.findIndex(
        (candidate) =>
          glbSelectionKey(candidate.entityId, candidate.nodeUuid) === glbRangeAnchorKey,
      );
      const targetIndex = visibleGlbNodes.findIndex(
        (candidate) =>
          candidate.entityId === target.entityId && candidate.nodeUuid === target.nodeUuid,
      );
      if (anchorIndex >= 0 && targetIndex >= 0) {
        selectedGlbNodes.clear();
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        for (const candidate of visibleGlbNodes.slice(start, end + 1)) {
          selectedGlbNodes.set(
            glbSelectionKey(candidate.entityId, candidate.nodeUuid),
            candidate,
          );
        }
      } else {
        selectedGlbNodes.clear();
        selectedGlbNodes.set(key, target);
        glbRangeAnchorKey = key;
      }
      primaryChanged = setPrimaryGlbSelection(target);
    } else if (event.ctrlKey || event.metaKey) {
      if (selectedGlbNodes.has(key)) {
        selectedGlbNodes.delete(key);
        const current = store.getSubSelection();
        if (selectedGlbNodes.size === 0) {
          primaryChanged = setPrimaryGlbSelection(null, target.entityId);
        } else if (
          current?.entityId === target.entityId &&
          current.nodeUuid === target.nodeUuid
        ) {
          primaryChanged = setPrimaryGlbSelection(
            [...selectedGlbNodes.values()].at(-1) ?? null,
            target.entityId,
          );
        }
      } else {
        selectedGlbNodes.set(key, target);
        primaryChanged = setPrimaryGlbSelection(target);
      }
      glbRangeAnchorKey = key;
    } else {
      selectedGlbNodes.clear();
      selectedGlbNodes.set(key, target);
      glbRangeAnchorKey = key;
      primaryChanged = setPrimaryGlbSelection(target);
    }

    if (!primaryChanged) render();
  }

  function prepareGlbContextSelection(
    target: GlbNodeColliderTarget,
  ): GlbNodeColliderTarget[] {
    const key = glbSelectionKey(target.entityId, target.nodeUuid);
    const changedSet = !selectedGlbNodes.has(key);
    if (changedSet) {
      selectedGlbNodes.clear();
      selectedGlbNodes.set(key, target);
      glbRangeAnchorKey = key;
    }
    const primaryChanged = setPrimaryGlbSelection(target);
    if (changedSet && !primaryChanged) render();
    return [...selectedGlbNodes.values()];
  }

  function handleEntityClick(event: MouseEvent, entityId: string): void {
    selectedGlbNodes.clear();
    glbRangeAnchorKey = null;
    if (event.shiftKey) {
      store.setEntitySelection(
        entityId,
        'range',
        rangeAnchorId ?? undefined,
        visibleEntityIds,
      );
    } else if (event.ctrlKey || event.metaKey) {
      store.setEntitySelection(entityId, 'toggle');
      rangeAnchorId = entityId;
      return;
    } else {
      store.setEntitySelection(entityId, 'replace');
    }
    rangeAnchorId = entityId;
  }

  function entityMenuEntries(entity: EditorEntity): ContextMenuEntry[] {
    const selectedIds = store.getSelectedIds();
    const multi = selectedIds.length > 1 && store.isEntitySelected(entity.id);

    if (multi) {
      const allVisible = selectedIds.every(
        (id) => store.locate(id)?.entity.visible ?? true,
      );
      return [
        { label: 'Group in Empty', action: () => store.groupSelectedInEmpty() },
        {
          label: 'Add Collider',
          action: () => addColliderToEntities(store, selectedIds),
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
  }

  function glbMenuEntries(
    entityId: string,
    node: GlbNodeRef,
    targets: GlbNodeColliderTarget[],
  ): ContextMenuEntry[] {
    const getPosition =
      options.getGlbNodePrefabPosition ??
      (() => null);
    const getBounds =
      options.getGlbNodeBounds ??
      (() => null);
    const batchEntries: ContextMenuEntry[] =
      targets.length > 1
        ? [
            {
              label: `Add Collider to ${targets.length} Nodes`,
              action: () =>
                addColliderToGlbNodes(store, targets, options.getGlbNodeBounds),
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
      { label: 'Filter', action: () => filterByItemName(node.name) },
      { label: 'Delete', action: () => store.hideGlbNode(entityId, node.uuid) },
    ];
  }

  function ensureGlbExpanded(entityId: string, nodeUuid?: string | null): void {
    expandedGlbEntities.add(entityId);
    const tree = store.getGlbTree(entityId);
    if (!tree || !nodeUuid) return;
    const path = collectExpandUuids(tree, nodeUuid);
    if (!path) return;
    for (const uuid of path) expandedGlbNodes.add(uuid);
    expandedGlbNodes.add(nodeUuid);
  }

  function nodeIsSelfOrDescendant(node: GlbNodeRef, targetUuid: string): boolean {
    if (node.uuid === targetUuid) return true;
    for (const child of node.children) {
      if (nodeIsSelfOrDescendant(child, targetUuid)) return true;
    }
    return false;
  }

  function glbNodeIsAncestorOrSelf(
    root: GlbNodeRef,
    ancestorUuid: string,
    targetUuid: string,
  ): boolean {
    if (root.uuid === ancestorUuid) {
      return nodeIsSelfOrDescendant(root, targetUuid);
    }
    for (const child of root.children) {
      if (glbNodeIsAncestorOrSelf(child, ancestorUuid, targetUuid)) return true;
    }
    return false;
  }

  function clearSubSelectionIfWithin(entityId: string, collapsedNodeUuid: string): void {
    const sub = store.getSubSelection();
    if (!sub || sub.entityId !== entityId || !sub.nodeUuid) return;
    const tree = store.getGlbTree(entityId);
    if (!tree) return;
    if (glbNodeIsAncestorOrSelf(tree, collapsedNodeUuid, sub.nodeUuid)) {
      store.setEntitySelection(entityId, 'replace');
    }
  }

  function clearSubSelectionIfWithinEntity(entityId: string): void {
    const sub = store.getSubSelection();
    if (sub?.entityId === entityId) {
      store.setEntitySelection(entityId, 'replace');
    }
  }

  function autoExpandForFilters(): void {
    if (!hasActiveFilters()) return;
    const walkEntity = (entity: EditorEntity): void => {
      const glbTree = store.getGlbTree(entity.id);
      if (entity.asset && glbTree && glbSubtreeHasDescendantMatch(entity.id, glbTree)) {
        expandedGlbEntities.add(entity.id);
      }
      if (glbTree) {
        const expandGlb = (node: GlbNodeRef): void => {
          if (glbSubtreeHasDescendantMatch(entity.id, node)) {
            expandedGlbNodes.add(node.uuid);
          }
          for (const child of node.children) expandGlb(child);
        };
        expandGlb(glbTree);
      }
      for (const child of entity.children) walkEntity(child);
    };
    for (const root of store.getState().roots) walkEntity(root);
  }

  function doesEntityTargetGlbNode(child: EditorEntity, nodeName: string): boolean {
    return entityTargetsGlbNode(child, nodeName);
  }

  function getBoundEntitiesForNode(entityId: string, nodeName: string): EditorEntity[] {
    const parentEntity = store.locate(entityId)?.entity;
    if (!parentEntity) return [];
    return parentEntity.children.filter(child => doesEntityTargetGlbNode(child, nodeName));
  }

  function getNodeOverrideComponentBadge(entityId: string, nodeName: string): string | null {
    const entity = store.locate(entityId)?.entity;
    if (!entity) return null;
    const override = entity.glbNodeTransforms.find((o) => o.nodeName === nodeName);
    if (!override || override.components.length === 0) return null;
    if (override.components.length === 1) return override.components[0].type;
    return `${override.components.length} components`;
  }

  function getAllGlbNodeNames(tree: GlbNodeRef | null): Set<string> {
    const names = new Set<string>();
    if (!tree) return names;
    const traverse = (node: GlbNodeRef) => {
      names.add(node.name);
      for (const child of node.children) traverse(child);
    };
    traverse(tree);
    return names;
  }

  function isEntityBoundToGlb(child: EditorEntity, glbNodeNames: Set<string>): boolean {
    return entityBoundToAnyGlbNode(child, glbNodeNames);
  }

  function hasActiveFilters(): boolean {
    return Boolean(searchQuery || componentFilter);
  }

  function entityPassesFilters(entity: EditorEntity): boolean {
    const nameOk = !searchQuery || entity.name.toLowerCase().includes(searchQuery);
    const componentOk =
      !componentFilter || entity.components.some((component) => component.type === componentFilter);
    return nameOk && componentOk;
  }

  function glbNodePassesFilters(entityId: string, node: GlbNodeRef): boolean {
    const nameOk = !searchQuery || node.name.toLowerCase().includes(searchQuery);
    if (!componentFilter) return nameOk;
    const entity = store.locate(entityId)?.entity;
    const override = entity?.glbNodeTransforms.find((entry) => entry.nodeName === node.name);
    const componentOk =
      override?.components.some((component) => component.type === componentFilter) ?? false;
    return nameOk && componentOk;
  }

  function glbSubtreeHasMatch(entityId: string, node: GlbNodeRef): boolean {
    if (glbNodePassesFilters(entityId, node)) return true;

    const bound = getBoundEntitiesForNode(entityId, node.name);
    for (const boundEntity of bound) {
      if (entitySubtreeHasMatch(boundEntity)) return true;
    }

    for (const child of node.children) {
      if (glbSubtreeHasMatch(entityId, child)) return true;
    }

    return false;
  }

  function entitySubtreeHasMatch(entity: EditorEntity): boolean {
    if (entityPassesFilters(entity)) return true;

    const glbTree = store.getGlbTree(entity.id);
    const glbNodeNames = getAllGlbNodeNames(glbTree);

    if (glbTree && glbSubtreeHasMatch(entity.id, glbTree)) {
      return true;
    }

    for (const child of entity.children) {
      if (isEntityBoundToGlb(child, glbNodeNames)) continue;
      if (entitySubtreeHasMatch(child)) return true;
    }

    return false;
  }

  function glbSubtreeHasDescendantMatch(entityId: string, node: GlbNodeRef): boolean {
    const bound = getBoundEntitiesForNode(entityId, node.name);
    for (const boundEntity of bound) {
      if (entitySubtreeHasMatch(boundEntity)) return true;
    }

    for (const child of node.children) {
      if (glbSubtreeHasMatch(entityId, child)) return true;
    }

    return false;
  }

  function renderGlbRow(
    entityId: string,
    node: GlbNodeRef,
    depth: number,
    rows: HTMLElement[],
    parentHidden = false,
  ): void {
    const isHidden = parentHidden || store.isGlbNodeHidden(entityId, node.name);
    if (isHidden) return;

    const sub = store.getSubSelection();
    const selected =
      sub?.entityId === entityId && sub.nodeUuid === node.uuid;
    const target = glbTarget(entityId, node);
    const inSelection = selectedGlbNodes.has(
      glbSelectionKey(entityId, node.uuid),
    );
    visibleGlbNodes.push(target);
    const bound = getBoundEntitiesForNode(entityId, node.name);
    const nodeBadge = getNodeOverrideComponentBadge(entityId, node.name);
    const hasChildren = node.children.length > 0 || bound.length > 0;
    const expanded = expandedGlbNodes.has(node.uuid);

    const toggle = hasChildren
      ? el('button', {
          className: `ed-tree-chevron${expanded ? ' is-expanded' : ''}`,
          text: expanded ? '▾' : '▸',
          title: expanded ? 'Collapse' : 'Expand',
          on: {
            click: (event) => {
              event.stopPropagation();
              if (expandedGlbNodes.has(node.uuid)) {
                expandedGlbNodes.delete(node.uuid);
                clearSubSelectionIfWithin(entityId, node.uuid);
              } else {
                expandedGlbNodes.add(node.uuid);
              }
              render();
            },
          },
        })
      : el('span', { className: 'ed-tree-chevron-spacer' });

    const row = el(
      'div',
      {
        className: `ed-tree-row ed-tree-row-glb${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}`,
        attrs: { 'data-glb-uuid': node.uuid, 'data-entity-id': entityId },
        on: {
          click: (event) =>
            handleGlbNodeClick(event as MouseEvent, target),
          contextmenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            const targets = prepareGlbContextSelection(target);
            const mouse = event as MouseEvent;
            showContextMenu(
              mouse.clientX,
              mouse.clientY,
              glbMenuEntries(entityId, node, targets),
            );
          },
        },
      },
      [
        toggle,
        el('span', {
          className: 'ed-tree-name ed-tree-name-glb',
          text: node.name,
          title: node.name,
        }),
        ...(nodeBadge ? [el('span', { className: 'ed-tree-badge', text: nodeBadge })] : []),
      ],
    );
    row.style.paddingLeft = `${10 + depth * 14}px`;
    rows.push(row);

    if (hasChildren && expanded) {
      for (const child of node.children) {
        if (!hasActiveFilters() || glbSubtreeHasMatch(entityId, child)) {
          renderGlbRow(entityId, child, depth + 1, rows, isHidden);
        }
      }
      for (const boundEntity of bound) {
        if (!hasActiveFilters() || entitySubtreeHasMatch(boundEntity)) {
          renderRow(boundEntity, depth + 1, rows);
        }
      }
    }
  }

  function renderGlbSubtree(
    entity: EditorEntity,
    depth: number,
    rows: HTMLElement[],
  ): void {
    const tree = store.getGlbTree(entity.id);
    if (!tree) return;

    const expanded = expandedGlbEntities.has(entity.id);
    const toggle = el('button', {
      className: `ed-tree-chevron ed-tree-chevron-asset${expanded ? ' is-expanded' : ''}`,
      text: expanded ? '▾' : '▸',
      title: expanded ? 'Collapse model' : 'Expand model',
      on: {
        click: (event) => {
          event.stopPropagation();
          if (expandedGlbEntities.has(entity.id)) {
            expandedGlbEntities.delete(entity.id);
            clearSubSelectionIfWithinEntity(entity.id);
          } else {
            expandedGlbEntities.add(entity.id);
          }
          render();
        },
      },
    });

    const assetRow = el(
      'div',
      {
        className: 'ed-tree-row ed-tree-row-glb ed-tree-row-glb-asset',
        on: {
          click: (event) => {
            event.stopPropagation();
            if (expandedGlbEntities.has(entity.id)) {
              expandedGlbEntities.delete(entity.id);
              clearSubSelectionIfWithinEntity(entity.id);
            } else {
              expandedGlbEntities.add(entity.id);
            }
            render();
          },
        },
      },
      [
        toggle,
        el('span', {
          className: 'ed-tree-label-muted',
          text: 'Model',
        }),
      ],
    );
    assetRow.style.paddingLeft = `${10 + depth * 14}px`;
    rows.push(assetRow);

    if (expanded) {
      renderGlbRow(entity.id, tree, depth + 1, rows);
    }
  }

  function renderRow(entity: EditorEntity, depth: number, rows: HTMLElement[]): void {
    visibleEntityIds.push(entity.id);

    const selection = store.getSelection();
    const sub = store.getSubSelection();
    const inSelection = store.isEntitySelected(entity.id);
    const selected = selection === entity.id && !sub;
    const parentSelected =
      selection === entity.id && Boolean(sub) && sub?.entityId === entity.id;
    const badge = componentBadge(entity);

    const nameEl =
      renaming === entity.id
        ? el('input', {
            className: 'ed-input ed-tree-rename',
            attrs: { type: 'text', value: entity.name },
            on: {
              blur: (event) => {
                renaming = null;
                store.renameEntity(entity.id, (event.target as HTMLInputElement).value.trim() || entity.name);
                render();
              },
              keydown: (event) => {
                const key = (event as KeyboardEvent).key;
                if (key === 'Enter') (event.target as HTMLInputElement).blur();
                if (key === 'Escape') {
                  renaming = null;
                  render();
                }
                event.stopPropagation();
              },
            },
          })
        : el('span', {
            className: `ed-tree-name${entity.visible ? '' : ' is-hidden-entity'}`,
            text: entity.name,
          });

    const row = el(
      'div',
      {
        className: `ed-tree-row${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}${parentSelected ? ' is-parent-selected' : ''}`,
        attrs: { draggable: 'true', 'data-entity-id': entity.id },
        on: {
          click: (event) => handleEntityClick(event as MouseEvent, entity.id),
          dblclick: () => beginRename(entity.id),
          contextmenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!store.isEntitySelected(entity.id)) {
              store.setSelection(entity.id);
              rangeAnchorId = entity.id;
            }
            const mouse = event as MouseEvent;
            showContextMenu(mouse.clientX, mouse.clientY, entityMenuEntries(entity));
          },
          dragstart: (event) => {
            const dragEvent = event as DragEvent;
            const ids = store.isEntitySelected(entity.id)
              ? store.getSelectedIds()
              : [entity.id];
            dragEvent.dataTransfer?.setData(ENTITY_DND_TYPE, JSON.stringify(ids));
          },
          dragover: (event) => {
            const dragEvent = event as DragEvent;
            if (!dragEvent.dataTransfer?.types.includes(ENTITY_DND_TYPE)) return;
            dragEvent.preventDefault();
            row.classList.add('is-drop-target');
          },
          dragleave: () => row.classList.remove('is-drop-target'),
          drop: (event) => {
            const dragEvent = event as DragEvent;
            row.classList.remove('is-drop-target');
            const draggedIds = parseDraggedEntityIds(
              dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
            );
            const idsToMove = idsToReparent(draggedIds, store).filter(
              (id) => id !== entity.id,
            );
            if (idsToMove.length === 0) return;
            dragEvent.preventDefault();
            dragEvent.stopPropagation();
            store.reparentEntities(idsToMove, entity.id);
          },
        },
      },
      [
        el('button', {
          className: 'ed-eye',
          text: entity.visible ? '◉' : '◌',
          title: entity.visible ? 'Hide' : 'Show',
          on: {
            click: (event) => {
              event.stopPropagation();
              store.setVisible(entity.id, !entity.visible);
            },
          },
        }),
        nameEl,
        ...(badge ? [el('span', { className: 'ed-tree-badge', text: badge })] : []),
      ],
    );
    row.style.paddingLeft = `${10 + depth * 14}px`;
    rows.push(row);

    const glbTree = store.getGlbTree(entity.id);
    const glbNodeNames = getAllGlbNodeNames(glbTree);

    if (entity.asset && glbTree) {
      if (!hasActiveFilters() || glbSubtreeHasMatch(entity.id, glbTree)) {
        renderGlbSubtree(entity, depth + 1, rows);
      }
    }

    for (const child of entity.children) {
      if (isEntityBoundToGlb(child, glbNodeNames)) continue;
      if (hasActiveFilters() && !entitySubtreeHasMatch(child)) continue;
      renderRow(child, depth + 1, rows);
    }
  }

  body.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Add Empty', action: () => addEmptyTo(null) },
      { label: 'Add Box', action: () => addBoxTo(null) },
    ]);
  });

  function render(): void {
    refreshComponentFilterOptions();
    clearChildren(body);
    visibleEntityIds = [];
    visibleGlbNodes = [];
    const roots = store.getState().roots;
    if (roots.length === 0) {
      body.append(
        el('div', {
          className: 'ed-empty-note',
          text: 'Empty scene. Right-click or use the toolbar to add a Box / Empty, or drop assets from the Project panel.',
        }),
      );
      return;
    }
    const tree = el('div', {
      className: 'ed-tree',
      on: {
        dragover: (event) => {
          const dragEvent = event as DragEvent;
          if (dragEvent.dataTransfer?.types.includes(ENTITY_DND_TYPE)) dragEvent.preventDefault();
        },
        drop: (event) => {
          const dragEvent = event as DragEvent;
          const draggedIds = parseDraggedEntityIds(
            dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
          );
          const idsToMove = idsToReparent(draggedIds, store);
          if (idsToMove.length === 0) return;
          dragEvent.preventDefault();
          store.reparentEntities(idsToMove, null);
        },
      },
    });
    const rows: HTMLElement[] = [];
    for (const entity of roots) {
      if (hasActiveFilters() && !entitySubtreeHasMatch(entity)) continue;
      renderRow(entity, 0, rows);
    }
    if (hasActiveFilters() && rows.length === 0) {
      const filterParts: string[] = [];
      if (searchQuery) filterParts.push(`search "${searchQuery}"`);
      if (componentFilter) {
        const label = getComponentDef(componentFilter as PrefabComponentType)?.label ?? componentFilter;
        filterParts.push(`component "${label}"`);
      }
      body.append(
        el('div', {
          className: 'ed-empty-note',
          text: `No entities match ${filterParts.join(' and ')}`,
        }),
      );
      return;
    }
    tree.append(...rows);
    body.append(tree);
  }

  function scrollSelectionIntoView(): void {
    body
      .querySelector<HTMLElement>('.ed-tree-row.is-selected')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function remapSelectedGlbNodes(entityId: string): void {
    if (!entityId) return;
    const tree = store.getGlbTree(entityId);
    if (!tree) return;
    const selectedForEntity = [...selectedGlbNodes.entries()].filter(
      ([, target]) => target.entityId === entityId,
    );
    for (const [oldKey, target] of selectedForEntity) {
      const node = findGlbNodeByName(tree, target.nodeName);
      if (!node) {
        selectedGlbNodes.delete(oldKey);
        continue;
      }
      const nextKey = glbSelectionKey(entityId, node.uuid);
      if (nextKey === oldKey) continue;
      selectedGlbNodes.delete(oldKey);
      selectedGlbNodes.set(nextKey, glbTarget(entityId, node));
      if (glbRangeAnchorKey === oldKey) glbRangeAnchorKey = nextKey;
    }
  }

  function syncGlbSelectionFromStore(
    entityId: string | null,
    nodeUuid: string | null,
  ): void {
    if (!entityId || !nodeUuid) {
      selectedGlbNodes.clear();
      glbRangeAnchorKey = null;
      return;
    }
    const nodeName = store.getGlbNodeName(entityId, nodeUuid);
    if (!nodeName) return;
    const matching = [...selectedGlbNodes.entries()].find(
      ([, target]) =>
        target.entityId === entityId && target.nodeName === nodeName,
    );
    if (matching && matching[1].nodeUuid !== nodeUuid) {
      const [oldKey] = matching;
      const next = { entityId, nodeUuid, nodeName };
      const nextKey = glbSelectionKey(entityId, nodeUuid);
      selectedGlbNodes.delete(oldKey);
      selectedGlbNodes.set(nextKey, next);
      if (glbRangeAnchorKey === oldKey) glbRangeAnchorKey = nextKey;
      return;
    }
    if (changingGlbSelectionFromHierarchy) return;
    selectedGlbNodes.clear();
    const target = { entityId, nodeUuid, nodeName };
    const key = glbSelectionKey(entityId, nodeUuid);
    selectedGlbNodes.set(key, target);
    glbRangeAnchorKey = key;
  }

  store.subscribe((event) => {
    if (
      event.type === 'structure' ||
      event.type === 'document' ||
      event.type === 'selection' ||
      event.type === 'sub-selection' ||
      event.type === 'glb-tree' ||
      event.type === 'glb-visibility' ||
      event.type === 'entity'
    ) {
      if (event.type === 'sub-selection') {
        syncGlbSelectionFromStore(event.entityId, event.nodeUuid);
      } else if (event.type === 'glb-tree') {
        remapSelectedGlbNodes(event.entityId);
      }
      if (event.type === 'sub-selection' && event.entityId && event.nodeUuid) {
        ensureGlbExpanded(event.entityId, event.nodeUuid);
      }
      render();
      if (event.type === 'selection' || event.type === 'sub-selection') {
        scrollSelectionIntoView();
      }
    }
  });
  const initialSub = store.getSubSelection();
  if (initialSub?.entityId && initialSub.nodeUuid) {
    syncGlbSelectionFromStore(initialSub.entityId, initialSub.nodeUuid);
    ensureGlbExpanded(initialSub.entityId, initialSub.nodeUuid);
  }
  autoExpandForFilters();
  render();
  scrollSelectionIntoView();
}
