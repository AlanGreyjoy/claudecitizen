import { useCallback } from 'react';
import {
  addColliderShapeMenuEntries,
  addColliderToEntities,
  addColliderToGlbNodes,
  buildCreateObjectMenu,
  buildEntityComponentsSubmenu,
  buildGlbAuthoringMenu,
  collectComponentTypesOnEntities,
  collectComponentTypesOnGlbNodes,
  removeComponentTypeFromEntities,
  removeComponentTypeFromGlbNodes,
  removeComponentTypeMenuEntries,
  type GlbNodeColliderTarget,
} from '../../../component-actions';
import type { EditorEntity, EditorStore, GlbNodeRef } from '../../../document';
import { showToast, type ContextMenuEntry } from '../../../dom';
import { PREFAB_KINDS, type PrefabKind } from '../../../../world/prefabs/schema';
import {
  collectEntitySubtreeIds,
  createMoveToPanel,
} from '../../../panels/hierarchy-logic';
import type { Vec3 } from '../../../../types';
import type { HierarchyPanelOptions } from '../../../panels/hierarchy-logic';

function copyNameToClipboard(name: string): void {
  void navigator.clipboard.writeText(name).then(
    () => showToast(`Copied "${name}"`),
    () => showToast('Could not copy to clipboard', true),
  );
}

export type HierarchyMenusArgs = {
  store: EditorStore;
  addEmptyTo: (parentId: string | null) => void;
  addBoxTo: (parentId: string | null) => void;
  beginRename: (entityId: string) => void;
  createPrefab: (entityId: string, kind: PrefabKind) => Promise<void>;
  filterByItemName: (name: string) => void;
  spawnPositionForEntity: (entityId: string) => (() => Vec3 | null) | undefined;
  getViewFocusPosition: HierarchyPanelOptions['getViewFocusPosition'];
  getGlbNodePrefabPosition: HierarchyPanelOptions['getGlbNodePrefabPosition'];
  getGlbNodeBounds: HierarchyPanelOptions['getGlbNodeBounds'];
  onDuplicateGlbNode: HierarchyPanelOptions['onDuplicateGlbNode'];
  onExtractGlbNode: HierarchyPanelOptions['onExtractGlbNode'];
};

export function useHierarchyMenus(args: HierarchyMenusArgs) {
  const {
    store,
    addEmptyTo,
    addBoxTo,
    beginRename,
    createPrefab,
    filterByItemName,
    spawnPositionForEntity,
    getViewFocusPosition,
    getGlbNodePrefabPosition,
    getGlbNodeBounds,
    onDuplicateGlbNode,
    onExtractGlbNode,
  } = args;

  /**
   * "Create" submenu for a parent. Spawns at the selected GLB node when one is
   * sub-selected, otherwise at what the Scene view is centred on.
   */
  const createObjectEntries = useCallback(
    (parentId: string | null): ContextMenuEntry[] => {
      const nodePosition = parentId
        ? (spawnPositionForEntity(parentId)?.() ?? null)
        : null;
      const position =
        nodePosition ?? getViewFocusPosition?.(parentId) ?? undefined;
      return buildCreateObjectMenu(store, parentId, position);
    },
    [getViewFocusPosition, spawnPositionForEntity, store],
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
        {
          label: 'Copy Name',
          action: () => copyNameToClipboard(entity.name),
        },
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
      { label: 'Create Child', children: createObjectEntries(entity.id) },
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
      {
        label: 'Create Prefab from Selection',
        children: PREFAB_KINDS.map((kind) => ({
          label: kind,
          action: () => void createPrefab(entity.id, kind),
        })),
      },
      { label: 'Filter', action: () => filterByItemName(entity.name) },
      {
        label: 'Copy Name',
        action: () => copyNameToClipboard(entity.name),
      },
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
    createObjectEntries,
    createPrefab,
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

  return { createObjectEntries, entityMenuEntries, glbMenuEntries };
}
