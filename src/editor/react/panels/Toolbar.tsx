import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { PlanetListEntry, PrefabListEntry } from '../../api';
import type { EditorEntity, EditorStore } from '../../document';
import { MENU_CATALOG } from '../../menus/catalog';
import { slugifyPrefabName, PREFAB_KINDS, type PrefabKind } from '../../../world/prefabs/schema';
import { UiIcons } from '../../../ui/icons';
import { UiIcon } from '../UiIcon';
import { useEditorStore } from '../hooks';

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
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onPreviewPlanet: () => void;
  onExit: () => void;
  /** Ship kind: editor-viewport articulation preview (gear / ramp / doors). */
  onShipPreviewChange: (state: ShipPreviewToggles) => void;
  isPlanetAuthoring: () => boolean;
}

export interface ToolbarHandle {
  setGizmoMode: (mode: ToolbarGizmoMode) => void;
  setPrefabOptions: (entries: PrefabListEntry[]) => void;
  setPlanetOptions: (entries: PlanetListEntry[]) => void;
  /** Toggle a ship-door / animation open preview by id. */
  toggleDoorPreview: (doorId: string) => void;
}

export type ToolbarProps = {
  store: EditorStore;
  actions: ToolbarActions;
  /** Host for the floating viewport tools (class `ed-viewport-toolbar`). */
  viewportHost: HTMLElement;
};

type MenuAction = {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: () => boolean;
  accent?: boolean;
};

type MenuEntry =
  | MenuAction
  | 'sep'
  | { heading: string }
  | { submenu: string; items: MenuAction[] | (() => MenuAction[]) }
  | { submenu: string; panel: 'prefab' | 'planet' | 'menu' };

type AnimPreview = { id: string; label: string; defaultOpen: boolean };

type MenuSpec = { label: string; entries: MenuEntry[] | (() => MenuEntry[]) };

const GIZMO_MODES: ReadonlyArray<[ToolbarGizmoMode, string, string]> = [
  ['translate', 'Move', 'W'],
  ['rotate', 'Rotate', 'E'],
  ['scale', 'Scale', 'R'],
];

const HELP_ENTRIES: MenuEntry[] = [
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
];

function defaultActiveKind(prefabs: PrefabListEntry[]): PrefabKind {
  return PREFAB_KINDS.find((kind) => prefabs.some((entry) => entry.kind === kind)) ?? 'station';
}

function collectAnimations(roots: EditorEntity[]): AnimPreview[] {
  const list: AnimPreview[] = [];
  const visit = (entities: EditorEntity[]): void => {
    for (const entity of entities) {
      for (const component of entity.components) {
        if (component.type === 'ship-door' && !list.some((entry) => entry.id === component.id)) {
          list.push({
            id: component.id,
            label: component.label || component.id,
            defaultOpen: component.defaultOpen ?? false,
          });
        } else if (
          component.type === 'animation' &&
          !list.some((entry) => entry.id === component.id)
        ) {
          list.push({
            id: component.id,
            label: component.name || component.id,
            defaultOpen: component.defaultOpen ?? false,
          });
        }
      }
      visit(entity.children);
    }
  };
  visit(roots);
  return list;
}

function gamePreviewLabel(kind: PrefabKind, isPlanetAuthoring: boolean): string {
  if (isPlanetAuthoring) return 'Test Play';
  if (kind === 'ship') return 'Preview Ship';
  if (kind === 'station') return 'Preview Station';
  return 'Preview in Play';
}

function buildMenus(
  store: EditorStore,
  actions: ToolbarActions,
  previewLabel: string,
): MenuSpec[] {
  return [
    {
      label: 'File',
      entries: [
        { label: 'New', action: () => actions.onNew() },
        { submenu: 'Open', panel: 'prefab' },
        { submenu: 'Open Planets', panel: 'planet' },
        { submenu: 'Open Menus', panel: 'menu' },
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
          action: () => actions.onDuplicate(),
          disabled: () => store.getSelectedIds().length === 0,
        },
        {
          label: 'Delete',
          shortcut: 'Del',
          action: () => actions.onDelete(),
          disabled: () => store.getSelectedIds().length === 0,
        },
      ],
    },
    {
      label: 'Game',
      entries: () => [
        {
          label: previewLabel,
          accent: true,
          action: () => {
            if (actions.isPlanetAuthoring()) actions.onPreviewPlanet();
            else actions.onPreview();
          },
        },
      ],
    },
    { label: 'Help', entries: HELP_ENTRIES },
  ];
}

function OpenSearchField({
  inputRef,
  placeholder,
  value,
  onChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="ed-open-search-wrap">
      <input
        ref={inputRef}
        className="ed-input ed-open-search"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function useAutoFocus(autoFocus: boolean, inputRef: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);
}

function OpenPrefabPanel({
  prefabs,
  onSelect,
  autoFocus,
}: {
  prefabs: PrefabListEntry[];
  onSelect: (id: string) => void;
  autoFocus: boolean;
}): ReactElement {
  const [activeKind, setActiveKind] = useState<PrefabKind>(() => defaultActiveKind(prefabs));
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useAutoFocus(autoFocus, searchRef);

  useEffect(() => {
    if (!prefabs.some((entry) => entry.kind === activeKind)) {
      setActiveKind(defaultActiveKind(prefabs));
      setSearchQuery('');
    }
  }, [prefabs, activeKind]);

  const kinds = PREFAB_KINDS.filter((kind) => prefabs.some((entry) => entry.kind === kind));
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? prefabs.filter(
        (entry) =>
          entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query),
      )
    : prefabs.filter((entry) => entry.kind === activeKind);

  let emptyText: string | null = null;
  if (prefabs.length === 0) emptyText = 'No saved prefabs';
  else if (visible.length === 0) emptyText = query ? 'No matches' : `No ${activeKind} prefabs`;

  return (
    <div className="ed-open-panel">
      <OpenSearchField
        inputRef={searchRef}
        placeholder="Search prefabs…"
        value={searchQuery}
        onChange={setSearchQuery}
      />
      <div className={`ed-open-tabs${kinds.length <= 1 ? ' is-hidden' : ''}`}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`ed-open-tab${!query && kind === activeKind ? ' is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              setActiveKind(kind);
              setSearchQuery('');
            }}
          >
            {kind}
          </button>
        ))}
      </div>
      <div className="ed-open-list">
        {emptyText ? (
          <div className="ed-open-empty">{emptyText}</div>
        ) : (
          visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="ed-menu-item"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(entry.id);
              }}
            >
              <span className="ed-menu-item-label">
                {entry.name !== entry.id ? entry.name : entry.id}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function OpenPlanetPanel({
  planets,
  onSelect,
  autoFocus,
}: {
  planets: PlanetListEntry[];
  onSelect: (id: string) => void;
  autoFocus: boolean;
}): ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useAutoFocus(autoFocus, searchRef);
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? planets.filter(
        (entry) =>
          entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query),
      )
    : planets;

  return (
    <div className="ed-open-panel">
      <OpenSearchField
        inputRef={searchRef}
        placeholder="Search planets…"
        value={searchQuery}
        onChange={setSearchQuery}
      />
      <div className="ed-open-list">
        {visible.length === 0 ? (
          <div className="ed-open-empty">No planets found</div>
        ) : (
          visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="ed-open-item"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(entry.id);
              }}
            >
              <span className="ed-open-item-name">{entry.name}</span>
              <span className="ed-open-item-id">{entry.id}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function OpenMenuCatalogPanel({
  onSelect,
  autoFocus,
}: {
  onSelect: (id: string) => void;
  autoFocus: boolean;
}): ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useAutoFocus(autoFocus, searchRef);
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? MENU_CATALOG.filter(
        (entry) =>
          entry.id.toLowerCase().includes(query) ||
          entry.name.toLowerCase().includes(query) ||
          entry.description.toLowerCase().includes(query),
      )
    : MENU_CATALOG;

  return (
    <div className="ed-open-panel">
      <OpenSearchField
        inputRef={searchRef}
        placeholder="Search menus…"
        value={searchQuery}
        onChange={setSearchQuery}
      />
      <div className="ed-open-list">
        {visible.length === 0 ? (
          <div className="ed-open-empty">No menus found</div>
        ) : (
          visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="ed-open-item"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(entry.id);
              }}
            >
              <span className="ed-open-item-name">{entry.name}</span>
              <span className="ed-open-item-id">{entry.id}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MenuItemButton({
  entry,
  onActivate,
}: {
  entry: MenuAction;
  onActivate: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`ed-menu-item${entry.accent ? ' is-accent' : ''}`}
      disabled={entry.disabled?.() ?? false}
      onClick={() => {
        if (entry.disabled?.()) return;
        entry.action?.();
        onActivate();
      }}
    >
      <span className="ed-menu-item-label">{entry.label}</span>
      {entry.shortcut ? <span className="ed-menu-item-shortcut">{entry.shortcut}</span> : null}
    </button>
  );
}

function SubmenuFlyoutPanel({
  panel,
  isOpen,
  prefabs,
  planets,
  onLoadPrefab,
  onLoadPlanet,
  onOpenMenu,
  onCloseAll,
}: {
  panel: 'prefab' | 'planet' | 'menu';
  isOpen: boolean;
  prefabs: PrefabListEntry[];
  planets: PlanetListEntry[];
  onLoadPrefab: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
  onCloseAll: () => void;
}): ReactElement {
  return (
    <div className="ed-menu-dropdown ed-menu-flyout ed-open-flyout">
      {panel === 'prefab' ? (
        <OpenPrefabPanel
          prefabs={prefabs}
          autoFocus={isOpen}
          onSelect={(id) => {
            onLoadPrefab(id);
            onCloseAll();
          }}
        />
      ) : null}
      {panel === 'planet' ? (
        <OpenPlanetPanel
          planets={planets}
          autoFocus={isOpen}
          onSelect={(id) => {
            onLoadPlanet(id);
            onCloseAll();
          }}
        />
      ) : null}
      {panel === 'menu' ? (
        <OpenMenuCatalogPanel
          autoFocus={isOpen}
          onSelect={(id) => {
            onOpenMenu(id);
            onCloseAll();
          }}
        />
      ) : null}
    </div>
  );
}

function MenuSubmenu({
  entry,
  isOpen,
  onToggle,
  onCloseAll,
  prefabs,
  planets,
  onLoadPrefab,
  onLoadPlanet,
  onOpenMenu,
}: {
  entry: Extract<MenuEntry, { submenu: string }>;
  isOpen: boolean;
  onToggle: () => void;
  onCloseAll: () => void;
  prefabs: PrefabListEntry[];
  planets: PlanetListEntry[];
  onLoadPrefab: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
}): ReactElement {
  let flyout: ReactNode;
  if ('panel' in entry) {
    flyout = (
      <SubmenuFlyoutPanel
        panel={entry.panel}
        isOpen={isOpen}
        prefabs={prefabs}
        planets={planets}
        onLoadPrefab={onLoadPrefab}
        onLoadPlanet={onLoadPlanet}
        onOpenMenu={onOpenMenu}
        onCloseAll={onCloseAll}
      />
    );
  } else {
    const items = typeof entry.items === 'function' ? entry.items() : entry.items;
    flyout = (
      <div className="ed-menu-dropdown ed-menu-flyout">
        {items.map((item, itemIndex) => (
          <MenuItemButton key={`${item.label}-${itemIndex}`} entry={item} onActivate={onCloseAll} />
        ))}
      </div>
    );
  }

  return (
    <div className={`ed-menu-submenu${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ed-menu-item ed-menu-submenu-trigger"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span className="ed-menu-item-label">{entry.submenu}</span>
        <UiIcon icon={UiIcons.chevronRight} className="ed-ui-icon" size={14} strokeWidth={2} />
      </button>
      {flyout}
    </div>
  );
}

function MenuDropdown({
  entries,
  openSubmenu,
  onOpenSubmenu,
  onCloseAll,
  prefabs,
  planets,
  onLoadPrefab,
  onLoadPlanet,
  onOpenMenu,
}: {
  entries: MenuEntry[];
  openSubmenu: string | null;
  onOpenSubmenu: (id: string | null) => void;
  onCloseAll: () => void;
  prefabs: PrefabListEntry[];
  planets: PlanetListEntry[];
  onLoadPrefab: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
}): ReactElement {
  return (
    <div className="ed-menu-dropdown">
      {entries.map((entry, index) => {
        if (entry === 'sep') return <div key={`sep-${index}`} className="ed-menu-sep" />;
        if ('heading' in entry) {
          return (
            <div key={`heading-${entry.heading}-${index}`} className="ed-menu-heading">
              {entry.heading}
            </div>
          );
        }
        if ('submenu' in entry) {
          return (
            <MenuSubmenu
              key={`submenu-${entry.submenu}`}
              entry={entry}
              isOpen={openSubmenu === entry.submenu}
              onToggle={() =>
                onOpenSubmenu(openSubmenu === entry.submenu ? null : entry.submenu)
              }
              onCloseAll={onCloseAll}
              prefabs={prefabs}
              planets={planets}
              onLoadPrefab={onLoadPrefab}
              onLoadPlanet={onLoadPlanet}
              onOpenMenu={onOpenMenu}
            />
          );
        }
        return (
          <MenuItemButton
            key={`item-${entry.label}-${index}`}
            entry={entry}
            onActivate={onCloseAll}
          />
        );
      })}
    </div>
  );
}

function Menubar({
  menus,
  prefabs,
  planets,
  onLoadPrefab,
  onLoadPlanet,
  onOpenMenu,
}: {
  menus: ReadonlyArray<MenuSpec>;
  prefabs: PrefabListEntry[];
  planets: PlanetListEntry[];
  onLoadPrefab: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
}): ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const closeAll = useCallback(() => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  }, []);

  useEffect(() => {
    const onDocClick = (): void => closeAll();
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [closeAll]);

  return (
    <div className="ed-menubar" onClick={(event) => event.stopPropagation()}>
      {menus.map((menu) => {
        const isOpen = openMenu === menu.label;
        const entries = typeof menu.entries === 'function' ? menu.entries() : menu.entries;
        return (
          <div key={menu.label} className={`ed-menu${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="ed-menu-trigger"
              onClick={(event) => {
                event.stopPropagation();
                if (isOpen) closeAll();
                else {
                  setOpenMenu(menu.label);
                  setOpenSubmenu(null);
                }
              }}
            >
              {menu.label}
            </button>
            {isOpen ? (
              <MenuDropdown
                entries={entries}
                openSubmenu={openSubmenu}
                onOpenSubmenu={setOpenSubmenu}
                onCloseAll={closeAll}
                prefabs={prefabs}
                planets={planets}
                onLoadPrefab={onLoadPrefab}
                onLoadPlanet={onLoadPlanet}
                onOpenMenu={onOpenMenu}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PrefabMetaStrip({
  store,
  kind,
  nameDraft,
  onNameDraftChange,
  nameFocusedRef,
}: {
  store: EditorStore;
  kind: PrefabKind;
  nameDraft: string;
  onNameDraftChange: (value: string) => void;
  nameFocusedRef: React.MutableRefObject<boolean>;
}): ReactElement {
  return (
    <div className="ed-menubar-doc">
      <span className="ed-label">Prefab</span>
      <input
        className="ed-input ed-menubar-name"
        type="text"
        value={nameDraft}
        placeholder="Prefab name"
        title="Prefab name (id derives from it)"
        onFocus={() => {
          nameFocusedRef.current = true;
        }}
        onBlur={(event) => {
          nameFocusedRef.current = false;
          const prefabName = event.currentTarget.value.trim() || 'Untitled Prefab';
          onNameDraftChange(prefabName);
          if (prefabName !== store.getState().prefabName) {
            store.setPrefabMeta({ prefabName, prefabId: slugifyPrefabName(prefabName) });
          }
        }}
        onChange={(event) => onNameDraftChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <select
        className="ed-select ed-menubar-kind"
        title="Prefab kind"
        value={kind}
        onChange={(event) => store.setPrefabMeta({ kind: event.currentTarget.value as PrefabKind })}
      >
        {PREFAB_KINDS.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      <span
        className={`ed-mode-chip${kind === 'ship' ? '' : ' is-hidden'}`}
        title="Ship prefab: authoring the flyable ship (hull, deck colliders, doors, pilot seat)"
      >
        Ship Editor
      </span>
    </div>
  );
}

function GizmoModeGroup({
  gizmoMode,
  gizmoSpace,
  onMode,
  onSpace,
}: {
  gizmoMode: ToolbarGizmoMode;
  gizmoSpace: 'local' | 'world';
  onMode: (mode: ToolbarGizmoMode) => void;
  onSpace: () => void;
}): ReactElement {
  return (
    <div className="ed-toolbar-group">
      {GIZMO_MODES.map(([mode, label, key]) => (
        <button
          key={mode}
          type="button"
          className={`ed-btn${gizmoMode === mode ? ' is-active' : ''}`}
          title={`${label} (${key})`}
          onClick={() => onMode(mode)}
        >
          {label}
        </button>
      ))}
      <button type="button" className="ed-btn" title="Toggle gizmo space" onClick={onSpace}>
        {gizmoSpace === 'world' ? 'World' : 'Local'}
      </button>
    </div>
  );
}

function SnapGroup({
  snapEnabled,
  snapTranslate,
  snapRotate,
  onEnabled,
  onTranslate,
  onRotate,
  onCommit,
}: {
  snapEnabled: boolean;
  snapTranslate: string;
  snapRotate: string;
  onEnabled: (enabled: boolean) => void;
  onTranslate: (value: string) => void;
  onRotate: (value: string) => void;
  onCommit: () => void;
}): ReactElement {
  return (
    <div className="ed-toolbar-group">
      <label className="ed-checkbox-row" title="Hold Ctrl to invert while dragging">
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(event) => onEnabled(event.currentTarget.checked)}
        />
        <span>Snap</span>
      </label>
      <input
        className="ed-input ed-input-narrow"
        type="number"
        step={0.05}
        min={0.01}
        value={snapTranslate}
        title="Translate snap (m)"
        onChange={(event) => onTranslate(event.currentTarget.value)}
        onBlur={onCommit}
      />
      <span className="ed-label">m</span>
      <input
        className="ed-input ed-input-narrow"
        type="number"
        step={5}
        min={1}
        value={snapRotate}
        title="Rotate snap (deg)"
        onChange={(event) => onRotate(event.currentTarget.value)}
        onBlur={onCommit}
      />
      <span className="ed-label">deg</span>
    </div>
  );
}

function ShipPreviewGroup({
  isShip,
  visible,
  shipPreview,
  animations,
  onToggleGear,
  onToggleRamp,
  onToggleDoor,
}: {
  isShip: boolean;
  visible: boolean;
  shipPreview: ShipPreviewToggles;
  animations: AnimPreview[];
  onToggleGear: () => void;
  onToggleRamp: () => void;
  onToggleDoor: (id: string) => void;
}): ReactElement {
  return (
    <div className={`ed-toolbar-group${visible ? '' : ' is-hidden'}`}>
      <span className="ed-label">Ship</span>
      <button
        type="button"
        className={`ed-btn${shipPreview.gearDown ? ' is-active' : ''}`}
        title="Preview landing gear deployed / retracted"
        style={{ display: isShip ? undefined : 'none' }}
        onClick={onToggleGear}
      >
        Gear
      </button>
      <button
        type="button"
        className={`ed-btn${shipPreview.rampDown ? ' is-active' : ''}`}
        title="Preview boarding ramp lowered / raised"
        style={{ display: isShip ? undefined : 'none' }}
        onClick={onToggleRamp}
      >
        Ramp
      </button>
      <span className="ed-ship-doors">
        {animations.map((anim) => {
          const isOpen = shipPreview.doorsOpen[anim.id] ?? anim.defaultOpen;
          return (
            <button
              key={anim.id}
              type="button"
              className={`ed-btn${isOpen ? ' is-active' : ''}`}
              title={`Preview animation "${anim.id}" open / closed`}
              onClick={() => onToggleDoor(anim.id)}
            >
              {anim.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

type ViewportToolbarModel = {
  store: EditorStore;
  actions: ToolbarActions;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  gizmoMode: ToolbarGizmoMode;
  gizmoSpace: 'local' | 'world';
  onGizmoMode: (mode: ToolbarGizmoMode) => void;
  onGizmoSpace: () => void;
  snapEnabled: boolean;
  snapTranslate: string;
  snapRotate: string;
  onSnapEnabled: (enabled: boolean) => void;
  onSnapTranslate: (value: string) => void;
  onSnapRotate: (value: string) => void;
  onSnapCommit: () => void;
  isShip: boolean;
  showShipGroup: boolean;
  shipPreview: ShipPreviewToggles;
  animations: AnimPreview[];
  onToggleGear: () => void;
  onToggleRamp: () => void;
  onToggleDoor: (id: string) => void;
};

function ViewportToolbar(model: ViewportToolbarModel): ReactElement {
  const {
    store,
    actions,
    collapsed,
    onToggleCollapsed,
    gizmoMode,
    gizmoSpace,
    onGizmoMode,
    onGizmoSpace,
    snapEnabled,
    snapTranslate,
    snapRotate,
    onSnapEnabled,
    onSnapTranslate,
    onSnapRotate,
    onSnapCommit,
    isShip,
    showShipGroup,
    shipPreview,
    animations,
    onToggleGear,
    onToggleRamp,
    onToggleDoor,
  } = model;

  return (
    <>
      <button
        type="button"
        className="ed-viewport-toolbar-toggle"
        title={collapsed ? 'Expand tools' : 'Collapse tools'}
        onClick={onToggleCollapsed}
      >
        <UiIcon
          icon={collapsed ? UiIcons.chevronRight : UiIcons.chevronLeft}
          className="ed-ui-icon"
          size={14}
          strokeWidth={2}
        />
        {collapsed ? ' Tools' : null}
      </button>
      <div className="ed-viewport-toolbar-body">
        <GizmoModeGroup
          gizmoMode={gizmoMode}
          gizmoSpace={gizmoSpace}
          onMode={onGizmoMode}
          onSpace={onGizmoSpace}
        />
        <SnapGroup
          snapEnabled={snapEnabled}
          snapTranslate={snapTranslate}
          snapRotate={snapRotate}
          onEnabled={onSnapEnabled}
          onTranslate={onSnapTranslate}
          onRotate={onSnapRotate}
          onCommit={onSnapCommit}
        />
        <div className="ed-toolbar-group">
          <button type="button" className="ed-btn" onClick={() => actions.onAddBox()}>
            + Box
          </button>
          <button
            type="button"
            className="ed-btn"
            title="Empty entity for markers (spawn, elevator, collider, ...)"
            onClick={() => actions.onAddEmpty()}
          >
            + Empty
          </button>
        </div>
        <div className="ed-toolbar-group">
          <button type="button" className="ed-btn" disabled={!store.canUndo()} onClick={() => store.undo()}>
            ⟲ Undo
          </button>
          <button type="button" className="ed-btn" disabled={!store.canRedo()} onClick={() => store.redo()}>
            ⟳ Redo
          </button>
        </div>
        <ShipPreviewGroup
          isShip={isShip}
          visible={showShipGroup}
          shipPreview={shipPreview}
          animations={animations}
          onToggleGear={onToggleGear}
          onToggleRamp={onToggleRamp}
          onToggleDoor={onToggleDoor}
        />
      </div>
    </>
  );
}

function useToolbarController(
  store: EditorStore,
  actions: ToolbarActions,
  viewportHost: HTMLElement,
) {
  useEditorStore(store, ['document', 'history', 'selection', 'structure', 'entity']);
  const docState = store.getState();
  const [gizmoMode, setGizmoModeState] = useState<ToolbarGizmoMode>('translate');
  const [gizmoSpace, setGizmoSpace] = useState<'local' | 'world'>('world');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapTranslate, setSnapTranslate] = useState('0.25');
  const [snapRotate, setSnapRotate] = useState('15');
  const [collapsed, setCollapsed] = useState(false);
  const [prefabOptions, setPrefabOptions] = useState<PrefabListEntry[]>([]);
  const [planetOptions, setPlanetOptions] = useState<PlanetListEntry[]>([]);
  const [shipPreview, setShipPreview] = useState<ShipPreviewToggles>({
    gearDown: true,
    rampDown: false,
    doorsOpen: {},
  });
  const [nameDraft, setNameDraft] = useState(docState.prefabName);
  const nameFocusedRef = useRef(false);
  const shipPreviewRef = useRef(shipPreview);
  shipPreviewRef.current = shipPreview;

  useEffect(() => {
    if (!nameFocusedRef.current) setNameDraft(store.getState().prefabName);
  }, [docState.prefabName, store]);

  useEffect(() => {
    viewportHost.classList.toggle('is-collapsed', collapsed);
    return () => {
      viewportHost.classList.remove('is-collapsed');
    };
  }, [collapsed, viewportHost]);

  const emitShipPreview = useCallback(
    (next: ShipPreviewToggles) => {
      actions.onShipPreviewChange({
        gearDown: next.gearDown,
        rampDown: next.rampDown,
        doorsOpen: { ...next.doorsOpen },
      });
    },
    [actions],
  );

  const toggleDoorPreview = useCallback(
    (doorId: string) => {
      const anim = collectAnimations(store.getState().roots).find((entry) => entry.id === doorId);
      const current = shipPreviewRef.current.doorsOpen[doorId] ?? anim?.defaultOpen ?? false;
      const next: ShipPreviewToggles = {
        ...shipPreviewRef.current,
        doorsOpen: { ...shipPreviewRef.current.doorsOpen, [doorId]: !current },
      };
      setShipPreview(next);
      emitShipPreview(next);
    },
    [emitShipPreview, store],
  );

  const animations = useMemo(() => collectAnimations(docState.roots), [docState.roots]);
  const isShip = docState.kind === 'ship';
  const previewLabel = gamePreviewLabel(docState.kind, actions.isPlanetAuthoring());
  const menus = useMemo(
    () => buildMenus(store, actions, previewLabel),
    [actions, previewLabel, store],
  );

  const patchShip = useCallback(
    (patch: Partial<ShipPreviewToggles>) => {
      const next = { ...shipPreviewRef.current, ...patch };
      setShipPreview(next);
      emitShipPreview(next);
    },
    [emitShipPreview],
  );

  return {
    docState,
    gizmoMode,
    setGizmoModeState,
    gizmoSpace,
    setGizmoSpace,
    snapEnabled,
    setSnapEnabled,
    snapTranslate,
    setSnapTranslate,
    snapRotate,
    setSnapRotate,
    collapsed,
    setCollapsed,
    prefabOptions,
    setPrefabOptions,
    planetOptions,
    setPlanetOptions,
    shipPreview,
    nameDraft,
    setNameDraft,
    nameFocusedRef,
    animations,
    isShip,
    menus,
    toggleDoorPreview,
    patchShip,
  };
}

export const Toolbar = forwardRef<ToolbarHandle, ToolbarProps>(function Toolbar(
  { store, actions, viewportHost },
  ref,
): ReactElement {
  const ctrl = useToolbarController(store, actions, viewportHost);

  useImperativeHandle(
    ref,
    () => ({
      setGizmoMode: ctrl.setGizmoModeState,
      setPrefabOptions: ctrl.setPrefabOptions,
      setPlanetOptions: ctrl.setPlanetOptions,
      toggleDoorPreview: ctrl.toggleDoorPreview,
    }),
    [ctrl.setGizmoModeState, ctrl.setPrefabOptions, ctrl.setPlanetOptions, ctrl.toggleDoorPreview],
  );

  const emitSnap = (): void => {
    actions.onSnapChange(
      ctrl.snapEnabled,
      Number(ctrl.snapTranslate) || 0.25,
      Number(ctrl.snapRotate) || 15,
    );
  };

  return (
    <>
      <div className="ed-docbar">
        <Menubar
          menus={ctrl.menus}
          prefabs={ctrl.prefabOptions}
          planets={ctrl.planetOptions}
          onLoadPrefab={actions.onLoad}
          onLoadPlanet={actions.onLoadPlanet}
          onOpenMenu={actions.onOpenMenu}
        />
        <PrefabMetaStrip
          store={store}
          kind={ctrl.docState.kind}
          nameDraft={ctrl.nameDraft}
          onNameDraftChange={ctrl.setNameDraft}
          nameFocusedRef={ctrl.nameFocusedRef}
        />
      </div>
      {createPortal(
        <ViewportToolbar
          store={store}
          actions={actions}
          collapsed={ctrl.collapsed}
          onToggleCollapsed={() => ctrl.setCollapsed((value) => !value)}
          gizmoMode={ctrl.gizmoMode}
          gizmoSpace={ctrl.gizmoSpace}
          onGizmoMode={(mode) => {
            ctrl.setGizmoModeState(mode);
            actions.onGizmoMode(mode);
          }}
          onGizmoSpace={() => {
            const next = ctrl.gizmoSpace === 'world' ? 'local' : 'world';
            ctrl.setGizmoSpace(next);
            actions.onGizmoSpace(next);
          }}
          snapEnabled={ctrl.snapEnabled}
          snapTranslate={ctrl.snapTranslate}
          snapRotate={ctrl.snapRotate}
          onSnapEnabled={(enabled) => {
            ctrl.setSnapEnabled(enabled);
            actions.onSnapChange(
              enabled,
              Number(ctrl.snapTranslate) || 0.25,
              Number(ctrl.snapRotate) || 15,
            );
          }}
          onSnapTranslate={ctrl.setSnapTranslate}
          onSnapRotate={ctrl.setSnapRotate}
          onSnapCommit={emitSnap}
          isShip={ctrl.isShip}
          showShipGroup={ctrl.isShip || ctrl.animations.length > 0}
          shipPreview={ctrl.shipPreview}
          animations={ctrl.animations}
          onToggleGear={() => ctrl.patchShip({ gearDown: !ctrl.shipPreview.gearDown })}
          onToggleRamp={() => ctrl.patchShip({ rampDown: !ctrl.shipPreview.rampDown })}
          onToggleDoor={ctrl.toggleDoorPreview}
        />,
        viewportHost,
      )}
    </>
  );
});
