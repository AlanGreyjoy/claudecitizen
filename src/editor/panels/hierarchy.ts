import { clearChildren, el, showContextMenu, type ContextMenuEntry } from '../dom';
import { createEmptyEntity, type EditorEntity, type EditorStore, type GlbNodeRef } from '../document';
import {
  buildEntityComponentsSubmenu,
  buildGlbAuthoringMenu,
} from '../component_actions';
import type { Vec3 } from '../../types';

const ENTITY_DND_TYPE = 'application/x-claudecitizen-entity';

export interface HierarchyPanelOptions {
  getGlbNodePrefabPosition?: (entityId: string, nodeUuid: string) => Vec3 | null;
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

export function createHierarchyPanel(
  container: HTMLElement,
  store: EditorStore,
  options: HierarchyPanelOptions = {},
): void {
  const body = el('div', { className: 'ed-panel-body' });
  container.append(
    el('div', { className: 'ed-panel-title' }, [
      el('span', { text: 'Hierarchy' }),
      el('span', { className: 'ed-label', text: 'drag to reparent' }),
    ]),
    body,
  );

  let renaming: string | null = null;
  const expandedGlbEntities = new Set<string>();
  const expandedGlbNodes = new Set<string>();

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

  function entityMenuEntries(entity: EditorEntity): ContextMenuEntry[] {
    return [
      { label: 'Add Child Empty', action: () => addEmptyTo(entity.id) },
      { label: 'Add Child Box', action: () => addBoxTo(entity.id) },
      'sep',
      buildEntityComponentsSubmenu(store, entity.id, spawnPositionForEntity(entity.id)),
      'sep',
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

  function glbMenuEntries(entityId: string, node: GlbNodeRef): ContextMenuEntry[] {
    const getPosition =
      options.getGlbNodePrefabPosition ??
      (() => null);
    return [
      ...buildGlbAuthoringMenu(
        store,
        entityId,
        node.uuid,
        getPosition,
        node.name,
      ),
      'sep',
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
    const hasChildren = node.children.length > 0;
    const expanded = expandedGlbNodes.has(node.uuid);

    const toggle = hasChildren
      ? el('button', {
          className: `ed-tree-chevron${expanded ? ' is-expanded' : ''}`,
          text: expanded ? '▾' : '▸',
          title: expanded ? 'Collapse' : 'Expand',
          on: {
            click: (event) => {
              event.stopPropagation();
              if (expanded) expandedGlbNodes.delete(node.uuid);
              else expandedGlbNodes.add(node.uuid);
              render();
            },
          },
        })
      : el('span', { className: 'ed-tree-chevron-spacer' });

    const row = el(
      'div',
      {
        className: `ed-tree-row ed-tree-row-glb${selected ? ' is-selected' : ''}`,
        attrs: { 'data-glb-uuid': node.uuid, 'data-entity-id': entityId },
        on: {
          click: () => {
            ensureGlbExpanded(entityId, node.uuid);
            store.setSubSelection(entityId, node.uuid);
          },
          contextmenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            ensureGlbExpanded(entityId, node.uuid);
            store.setSubSelection(entityId, node.uuid);
            const mouse = event as MouseEvent;
            showContextMenu(mouse.clientX, mouse.clientY, glbMenuEntries(entityId, node));
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
      ],
    );
    row.style.paddingLeft = `${10 + depth * 14}px`;
    rows.push(row);

    if (hasChildren && expanded) {
      for (const child of node.children) {
        renderGlbRow(entityId, child, depth + 1, rows, isHidden);
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

    const sub = store.getSubSelection();
    if (sub?.entityId === entity.id || store.getSelection() === entity.id) {
      ensureGlbExpanded(entity.id, sub?.nodeUuid ?? null);
    }

    const expanded = expandedGlbEntities.has(entity.id);
    const toggle = el('button', {
      className: `ed-tree-chevron ed-tree-chevron-asset${expanded ? ' is-expanded' : ''}`,
      text: expanded ? '▾' : '▸',
      title: expanded ? 'Collapse model' : 'Expand model',
      on: {
        click: (event) => {
          event.stopPropagation();
          if (expanded) expandedGlbEntities.delete(entity.id);
          else expandedGlbEntities.add(entity.id);
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
            if (expanded) expandedGlbEntities.delete(entity.id);
            else expandedGlbEntities.add(entity.id);
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
    const selection = store.getSelection();
    const sub = store.getSubSelection();
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
        className: `ed-tree-row${selected ? ' is-selected' : ''}${parentSelected ? ' is-parent-selected' : ''}`,
        attrs: { draggable: 'true', 'data-entity-id': entity.id },
        on: {
          click: () => store.setSelection(entity.id),
          dblclick: () => beginRename(entity.id),
          contextmenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            store.setSelection(entity.id);
            const mouse = event as MouseEvent;
            showContextMenu(mouse.clientX, mouse.clientY, entityMenuEntries(entity));
          },
          dragstart: (event) => {
            (event as DragEvent).dataTransfer?.setData(ENTITY_DND_TYPE, entity.id);
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
            const draggedId = dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE);
            if (!draggedId || draggedId === entity.id) return;
            dragEvent.preventDefault();
            dragEvent.stopPropagation();
            store.reparentEntity(draggedId, entity.id);
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

    if (entity.asset && store.getGlbTree(entity.id)) {
      renderGlbSubtree(entity, depth + 1, rows);
    }

    for (const child of entity.children) renderRow(child, depth + 1, rows);
  }

  body.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Add Empty', action: () => addEmptyTo(null) },
      { label: 'Add Box', action: () => addBoxTo(null) },
    ]);
  });

  function render(): void {
    clearChildren(body);
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
          const draggedId = dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE);
          if (!draggedId) return;
          dragEvent.preventDefault();
          store.reparentEntity(draggedId, null);
        },
      },
    });
    const rows: HTMLElement[] = [];
    for (const entity of roots) renderRow(entity, 0, rows);
    tree.append(...rows);
    body.append(tree);
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
      if (event.type === 'sub-selection' && event.entityId && event.nodeUuid) {
        ensureGlbExpanded(event.entityId, event.nodeUuid);
      }
      render();
    }
  });
  render();
}
