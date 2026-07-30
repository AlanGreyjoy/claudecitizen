import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import type { PlanetListEntry, PrefabListEntry, SceneListEntry } from '../../api';
import type { EditorEntity, EditorStore } from '../../document';
import { MENU_CATALOG } from '../../menus/catalog';
import { PREFAB_KINDS, type PrefabKind } from '../../../world/prefabs/schema';
import { UiIcons } from '../../../ui/icons';
import { UiIcon } from '../UiIcon';
import { useEditorStore } from '../hooks';
import {
  CANOPY_RATE_PER_SECOND,
  RAMP_RATE_PER_SECOND,
} from '../../../player/ship-rig';
import type { IconNode } from 'lucide';

export type ToolbarGizmoMode = 'translate' | 'rotate' | 'scale';

export type BrowsePanelKind = 'prefab' | 'scene' | 'planet' | 'menu';

export interface ShipPreviewToggles {
  gearDown: boolean;
  rampDown: boolean;
  canopyOpen: boolean;
  /** Continuous blend while the ramp preview plays; overrides `rampDown`. */
  ramp01?: number;
  /** Continuous blend while the canopy preview plays; overrides `canopyOpen`. */
  canopy01?: number;
  doorsOpen: Record<string, boolean>;
}

export interface ToolbarActions {
  onGizmoMode: (mode: ToolbarGizmoMode) => void;
  onGizmoSpace: (space: 'local' | 'world') => void;
  onSnapChange: (enabled: boolean, translateStep: number, rotateStepDegrees: number) => void;
  onEnvironmentLightsChange: (enabled: boolean) => void;
  onProceduralSkyChange: (enabled: boolean) => void;
  onShowAllCollidersChange: (enabled: boolean) => void;
  onGridVisibleChange: (enabled: boolean) => void;
  onFocusSelection: () => void;
  onAddBox: () => void;
  onAddEmpty: () => void;
  onNew: () => void;
  onNewScene: () => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onLoadScene: (id: string) => void;
  onDeleteScene: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenSceneSettings: () => void;
  onDeleteCurrentScene: () => void;
  onOpenProjectSettings: () => void;
  onOpenMenu: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTogglePlay: () => void;
  onTogglePause: () => void;
  onStopPlay: () => void;
  onBuildWeb: () => void;
  onOpenProject: () => void;
  onExit: () => void;
  /** Ship kind: editor-viewport articulation preview (gear / ramp / canopy / doors). */
  onShipPreviewChange: (state: ShipPreviewToggles) => void;
  playing: boolean;
  paused: boolean;
  building: boolean;
}

export interface ToolbarHandle {
  setGizmoMode: (mode: ToolbarGizmoMode) => void;
  setPrefabOptions: (entries: PrefabListEntry[]) => void;
  setSceneOptions: (entries: SceneListEntry[]) => void;
  setPlanetOptions: (entries: PlanetListEntry[]) => void;
  /** Toggle a ship-door / animation open preview by id. */
  toggleDoorPreview: (doorId: string) => void;
  /** Animate the boarding ramp between raised and lowered in the viewport. */
  playRampPreview: () => void;
  /** Animate the cockpit canopy between closed and open in the viewport. */
  playCanopyPreview: () => void;
  openBrowsePanel: (panel: BrowsePanelKind) => void;
}

export type ToolbarProps = {
  store: EditorStore;
  actions: ToolbarActions;
};

type AnimPreview = { id: string; label: string; defaultOpen: boolean };

const GIZMO_TOOLS: ReadonlyArray<{
  mode: ToolbarGizmoMode;
  label: string;
  key: string;
  icon: IconNode;
}> = [
  { mode: 'translate', label: 'Move', key: 'W', icon: UiIcons.move },
  { mode: 'rotate', label: 'Rotate', key: 'E', icon: UiIcons.rotateCw },
  { mode: 'scale', label: 'Scale', key: 'R', icon: UiIcons.scaling },
];

function defaultActiveKind(prefabs: PrefabListEntry[]): PrefabKind {
  return PREFAB_KINDS.find((kind) => prefabs.some((entry) => entry.kind === kind)) ?? 'station';
}

function collectAnimations(roots: EditorEntity[]): AnimPreview[] {
  const list: AnimPreview[] = [];
  const visit = (entities: EditorEntity[]): void => {
    for (const entity of entities) {
      for (const component of entity.components) {
        if (
          (component.type === 'ship-door' || component.type === 'door') &&
          !list.some((entry) => entry.id === component.id)
        ) {
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

/** Canopy chip only shows once a ship-controller actually enables one. */
function hasEnabledCanopy(roots: EditorEntity[]): boolean {
  for (const entity of roots) {
    for (const component of entity.components) {
      if (component.type === 'ship-controller' && component.canopy?.enabled) {
        return true;
      }
    }
    if (hasEnabledCanopy(entity.children)) return true;
  }
  return false;
}

/** Viewport articulation chips: gear / ramp / canopy on ships, plus every door. */
function ShipPreviewChips({
  isShip,
  hasCanopy,
  animations,
  shipPreview,
  onToggleGear,
  onPlayRamp,
  onPlayCanopy,
  onToggleDoor,
}: {
  isShip: boolean;
  hasCanopy: boolean;
  animations: AnimPreview[];
  shipPreview: ShipPreviewToggles;
  onToggleGear: () => void;
  onPlayRamp: () => void;
  onPlayCanopy: () => void;
  onToggleDoor: (doorId: string) => void;
}): ReactElement {
  return (
    <div className="ed-toolbar-group">
      {isShip ? (
        <>
          <button
            type="button"
            className={`ed-tool-chip${shipPreview.gearDown ? ' is-active' : ''}`}
            title="Preview landing gear"
            onClick={onToggleGear}
          >
            Gear
          </button>
          <button
            type="button"
            className={`ed-tool-chip${shipPreview.rampDown ? ' is-active' : ''}`}
            title="Play the boarding ramp raise / lower"
            onClick={onPlayRamp}
          >
            Ramp
          </button>
          {hasCanopy ? (
            <button
              type="button"
              className={`ed-tool-chip${shipPreview.canopyOpen ? ' is-active' : ''}`}
              title="Play the cockpit canopy open / close"
              onClick={onPlayCanopy}
            >
              Canopy
            </button>
          ) : null}
        </>
      ) : null}
      {animations.map((anim) => {
        const isOpen = shipPreview.doorsOpen[anim.id] ?? anim.defaultOpen;
        return (
          <button
            key={anim.id}
            type="button"
            className={`ed-tool-chip${isOpen ? ' is-active' : ''}`}
            title={`Preview "${anim.id}" open / closed`}
            onClick={() => onToggleDoor(anim.id)}
          >
            {anim.label}
          </button>
        );
      })}
    </div>
  );
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

function OpenScenePanel({
  scenes,
  onSelect,
  onDelete,
  autoFocus,
}: {
  scenes: SceneListEntry[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  autoFocus: boolean;
}): ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useAutoFocus(autoFocus, searchRef);
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? scenes.filter(
        (entry) =>
          entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query),
      )
    : scenes;

  return (
    <div className="ed-open-panel">
      <OpenSearchField
        inputRef={searchRef}
        placeholder="Search scenes…"
        value={searchQuery}
        onChange={setSearchQuery}
      />
      <div className="ed-open-list">
        {visible.length === 0 ? (
          <div className="ed-open-empty">No scenes found</div>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className="ed-open-row">
              <button
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
              <button
                type="button"
                className="ed-open-item-delete"
                title={`Delete ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(entry.id);
                }}
              >
                Delete
              </button>
            </div>
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

function ToolIconButton({
  icon,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: IconNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`ed-tool-btn${active ? ' is-active' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <UiIcon icon={icon} className="ed-ui-icon" size={16} strokeWidth={1.75} />
    </button>
  );
}

function UserMenu({
  building,
  canDeleteScene,
  onNew,
  onNewScene,
  onSave,
  onBuildWeb,
  onOpenProject,
  onOpenSceneSettings,
  onDeleteCurrentScene,
  onOpenProjectSettings,
  onExit,
}: {
  building: boolean;
  canDeleteScene: boolean;
  onNew: () => void;
  onNewScene: () => void;
  onSave: () => void;
  onBuildWeb: () => void;
  onOpenProject: () => void;
  onOpenSceneSettings: () => void;
  onDeleteCurrentScene: () => void;
  onOpenProjectSettings: () => void;
  onExit: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className={`ed-user-menu${open ? ' is-open' : ''}`}>
      <ToolIconButton
        icon={UiIcons.user}
        title="Account & project"
        active={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className="ed-menu-dropdown">
          <button type="button" className="ed-menu-item" onClick={() => run(onNewScene)}>
            <span className="ed-menu-item-label">New Scene…</span>
          </button>
          <button type="button" className="ed-menu-item" onClick={() => run(onNew)}>
            <span className="ed-menu-item-label">New Prefab</span>
          </button>
          <div className="ed-menu-sep" />
          <button type="button" className="ed-menu-item" onClick={() => run(onSave)}>
            <span className="ed-menu-item-label">Save</span>
            <span className="ed-menu-item-shortcut">Ctrl+S</span>
          </button>
          <button
            type="button"
            className="ed-menu-item"
            disabled={building}
            onClick={() => {
              if (!building) run(onBuildWeb);
            }}
          >
            <span className="ed-menu-item-label">{building ? 'Building Web…' : 'Build Web'}</span>
            <span className="ed-menu-item-shortcut">Ctrl+B</span>
          </button>
          <div className="ed-menu-sep" />
          <button type="button" className="ed-menu-item" onClick={() => run(onOpenSceneSettings)}>
            <span className="ed-menu-item-label">Scene Settings…</span>
          </button>
          <button
            type="button"
            className="ed-menu-item"
            disabled={!canDeleteScene}
            onClick={() => {
              if (canDeleteScene) run(onDeleteCurrentScene);
            }}
          >
            <span className="ed-menu-item-label">Delete Scene…</span>
          </button>
          <button type="button" className="ed-menu-item" onClick={() => run(onOpenProjectSettings)}>
            <span className="ed-menu-item-label">Project Settings…</span>
          </button>
          <button type="button" className="ed-menu-item" onClick={() => run(onOpenProject)}>
            <span className="ed-menu-item-label">Open Project…</span>
          </button>
          <div className="ed-menu-sep" />
          <button type="button" className="ed-menu-item" onClick={() => run(onExit)}>
            <span className="ed-menu-item-label">Exit to Title</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BrowseOverlay({
  panel,
  prefabs,
  scenes,
  planets,
  onClose,
  onLoadPrefab,
  onLoadScene,
  onDeleteScene,
  onLoadPlanet,
  onOpenMenu,
}: {
  panel: BrowsePanelKind;
  prefabs: PrefabListEntry[];
  scenes: SceneListEntry[];
  planets: PlanetListEntry[];
  onClose: () => void;
  onLoadPrefab: (id: string) => void;
  onLoadScene: (id: string) => void;
  onDeleteScene: (id: string) => void;
  onLoadPlanet: (id: string) => void;
  onOpenMenu: (id: string) => void;
}): ReactElement {
  const title =
    panel === 'prefab'
      ? 'Open Prefab'
      : panel === 'scene'
        ? 'Open Scene'
        : panel === 'planet'
          ? 'Open Planet'
          : 'Open Menu';

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ed-browse-overlay" role="presentation" onClick={onClose}>
      <div
        className="ed-browse-dialog"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ed-browse-dialog-header">
          <span>{title}</span>
          <button type="button" className="ed-tool-btn" title="Close" onClick={onClose}>
            <UiIcon icon={UiIcons.x} className="ed-ui-icon" size={14} strokeWidth={2} />
          </button>
        </div>
        {panel === 'prefab' ? (
          <OpenPrefabPanel
            prefabs={prefabs}
            autoFocus
            onSelect={(id) => {
              onLoadPrefab(id);
              onClose();
            }}
          />
        ) : null}
        {panel === 'scene' ? (
          <OpenScenePanel
            scenes={scenes}
            autoFocus
            onSelect={(id) => {
              onLoadScene(id);
              onClose();
            }}
            onDelete={(id) => {
              onDeleteScene(id);
            }}
          />
        ) : null}
        {panel === 'planet' ? (
          <OpenPlanetPanel
            planets={planets}
            autoFocus
            onSelect={(id) => {
              onLoadPlanet(id);
              onClose();
            }}
          />
        ) : null}
        {panel === 'menu' ? (
          <OpenMenuCatalogPanel
            autoFocus
            onSelect={(id) => {
              onOpenMenu(id);
              onClose();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export const Toolbar = forwardRef<ToolbarHandle, ToolbarProps>(function Toolbar(
  { store, actions },
  ref,
): ReactElement {
  useEditorStore(store, [
    'document',
    'history',
    'selection',
    'structure',
    'entity',
    'glb-components',
  ]);
  const docState = store.getState();
  const [gizmoMode, setGizmoModeState] = useState<ToolbarGizmoMode>('translate');
  const [gizmoSpace, setGizmoSpace] = useState<'local' | 'world'>('world');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [environmentLights, setEnvironmentLights] = useState(true);
  const [proceduralSky, setProceduralSky] = useState(false);
  const [showAllColliders, setShowAllColliders] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);
  const [snapTranslate] = useState('0.25');
  const [snapRotate] = useState('15');
  const [prefabOptions, setPrefabOptions] = useState<PrefabListEntry[]>([]);
  const [sceneOptions, setSceneOptions] = useState<SceneListEntry[]>([]);
  const [planetOptions, setPlanetOptions] = useState<PlanetListEntry[]>([]);
  const [browsePanel, setBrowsePanel] = useState<BrowsePanelKind | null>(null);
  const [shipPreview, setShipPreview] = useState<ShipPreviewToggles>({
    gearDown: true,
    rampDown: false,
    canopyOpen: false,
    doorsOpen: {},
  });
  const shipPreviewRef = useRef(shipPreview);
  const rampAnimRef = useRef<{ handle: number; target: number }>({
    handle: 0,
    target: 0,
  });
  const canopyAnimRef = useRef<{ handle: number; target: number }>({
    handle: 0,
    target: 0,
  });
  // A running hinge animation owns the ref; letting a render clobber it would
  // snap the part back mid-play.
  if (rampAnimRef.current.handle === 0 && canopyAnimRef.current.handle === 0) {
    shipPreviewRef.current = shipPreview;
  }

  const emitShipPreview = useCallback(
    (next: ShipPreviewToggles) => {
      actions.onShipPreviewChange({
        gearDown: next.gearDown,
        rampDown: next.rampDown,
        canopyOpen: next.canopyOpen,
        ...(next.ramp01 === undefined ? {} : { ramp01: next.ramp01 }),
        ...(next.canopy01 === undefined ? {} : { canopy01: next.canopy01 }),
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
      shipPreviewRef.current = next;
      setShipPreview(next);
      emitShipPreview(next);
    },
    [emitShipPreview, store],
  );

  const patchShip = useCallback(
    (patch: Partial<ShipPreviewToggles>) => {
      const next = { ...shipPreviewRef.current, ...patch };
      // Keep the ref in step: a running ramp animation blocks the render-time
      // refresh, and its next tick reads this ref.
      shipPreviewRef.current = next;
      setShipPreview(next);
      emitShipPreview(next);
    },
    [emitShipPreview],
  );

  /**
   * Play an articulated part between its two rest poses at the same rate the
   * game uses, so the authored angle can be judged in motion. Frames only push
   * to the viewport — React state updates once, on arrival — so a multi-second
   * animation does not re-render the toolbar hundreds of times.
   */
  const playHingePreview = useCallback(
    (spec: {
      animRef: RefObject<{ handle: number; target: number }>;
      ratePerSecond: number;
      /** Live blend, or undefined when the part is resting. */
      blendOf: (state: ShipPreviewToggles) => number | undefined;
      /** Resting pose: true = the "1" end of the blend. */
      restingOpen: (state: ShipPreviewToggles) => boolean;
      /** Apply a mid-animation blend value. */
      withBlend: (state: ShipPreviewToggles, value: number) => ShipPreviewToggles;
      /** Apply the settled resting pose and clear the blend. */
      withResting: (state: ShipPreviewToggles, open: boolean) => ShipPreviewToggles;
    }) => {
      const anim = spec.animRef.current;
      const wasRunning = anim.handle !== 0;
      if (wasRunning) window.cancelAnimationFrame(anim.handle);
      const current = shipPreviewRef.current;
      // Mid-play clicks reverse; otherwise head for the opposite of the resting
      // state, so a fully lowered ramp raises again.
      const target = wasRunning
        ? anim.target > 0.5
          ? 0
          : 1
        : spec.restingOpen(current)
          ? 0
          : 1;
      let value = spec.blendOf(current) ?? (spec.restingOpen(current) ? 1 : 0);
      let lastMs = 0;
      anim.target = target;

      const tick = (nowMs: number): void => {
        const dt = lastMs === 0 ? 0 : Math.min(0.1, (nowMs - lastMs) / 1000);
        lastMs = nowMs;
        const step = spec.ratePerSecond * dt;
        value =
          target > value ? Math.min(target, value + step) : Math.max(target, value - step);
        if (Math.abs(value - target) < 1e-4) {
          spec.animRef.current.handle = 0;
          const settled = spec.withResting(shipPreviewRef.current, target > 0.5);
          shipPreviewRef.current = settled;
          setShipPreview(settled);
          emitShipPreview(settled);
          return;
        }
        shipPreviewRef.current = spec.withBlend(shipPreviewRef.current, value);
        emitShipPreview(shipPreviewRef.current);
        spec.animRef.current.handle = window.requestAnimationFrame(tick);
      };
      anim.handle = window.requestAnimationFrame(tick);
    },
    [emitShipPreview],
  );

  const playRampPreview = useCallback(() => {
    playHingePreview({
      animRef: rampAnimRef,
      ratePerSecond: RAMP_RATE_PER_SECOND,
      blendOf: (state) => state.ramp01,
      restingOpen: (state) => state.rampDown,
      withBlend: (state, ramp01) => ({ ...state, ramp01 }),
      withResting: (state, open) => ({ ...state, rampDown: open, ramp01: undefined }),
    });
  }, [playHingePreview]);

  const playCanopyPreview = useCallback(() => {
    playHingePreview({
      animRef: canopyAnimRef,
      ratePerSecond: CANOPY_RATE_PER_SECOND,
      blendOf: (state) => state.canopy01,
      restingOpen: (state) => state.canopyOpen,
      withBlend: (state, canopy01) => ({ ...state, canopy01 }),
      withResting: (state, open) => ({ ...state, canopyOpen: open, canopy01: undefined }),
    });
  }, [playHingePreview]);

  useEffect(
    () => () => {
      if (rampAnimRef.current.handle !== 0) {
        window.cancelAnimationFrame(rampAnimRef.current.handle);
      }
      if (canopyAnimRef.current.handle !== 0) {
        window.cancelAnimationFrame(canopyAnimRef.current.handle);
      }
    },
    [],
  );

  const animations = useMemo(() => collectAnimations(docState.roots), [docState.roots]);
  const hasCanopy = useMemo(() => hasEnabledCanopy(docState.roots), [docState.roots]);
  const isShip = docState.kind === 'ship';
  const showShipGroup = isShip || animations.length > 0;

  useImperativeHandle(
    ref,
    () => ({
      setGizmoMode: setGizmoModeState,
      setPrefabOptions,
      setSceneOptions,
      setPlanetOptions,
      toggleDoorPreview,
      playRampPreview,
      playCanopyPreview,
      openBrowsePanel: setBrowsePanel,
    }),
    [toggleDoorPreview, playRampPreview, playCanopyPreview],
  );

  const setMode = (mode: ToolbarGizmoMode): void => {
    setGizmoModeState(mode);
    actions.onGizmoMode(mode);
  };

  const toggleSpace = (): void => {
    const next = gizmoSpace === 'world' ? 'local' : 'world';
    setGizmoSpace(next);
    actions.onGizmoSpace(next);
  };

  const toggleSnap = (): void => {
    const next = !snapEnabled;
    setSnapEnabled(next);
    actions.onSnapChange(next, Number(snapTranslate) || 0.25, Number(snapRotate) || 15);
  };

  const toggleEnvironmentLights = (): void => {
    const next = !environmentLights;
    setEnvironmentLights(next);
    actions.onEnvironmentLightsChange(next);
  };

  const toggleShowAllColliders = (): void => {
    const next = !showAllColliders;
    setShowAllColliders(next);
    actions.onShowAllCollidersChange(next);
  };

  const toggleGridVisible = (): void => {
    const next = !gridVisible;
    setGridVisible(next);
    actions.onGridVisibleChange(next);
  };

  const toggleProceduralSky = (): void => {
    const next = !proceduralSky;
    setProceduralSky(next);
    actions.onProceduralSkyChange(next);
  };

  return (
    <>
      <div className="ed-toolbar">
        <div className="ed-toolbar-left">
          <div className="ed-toolbar-group">
            {GIZMO_TOOLS.map((tool) => (
              <ToolIconButton
                key={tool.mode}
                icon={tool.icon}
                title={`${tool.label} (${tool.key})`}
                active={gizmoMode === tool.mode}
                onClick={() => setMode(tool.mode)}
              />
            ))}
            <ToolIconButton
              icon={UiIcons.focus}
              title="Focus selection (F)"
              onClick={() => actions.onFocusSelection()}
            />
            <ToolIconButton
              icon={UiIcons.magnet}
              title="Snap (hold Ctrl to invert while dragging)"
              active={snapEnabled}
              onClick={toggleSnap}
            />
            <ToolIconButton
              icon={gizmoSpace === 'world' ? UiIcons.globe : UiIcons.box}
              title={gizmoSpace === 'world' ? 'Gizmo space: World (click for Local)' : 'Gizmo space: Local (click for World)'}
              active={gizmoSpace === 'local'}
              onClick={toggleSpace}
            />
          </div>

          <div className="ed-toolbar-group">
            <ToolIconButton
              icon={environmentLights ? UiIcons.sun : UiIcons.sunDim}
              title={
                environmentLights
                  ? 'Environment lights on (click to show local lights only)'
                  : 'Environment lights off — local lights only (click to restore)'
              }
              active={environmentLights}
              onClick={toggleEnvironmentLights}
            />
            <ToolIconButton
              icon={UiIcons.boxes}
              title={
                showAllColliders
                  ? 'Collider overlays on — all entities (click for selection only)'
                  : 'Collider overlays off — selection only (click to show all)'
              }
              active={showAllColliders}
              onClick={toggleShowAllColliders}
            />
            <ToolIconButton
              icon={UiIcons.grid3x3}
              title={
                gridVisible
                  ? 'Floor grid on (click to hide)'
                  : 'Floor grid off (click to show)'
              }
              active={gridVisible}
              onClick={toggleGridVisible}
            />
            <ToolIconButton
              icon={UiIcons.cloudSun}
              title={
                proceduralSky
                  ? 'Procedural sky on (click to restore solid backdrop)'
                  : 'Procedural sky off — Unreal-style sky + sun (click to enable)'
              }
              active={proceduralSky}
              onClick={toggleProceduralSky}
            />
          </div>

          <div className="ed-toolbar-group">
            <ToolIconButton
              icon={UiIcons.plus}
              title="Add box"
              onClick={() => actions.onAddBox()}
            />
            <ToolIconButton
              icon={UiIcons.box}
              title="Add empty entity for markers"
              onClick={() => actions.onAddEmpty()}
            />
            <ToolIconButton
              icon={UiIcons.undo2}
              title="Undo (Ctrl+Z)"
              disabled={!store.canUndo()}
              onClick={() => store.undo()}
            />
            <ToolIconButton
              icon={UiIcons.redo2}
              title="Redo (Ctrl+Y)"
              disabled={!store.canRedo()}
              onClick={() => store.redo()}
            />
          </div>

          {showShipGroup ? (
            <ShipPreviewChips
              isShip={isShip}
              hasCanopy={hasCanopy}
              animations={animations}
              shipPreview={shipPreview}
              onToggleGear={() => patchShip({ gearDown: !shipPreview.gearDown })}
              onPlayRamp={playRampPreview}
              onPlayCanopy={playCanopyPreview}
              onToggleDoor={toggleDoorPreview}
            />
          ) : null}
        </div>

        <div className="ed-toolbar-center">
          <div className="ed-toolbar-playback">
            <ToolIconButton
              icon={UiIcons.play}
              title={actions.playing ? 'Playing (F6)' : 'Play active scene (F6)'}
              active={actions.playing}
              disabled={actions.playing}
              onClick={() => actions.onTogglePlay()}
            />
            <ToolIconButton
              icon={UiIcons.pause}
              title={actions.paused ? 'Resume (F7)' : 'Pause (F7)'}
              active={actions.paused}
              disabled={!actions.playing}
              onClick={() => actions.onTogglePause()}
            />
            <ToolIconButton
              icon={UiIcons.square}
              title="Stop (F6)"
              disabled={!actions.playing}
              onClick={() => actions.onStopPlay()}
            />
          </div>
        </div>

        <div className="ed-toolbar-right">
          <UserMenu
            building={actions.building}
            canDeleteScene={docState.documentType === 'scene'}
            onNew={actions.onNew}
            onNewScene={actions.onNewScene}
            onSave={actions.onSave}
            onBuildWeb={actions.onBuildWeb}
            onOpenProject={actions.onOpenProject}
            onOpenSceneSettings={actions.onOpenSceneSettings}
            onDeleteCurrentScene={actions.onDeleteCurrentScene}
            onOpenProjectSettings={actions.onOpenProjectSettings}
            onExit={actions.onExit}
          />
        </div>
      </div>

      {browsePanel ? (
        <BrowseOverlay
          panel={browsePanel}
          prefabs={prefabOptions}
          scenes={sceneOptions}
          planets={planetOptions}
          onClose={() => setBrowsePanel(null)}
          onLoadPrefab={actions.onLoad}
          onLoadScene={actions.onLoadScene}
          onDeleteScene={actions.onDeleteScene}
          onLoadPlanet={actions.onLoadPlanet}
          onOpenMenu={actions.onOpenMenu}
        />
      ) : null}
    </>
  );
});
