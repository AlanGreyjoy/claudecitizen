import { clearChildren, el, showContextMenu, type ContextMenuEntry } from '../dom';
import { createEmptyEntity, type EditorEntity, type EditorStore } from '../document';

const ENTITY_DND_TYPE = 'application/x-claudecitizen-entity';

function componentBadge(entity: EditorEntity): string | null {
  if (entity.components.length === 0) return null;
  if (entity.components.length === 1) return entity.components[0].type;
  return `${entity.components.length} components`;
}

export function createHierarchyPanel(container: HTMLElement, store: EditorStore): void {
  const body = el('div', { className: 'ed-panel-body' });
  container.append(
    el('div', { className: 'ed-panel-title' }, [
      el('span', { text: 'Hierarchy' }),
      el('span', { className: 'ed-label', text: 'drag to reparent' }),
    ]),
    body,
  );

  let renaming: string | null = null;

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

  function entityMenuEntries(entity: EditorEntity): ContextMenuEntry[] {
    return [
      { label: 'Add Child Empty', action: () => addEmptyTo(entity.id) },
      { label: 'Add Child Box', action: () => addBoxTo(entity.id) },
      'sep',
      { label: 'Rename', action: () => beginRename(entity.id) },
      { label: 'Duplicate', action: () => store.duplicateEntity(entity.id) },
      { label: entity.visible ? 'Hide' : 'Show', action: () => store.setVisible(entity.id, !entity.visible) },
      'sep',
      { label: 'Delete', action: () => store.deleteEntity(entity.id) },
    ];
  }

  function renderRow(entity: EditorEntity, depth: number, rows: HTMLElement[]): void {
    const selected = store.getSelection() === entity.id;
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
        className: `ed-tree-row${selected ? ' is-selected' : ''}`,
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

    for (const child of entity.children) renderRow(child, depth + 1, rows);
  }

  // Right-click on blank panel space adds at the root level.
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
          store.reparentEntity(draggedId, null); // dropped on blank space → move to root
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
      event.type === 'entity'
    ) {
      render();
    }
  });
  render();
}
