import {
  clearChildren,
  closeContextMenu,
  el,
  type ContextMenuPanel,
} from '../dom';
import { entityBoundToAnyGlbNode, entityTargetsGlbNode } from '../glb_binding';
import type { EditorEntity, EditorStore, GlbNodeRef } from '../document';
import type { GlbNodeColliderTarget } from '../component_actions';
import type { Vec3 } from '../../types';

export const GLB_NODE_DND_TYPE = 'application/x-claudecitizen-glb-node';

export interface HierarchyPanelOptions {
  getGlbNodePrefabPosition?: (entityId: string, nodeUuid: string) => Vec3 | null;
  getGlbNodeBounds?: (entityId: string, nodeUuid: string) => { min: Vec3; max: Vec3 } | null;
  onDuplicateGlbNode?: (entityId: string, nodeUuid: string) => void;
  onExtractGlbNode?: (
    entityId: string,
    nodeUuid: string,
    targetParentId: string | null,
  ) => boolean;
}

export interface DraggedGlbNode {
  entityId: string;
  nodeUuid: string;
}

export function parseDraggedGlbNode(data: string): DraggedGlbNode | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Partial<DraggedGlbNode>;
    if (typeof parsed.entityId === 'string' && typeof parsed.nodeUuid === 'string') {
      return { entityId: parsed.entityId, nodeUuid: parsed.nodeUuid };
    }
  } catch {
    // Ignore malformed external drag payloads.
  }
  return null;
}

export function parseDraggedEntityIds(data: string): string[] {
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

export function idsToReparent(draggedIds: string[], store: EditorStore): string[] {
  if (draggedIds.length === 0) return [];
  const primary = draggedIds[0];
  return store.isEntitySelected(primary) ? store.getSelectedIds() : draggedIds;
}

export function componentBadge(entity: EditorEntity): string | null {
  if (entity.components.length === 0) return null;
  if (entity.components.length === 1) return entity.components[0].type;
  return `${entity.components.length} components`;
}

export function collectExpandUuids(
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

export function collectGlbNodeUuids(node: GlbNodeRef, out: Set<string>): void {
  out.add(node.uuid);
  for (const child of node.children) {
    collectGlbNodeUuids(child, out);
  }
}

export function findGlbNodeByName(node: GlbNodeRef, name: string): GlbNodeRef | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findGlbNodeByName(child, name);
    if (found) return found;
  }
  return null;
}

export function collectUsedComponentTypes(roots: readonly EditorEntity[]): string[] {
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

export function glbSelectionKey(entityId: string, nodeUuid: string): string {
  return `${entityId}::${nodeUuid}`;
}

export function glbTarget(entityId: string, node: GlbNodeRef): GlbNodeColliderTarget {
  return { entityId, nodeUuid: node.uuid, nodeName: node.name };
}

export function collectEntitySubtreeIds(
  store: EditorStore,
  entityId: string,
  out: Set<string>,
): void {
  const entity = store.locate(entityId)?.entity;
  if (!entity || out.has(entity.id)) return;
  out.add(entity.id);
  for (const child of entity.children) collectEntitySubtreeIds(store, child.id, out);
}

export function nodeIsSelfOrDescendant(node: GlbNodeRef, targetUuid: string): boolean {
  if (node.uuid === targetUuid) return true;
  for (const child of node.children) {
    if (nodeIsSelfOrDescendant(child, targetUuid)) return true;
  }
  return false;
}

export function glbNodeIsAncestorOrSelf(
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

export function getAllGlbNodeNames(tree: GlbNodeRef | null): Set<string> {
  const names = new Set<string>();
  if (!tree) return names;
  const traverse = (node: GlbNodeRef): void => {
    names.add(node.name);
    for (const child of node.children) traverse(child);
  };
  traverse(tree);
  return names;
}

export function getBoundEntitiesForNode(
  store: EditorStore,
  entityId: string,
  nodeName: string,
): EditorEntity[] {
  const parentEntity = store.locate(entityId)?.entity;
  if (!parentEntity) return [];
  return parentEntity.children.filter((child) => entityTargetsGlbNode(child, nodeName));
}

export function getNodeOverrideComponentBadge(
  store: EditorStore,
  entityId: string,
  nodeName: string,
): string | null {
  const entity = store.locate(entityId)?.entity;
  if (!entity) return null;
  const override = entity.glbNodeTransforms.find((o) => o.nodeName === nodeName);
  if (!override || override.components.length === 0) return null;
  if (override.components.length === 1) return override.components[0].type;
  return `${override.components.length} components`;
}

export function isEntityBoundToGlb(
  child: EditorEntity,
  glbNodeNames: Set<string>,
): boolean {
  return entityBoundToAnyGlbNode(child, glbNodeNames);
}

export function entityPassesFilters(
  entity: EditorEntity,
  searchQuery: string,
  componentFilter: string,
): boolean {
  const nameOk = !searchQuery || entity.name.toLowerCase().includes(searchQuery);
  const componentOk =
    !componentFilter ||
    entity.components.some((component) => component.type === componentFilter);
  return nameOk && componentOk;
}

export function glbNodePassesFilters(
  store: EditorStore,
  entityId: string,
  node: GlbNodeRef,
  searchQuery: string,
  componentFilter: string,
): boolean {
  const nameOk = !searchQuery || node.name.toLowerCase().includes(searchQuery);
  if (!componentFilter) return nameOk;
  const entity = store.locate(entityId)?.entity;
  const override = entity?.glbNodeTransforms.find((entry) => entry.nodeName === node.name);
  const componentOk =
    override?.components.some((component) => component.type === componentFilter) ?? false;
  return nameOk && componentOk;
}

export function glbSubtreeHasMatch(
  store: EditorStore,
  entityId: string,
  node: GlbNodeRef,
  searchQuery: string,
  componentFilter: string,
): boolean {
  if (glbNodePassesFilters(store, entityId, node, searchQuery, componentFilter)) return true;

  const bound = getBoundEntitiesForNode(store, entityId, node.name);
  for (const boundEntity of bound) {
    if (entitySubtreeHasMatch(store, boundEntity, searchQuery, componentFilter)) return true;
  }

  for (const child of node.children) {
    if (glbSubtreeHasMatch(store, entityId, child, searchQuery, componentFilter)) return true;
  }

  return false;
}

export function entitySubtreeHasMatch(
  store: EditorStore,
  entity: EditorEntity,
  searchQuery: string,
  componentFilter: string,
): boolean {
  if (entityPassesFilters(entity, searchQuery, componentFilter)) return true;

  const glbTree = store.getGlbTree(entity.id);
  const glbNodeNames = getAllGlbNodeNames(glbTree);

  if (glbTree && glbSubtreeHasMatch(store, entity.id, glbTree, searchQuery, componentFilter)) {
    return true;
  }

  for (const child of entity.children) {
    if (isEntityBoundToGlb(child, glbNodeNames)) continue;
    if (entitySubtreeHasMatch(store, child, searchQuery, componentFilter)) return true;
  }

  return false;
}

export function glbSubtreeHasDescendantMatch(
  store: EditorStore,
  entityId: string,
  node: GlbNodeRef,
  searchQuery: string,
  componentFilter: string,
): boolean {
  const bound = getBoundEntitiesForNode(store, entityId, node.name);
  for (const boundEntity of bound) {
    if (entitySubtreeHasMatch(store, boundEntity, searchQuery, componentFilter)) return true;
  }

  for (const child of node.children) {
    if (glbSubtreeHasMatch(store, entityId, child, searchQuery, componentFilter)) return true;
  }

  return false;
}

export function findEntityAncestorIds(
  roots: readonly EditorEntity[],
  entityId: string,
): string[] | null {
  const findPath = (
    entities: readonly EditorEntity[],
    ancestors: readonly string[],
  ): string[] | null => {
    for (const entity of entities) {
      if (entity.id === entityId) return [...ancestors];
      const found = findPath(entity.children, [...ancestors, entity.id]);
      if (found) return found;
    }
    return null;
  };
  return findPath(roots, []);
}

export function filterBaseName(name: string): string {
  return name.replace(/[\s_]*\(\d+\)$/, '').trim() || name.trim();
}

export type GlbClickSelectionResult = {
  nextSelection: Map<string, GlbNodeColliderTarget>;
  nextAnchorKey: string | null;
  primaryTarget: GlbNodeColliderTarget | null;
  primaryFallbackEntityId?: string;
  /** When true, call setPrimaryGlbSelection with primaryTarget / fallback. */
  updatePrimary: boolean;
};

/** Pure multi-select / range logic for GLB hierarchy clicks. */
export function resolveGlbClickSelection(
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  target: GlbNodeColliderTarget,
  previous: ReadonlyMap<string, GlbNodeColliderTarget>,
  glbRangeAnchorKey: string | null,
  visibleGlbNodes: readonly GlbNodeColliderTarget[],
  currentPrimary: { entityId: string; nodeUuid: string } | null,
): GlbClickSelectionResult {
  const key = glbSelectionKey(target.entityId, target.nodeUuid);

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
      const nextSelection = new Map<string, GlbNodeColliderTarget>();
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      for (const candidate of visibleGlbNodes.slice(start, end + 1)) {
        nextSelection.set(
          glbSelectionKey(candidate.entityId, candidate.nodeUuid),
          candidate,
        );
      }
      return {
        nextSelection,
        nextAnchorKey: glbRangeAnchorKey,
        primaryTarget: target,
        updatePrimary: true,
      };
    }
    return {
      nextSelection: new Map([[key, target]]),
      nextAnchorKey: key,
      primaryTarget: target,
      updatePrimary: true,
    };
  }

  if (event.ctrlKey || event.metaKey) {
    const nextSelection = new Map(previous);
    if (nextSelection.has(key)) {
      nextSelection.delete(key);
      if (nextSelection.size === 0) {
        return {
          nextSelection,
          nextAnchorKey: key,
          primaryTarget: null,
          primaryFallbackEntityId: target.entityId,
          updatePrimary: true,
        };
      }
      if (
        currentPrimary?.entityId === target.entityId &&
        currentPrimary.nodeUuid === target.nodeUuid
      ) {
        return {
          nextSelection,
          nextAnchorKey: key,
          primaryTarget: [...nextSelection.values()].at(-1) ?? null,
          primaryFallbackEntityId: target.entityId,
          updatePrimary: true,
        };
      }
      return {
        nextSelection,
        nextAnchorKey: key,
        primaryTarget: null,
        updatePrimary: false,
      };
    }
    nextSelection.set(key, target);
    return {
      nextSelection,
      nextAnchorKey: key,
      primaryTarget: target,
      updatePrimary: true,
    };
  }

  return {
    nextSelection: new Map([[key, target]]),
    nextAnchorKey: key,
    primaryTarget: target,
    updatePrimary: true,
  };
}

/** DOM “Move To” flyout used by hierarchy context menus. */
export function createMoveToPanel(
  store: EditorStore,
  onMove: (parentId: string | null) => void,
  excludedIds = new Set<string>(),
): ContextMenuPanel {
  const destinations: { id: string | null; label: string; searchText: string }[] = [
    { id: null, label: 'Scene Root', searchText: 'scene root' },
  ];
  const walk = (entities: readonly EditorEntity[], parentPath: string[]): void => {
    for (const entity of entities) {
      const path = [...parentPath, entity.name];
      if (!excludedIds.has(entity.id)) {
        destinations.push({
          id: entity.id,
          label: path.join(' / '),
          searchText: path.join(' ').toLowerCase(),
        });
      }
      walk(entity.children, path);
    }
  };
  walk(store.getState().roots, []);

  const panel = el('div', { className: 'ed-move-to-panel' }) as ContextMenuPanel;
  const list = el('div', { className: 'ed-open-list' });
  let visibleDestinations = destinations;

  const moveTo = (destination: (typeof destinations)[number]): void => {
    closeContextMenu();
    onMove(destination.id);
  };

  const renderDestinations = (): void => {
    const query = searchInput.value.trim().toLowerCase();
    visibleDestinations = query
      ? destinations.filter((destination) => destination.searchText.includes(query))
      : destinations;
    clearChildren(list);
    if (visibleDestinations.length === 0) {
      list.append(el('div', { className: 'ed-open-empty', text: 'No objects found' }));
      return;
    }
    for (const destination of visibleDestinations) {
      list.append(
        el('button', {
          className: 'ed-menu-item',
          text: destination.label,
          title: destination.label,
          on: {
            click: (event) => {
              event.stopPropagation();
              moveTo(destination);
            },
          },
        }),
      );
    }
  };

  const searchInput = el('input', {
    className: 'ed-input ed-open-search',
    attrs: {
      type: 'text',
      placeholder: 'Search objects…',
      autocomplete: 'off',
    },
    on: {
      input: renderDestinations,
      keydown: (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Enter' && visibleDestinations[0]) {
          keyboardEvent.preventDefault();
          moveTo(visibleDestinations[0]);
        }
        event.stopPropagation();
      },
    },
  }) as HTMLInputElement;

  panel.append(el('div', { className: 'ed-open-search-wrap' }, [searchInput]), list);
  panel.focusSearch = () => searchInput.focus();
  renderDestinations();
  return panel;
}
