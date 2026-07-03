import { clearChildren, el } from '../dom';
import { slugifyPrefabName, PREFAB_KINDS, type PrefabKind } from '../../world/prefabs/schema';
import type { EditorEntity, EditorStore } from '../document';

export type ToolbarGizmoMode = 'translate' | 'rotate' | 'scale';

export interface ShipPreviewToggles {
  gearDown: boolean;
  rampDown: boolean;
  doorsOpen: Record<string, boolean>;
}

export interface ToolbarActions {
  onGizmoMode: (mode: ToolbarGizmoMode) => void;
  onGizmoSpace: (space: 'local' | 'world') => void;
  onSnapChange: (enabled: boolean, translateStep: number, rotateStepDegrees: number) => void;
  onAddBox: () => void;
  onAddEmpty: () => void;
  onNew: () => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onPreview: () => void;
  onExit: () => void;
  /** Ship kind: editor-viewport articulation preview (gear / ramp / doors). */
  onShipPreviewChange: (state: ShipPreviewToggles) => void;
}

export interface ToolbarHandle {
  setGizmoMode: (mode: ToolbarGizmoMode) => void;
  setPrefabOptions: (ids: string[]) => void;
}

type MenuAction = {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: () => boolean;
  accent?: boolean;
};

type MenuEntry = MenuAction | 'sep' | { heading: string } | { submenu: string; items: MenuAction[] | (() => MenuAction[]) };

function closeAllMenus(menubar: HTMLElement): void {
  for (const menu of menubar.querySelectorAll('.ed-menu.is-open')) {
    menu.classList.remove('is-open');
  }
}

function createMenuItem(
  entry: MenuAction,
  menubar: HTMLElement,
  onActivate?: () => void,
): HTMLButtonElement {
  const button = el(
    'button',
    {
      className: `ed-menu-item${entry.accent ? ' is-accent' : ''}`,
      on: {
        click: () => {
          if (entry.disabled?.()) return;
          entry.action?.();
          onActivate?.();
          closeAllMenus(menubar);
        },
      },
    },
    [
      el('span', { className: 'ed-menu-item-label', text: entry.label }),
      entry.shortcut ? el('span', { className: 'ed-menu-item-shortcut', text: entry.shortcut }) : '',
    ].filter(Boolean) as HTMLElement[],
  );
  const refreshDisabled = (): void => {
    button.disabled = entry.disabled?.() ?? false;
  };
  refreshDisabled();
  button.dataset.refreshDisabled = 'true';
  (button as HTMLButtonElement & { refreshDisabled?: () => void }).refreshDisabled = refreshDisabled;
  return button;
}

function createMenuDropdown(
  entries: MenuEntry[] | (() => MenuEntry[]),
  menubar: HTMLElement,
  refreshDisabled?: () => void,
): HTMLElement {
  const dropdown = el('div', { className: 'ed-menu-dropdown' });
  const render = (): void => {
    clearChildren(dropdown);
    const list = typeof entries === 'function' ? entries() : entries;
    for (const entry of list) {
      if (entry === 'sep') {
        dropdown.append(el('div', { className: 'ed-menu-sep' }));
        continue;
      }
      if ('heading' in entry) {
        dropdown.append(el('div', { className: 'ed-menu-heading', text: entry.heading }));
        continue;
      }
      if ('submenu' in entry) {
        const submenuWrap = el('div', { className: 'ed-menu-submenu' });
        const trigger = el('button', { className: 'ed-menu-item ed-menu-submenu-trigger' }, [
          el('span', { className: 'ed-menu-item-label', text: entry.submenu }),
          el('span', { className: 'ed-menu-item-shortcut', text: '▸' }),
        ]);
        const flyout = createMenuDropdown(entry.items, menubar, refreshDisabled);
        flyout.classList.add('ed-menu-flyout');
        submenuWrap.append(trigger, flyout);
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          const wasOpen = submenuWrap.classList.contains('is-open');
          for (const node of submenuWrap.parentElement?.querySelectorAll('.ed-menu-submenu') ?? []) {
            node.classList.remove('is-open');
          }
          if (!wasOpen) submenuWrap.classList.add('is-open');
        });
        dropdown.append(submenuWrap);
        continue;
      }
      dropdown.append(createMenuItem(entry, menubar, refreshDisabled));
    }
  };
  render();
  (dropdown as HTMLElement & { rerender?: () => void }).rerender = render;
  return dropdown;
}

function createMenu(
  label: string,
  entries: MenuEntry[] | (() => MenuEntry[]),
  menubar: HTMLElement,
  refreshDisabled?: () => void,
): HTMLElement {
  const menu = el('div', { className: 'ed-menu' });
  const trigger = el('button', { className: 'ed-menu-trigger', text: label });
  const dropdown = createMenuDropdown(entries, menubar, refreshDisabled);
  menu.append(trigger, dropdown);
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = menu.classList.contains('is-open');
    closeAllMenus(menubar);
    if (!wasOpen) menu.classList.add('is-open');
  });
  return menu;
}

function createMenubar(
  menus: { label: string; entries: MenuEntry[] | (() => MenuEntry[]) }[],
  refreshDisabled?: () => void,
): HTMLElement {
  const menubar = el('div', { className: 'ed-menubar' });
  for (const menu of menus) {
    menubar.append(createMenu(menu.label, menu.entries, menubar, refreshDisabled));
  }
  document.addEventListener('click', () => closeAllMenus(menubar));
  menubar.addEventListener('click', (event) => event.stopPropagation());
  return menubar;
}

function refreshMenuDisabled(menubar: HTMLElement): void {
  for (const button of menubar.querySelectorAll<HTMLButtonElement>('button[data-refresh-disabled="true"]')) {
    (button as HTMLButtonElement & { refreshDisabled?: () => void }).refreshDisabled?.();
  }
}

function rerenderMenus(menubar: HTMLElement): void {
  for (const dropdown of menubar.querySelectorAll<HTMLElement & { rerender?: () => void }>('.ed-menu-dropdown')) {
    dropdown.rerender?.();
  }
  refreshMenuDisabled(menubar);
}

export function createToolbar(
  containers: { doc: HTMLElement; viewport: HTMLElement },
  store: EditorStore,
  actions: ToolbarActions,
): ToolbarHandle {
  // -- gizmo group --
  const modeButtons = new Map<ToolbarGizmoMode, HTMLButtonElement>();
  const modeGroup = el('div', { className: 'ed-toolbar-group' });
  const modes: [ToolbarGizmoMode, string, string][] = [
    ['translate', 'Move', 'W'],
    ['rotate', 'Rotate', 'E'],
    ['scale', 'Scale', 'R'],
  ];
  for (const [mode, label, key] of modes) {
    const button = el('button', {
      className: `ed-btn${mode === 'translate' ? ' is-active' : ''}`,
      text: label,
      title: `${label} (${key})`,
      on: { click: () => setGizmoMode(mode, true) },
    });
    modeButtons.set(mode, button);
    modeGroup.append(button);
  }

  let space: 'local' | 'world' = 'world';
  const spaceButton = el('button', {
    className: 'ed-btn',
    text: 'World',
    title: 'Toggle gizmo space',
    on: {
      click: () => {
        space = space === 'world' ? 'local' : 'world';
        spaceButton.textContent = space === 'world' ? 'World' : 'Local';
        actions.onGizmoSpace(space);
      },
    },
  });
  modeGroup.append(spaceButton);

  function setGizmoMode(mode: ToolbarGizmoMode, notify: boolean): void {
    for (const [key, button] of modeButtons) button.classList.toggle('is-active', key === mode);
    if (notify) actions.onGizmoMode(mode);
  }

  // -- snap group --
  const snapCheckbox = el('input', { attrs: { type: 'checkbox' } });
  snapCheckbox.checked = true;
  const snapStepInput = el('input', {
    className: 'ed-input ed-input-narrow',
    attrs: { type: 'number', step: '0.05', min: '0.01', value: '0.25' },
    title: 'Translate snap (m)',
  });
  const snapRotateInput = el('input', {
    className: 'ed-input ed-input-narrow',
    attrs: { type: 'number', step: '5', min: '1', value: '15' },
    title: 'Rotate snap (deg)',
  });
  const emitSnap = (): void =>
    actions.onSnapChange(
      snapCheckbox.checked,
      Number(snapStepInput.value) || 0.25,
      Number(snapRotateInput.value) || 15,
    );
  snapCheckbox.addEventListener('change', emitSnap);
  snapStepInput.addEventListener('change', emitSnap);
  snapRotateInput.addEventListener('change', emitSnap);

  const snapGroup = el('div', { className: 'ed-toolbar-group' }, [
    el('label', { className: 'ed-checkbox-row', title: 'Hold Ctrl to invert while dragging' }, [
      snapCheckbox,
      el('span', { text: 'Snap' }),
    ]),
    snapStepInput,
    el('span', { className: 'ed-label', text: 'm' }),
    snapRotateInput,
    el('span', { className: 'ed-label', text: 'deg' }),
  ]);

  // -- add group --
  const addGroup = el('div', { className: 'ed-toolbar-group' }, [
    el('button', { className: 'ed-btn', text: '+ Box', on: { click: () => actions.onAddBox() } }),
    el('button', {
      className: 'ed-btn',
      text: '+ Empty',
      title: 'Empty entity for markers (spawn, elevator, walk volume, ...)',
      on: { click: () => actions.onAddEmpty() },
    }),
  ]);

  // -- history group --
  const undoBtn = el('button', {
    className: 'ed-btn',
    text: '⟲ Undo',
    on: { click: () => store.undo() },
  });
  const redoBtn = el('button', {
    className: 'ed-btn',
    text: '⟳ Redo',
    on: { click: () => store.redo() },
  });
  const historyGroup = el('div', { className: 'ed-toolbar-group' }, [undoBtn, redoBtn]);

  function refreshHistoryButtons(): void {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
  }
  refreshHistoryButtons();

  // -- ship preview group (ship kind only) --
  const shipPreviewState: ShipPreviewToggles = { gearDown: true, rampDown: false, doorsOpen: {} };

  function emitShipPreview(): void {
    actions.onShipPreviewChange({
      gearDown: shipPreviewState.gearDown,
      rampDown: shipPreviewState.rampDown,
      doorsOpen: { ...shipPreviewState.doorsOpen },
    });
  }

  const gearBtn = el('button', {
    className: 'ed-btn is-active',
    text: 'Gear',
    title: 'Preview landing gear deployed / retracted',
    on: {
      click: () => {
        shipPreviewState.gearDown = !shipPreviewState.gearDown;
        gearBtn.classList.toggle('is-active', shipPreviewState.gearDown);
        emitShipPreview();
      },
    },
  });
  const rampBtn = el('button', {
    className: 'ed-btn',
    text: 'Ramp',
    title: 'Preview boarding ramp lowered / raised',
    on: {
      click: () => {
        shipPreviewState.rampDown = !shipPreviewState.rampDown;
        rampBtn.classList.toggle('is-active', shipPreviewState.rampDown);
        emitShipPreview();
      },
    },
  });
  const doorButtonsWrap = el('span', { className: 'ed-ship-doors' });
  const shipGroup = el('div', { className: 'ed-toolbar-group is-hidden' }, [
    el('span', { className: 'ed-label', text: 'Ship' }),
    gearBtn,
    rampBtn,
    doorButtonsWrap,
  ]);

  function collectShipDoors(): { id: string; label: string; defaultOpen: boolean }[] {
    const doors: { id: string; label: string; defaultOpen: boolean }[] = [];
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === 'ship-door' && !doors.some((door) => door.id === component.id)) {
            doors.push({
              id: component.id,
              label: component.label || component.id,
              defaultOpen: component.defaultOpen ?? false,
            });
          }
        }
        visit(entity.children);
      }
    };
    visit(store.getState().roots);
    return doors;
  }

  function refreshShipPreviewGroup(): void {
    const isShip = store.getState().kind === 'ship';
    shipGroup.classList.toggle('is-hidden', !isShip);
    if (!isShip) return;
    clearChildren(doorButtonsWrap);
    for (const door of collectShipDoors()) {
      const isOpen = shipPreviewState.doorsOpen[door.id] ?? door.defaultOpen;
      doorButtonsWrap.append(
        el('button', {
          className: `ed-btn${isOpen ? ' is-active' : ''}`,
          text: door.label,
          title: `Preview door "${door.id}" open / closed`,
          on: {
            click: () => {
              shipPreviewState.doorsOpen[door.id] = !isOpen;
              refreshShipPreviewGroup();
              emitShipPreview();
            },
          },
        }),
      );
    }
  }
  refreshShipPreviewGroup();

  // -- document menubar --
  let prefabIds: string[] = [];

  const nameInput = el('input', {
    className: 'ed-input ed-menubar-name',
    attrs: { type: 'text', value: store.getState().prefabName, placeholder: 'Prefab name' },
    title: 'Prefab name (id derives from it)',
    on: {
      change: () => {
        const prefabName = nameInput.value.trim() || 'Untitled Prefab';
        store.setPrefabMeta({ prefabName, prefabId: slugifyPrefabName(prefabName) });
      },
      keydown: (event) => event.stopPropagation(),
    },
  });

  const kindSelect = el('select', {
    className: 'ed-select ed-menubar-kind',
    title: 'Prefab kind',
    on: {
      change: () => store.setPrefabMeta({ kind: kindSelect.value as PrefabKind }),
    },
  });
  for (const kind of PREFAB_KINDS) {
    kindSelect.append(el('option', { text: kind, attrs: { value: kind } }));
  }

  const modeChip = el('span', {
    className: 'ed-mode-chip is-hidden',
    text: 'Ship Editor',
    title: 'Ship prefab: authoring the flyable ship (hull, walk zones, doors, pilot seat)',
  });

  function refreshModeChip(): void {
    modeChip.classList.toggle('is-hidden', store.getState().kind !== 'ship');
  }

  let menubar: HTMLElement;
  const refreshMenuState = (): void => refreshMenuDisabled(menubar);

  menubar = createMenubar(
    [
      {
        label: 'File',
        entries: [
          { label: 'New', action: () => actions.onNew() },
          {
            submenu: 'Open',
            items: () =>
              prefabIds.length === 0
                ? [{ label: 'No saved prefabs', disabled: () => true }]
                : prefabIds.map((id) => ({
                    label: id,
                    action: () => actions.onLoad(id),
                  })),
          },
          'sep',
          { label: 'Save', shortcut: 'Ctrl+S', accent: true, action: () => actions.onSave() },
          'sep',
          { label: 'Exit to Title', action: () => actions.onExit() },
        ],
      },
      {
        label: 'Edit',
        entries: [
          {
            label: 'Undo',
            shortcut: 'Ctrl+Z',
            action: () => store.undo(),
            disabled: () => !store.canUndo(),
          },
          {
            label: 'Redo',
            shortcut: 'Ctrl+Y',
            action: () => store.redo(),
            disabled: () => !store.canRedo(),
          },
          'sep',
          {
            label: 'Duplicate',
            shortcut: 'Ctrl+D',
            action: () => {
              const selection = store.getSelection();
              if (selection) store.duplicateEntity(selection);
            },
            disabled: () => !store.getSelection(),
          },
          {
            label: 'Delete',
            shortcut: 'Del',
            action: () => {
              const selection = store.getSelection();
              if (selection) store.deleteEntity(selection);
            },
            disabled: () => !store.getSelection(),
          },
        ],
      },
      {
        label: 'Game',
        entries: () => [
          {
            label:
              store.getState().kind === 'ship'
                ? 'Preview Ship'
                : store.getState().kind === 'station'
                  ? 'Preview Station'
                  : 'Preview in Play',
            accent: true,
            action: () => actions.onPreview(),
          },
        ],
      },
      {
        label: 'Help',
        entries: [
          { heading: 'Viewport' },
          { label: 'LMB — select / orbit', disabled: () => true },
          { label: 'MMB — pan', disabled: () => true },
          { label: 'Wheel — zoom', disabled: () => true },
          { label: 'RMB + WASD — fly', disabled: () => true },
          'sep',
          { heading: 'Gizmo' },
          { label: 'W / E / R — move / rotate / scale', disabled: () => true },
          { label: 'F — focus selection', disabled: () => true },
          'sep',
          { heading: 'Edit' },
          { label: 'Ctrl+S — save', disabled: () => true },
          { label: 'Ctrl+Z / Ctrl+Y — undo / redo', disabled: () => true },
          { label: 'Ctrl+D — duplicate', disabled: () => true },
          { label: 'Del — delete selection', disabled: () => true },
        ],
      },
    ],
    refreshMenuState,
  );

  const docStrip = el('div', { className: 'ed-menubar-doc' }, [
    el('span', { className: 'ed-label', text: 'Prefab' }),
    nameInput,
    kindSelect,
    modeChip,
  ]);
  refreshModeChip();

  const docBar = el('div', { className: 'ed-docbar' }, [menubar, docStrip]);

  const viewportBody = el('div', { className: 'ed-viewport-toolbar-body' }, [
    modeGroup,
    snapGroup,
    addGroup,
    historyGroup,
    shipGroup,
  ]);

  let collapsed = false;
  const toggleBtn = el('button', {
    className: 'ed-viewport-toolbar-toggle',
    text: '◂',
    title: 'Collapse tools',
    on: {
      click: () => {
        collapsed = !collapsed;
        containers.viewport.classList.toggle('is-collapsed', collapsed);
        toggleBtn.textContent = collapsed ? '▸ Tools' : '◂';
        toggleBtn.title = collapsed ? 'Expand tools' : 'Collapse tools';
      },
    },
  });

  containers.viewport.append(toggleBtn, viewportBody);
  containers.doc.append(docBar);

  store.subscribe((event) => {
    if (event.type === 'history') {
      refreshHistoryButtons();
      refreshMenuState();
    }
    if (event.type === 'selection') refreshMenuState();
    if (event.type === 'structure' || event.type === 'entity') {
      refreshShipPreviewGroup();
    }
    if (event.type === 'document') {
      const state = store.getState();
      if (document.activeElement !== nameInput) nameInput.value = state.prefabName;
      kindSelect.value = state.kind;
      refreshModeChip();
      refreshShipPreviewGroup();
      rerenderMenus(menubar);
    }
  });

  return {
    setGizmoMode: (mode) => setGizmoMode(mode, false),
    setPrefabOptions(ids) {
      prefabIds = ids;
      rerenderMenus(menubar);
    },
  };
}
