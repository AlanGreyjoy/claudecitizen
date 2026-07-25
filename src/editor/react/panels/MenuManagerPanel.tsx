import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { HaloBandTab } from '../../../render/effects/hud/haloband';
import {
  findMenuCatalogEntry,
  MENU_CATALOG,
  type MenuPreviewId,
} from '../../menus/catalog';
import { MOCK_ARC_BALANCE } from '../../menus/mocks';
import { HALOBAND_TABS } from '../../panels/menu-manager-preview';
import { useMenuPreviewRuntime } from './use-menu-preview-runtime';

export interface MenuManagerEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  openMenu: (id: string) => boolean;
  getActiveMenuId: () => MenuPreviewId;
  /** Menu list chrome — dock into Scene hierarchy panel (full height). */
  getLeftPanel: () => HTMLElement;
  dispose?: () => void;
}

type MenuManagerPanelProps = {
  hidden: boolean;
};

function createSidebarHost(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ed-menu-manager-sidebar';
  return el;
}

type MenuManagerSidebarProps = {
  activeMenuId: MenuPreviewId;
  activeHaloBandTab: HaloBandTab;
  shipMode: boolean;
  onOpenMenu: (id: string) => void;
  onHaloBandTab: (tab: HaloBandTab) => void;
  onShipModeChange: (enabled: boolean) => void;
};

function MenuManagerSidebar({
  activeMenuId,
  activeHaloBandTab,
  shipMode,
  onOpenMenu,
  onHaloBandTab,
  onShipModeChange,
}: MenuManagerSidebarProps): ReactElement {
  const entry = findMenuCatalogEntry(activeMenuId);
  return (
    <>
      <div className="ed-menu-manager-status">
        {entry ? `${entry.name} preview` : 'Menu preview'}
      </div>
      <p className="ed-menu-manager-note">{entry?.description ?? ''}</p>
      <p className="ed-menu-manager-note">
        {`Mock balance: ${MOCK_ARC_BALANCE.toLocaleString()} ARC`}
      </p>
      <div className="ed-menu-manager-section">
        <div className="ed-menu-manager-section-title">Menus</div>
        {MENU_CATALOG.map((menuEntry) => (
          <button
            key={menuEntry.id}
            type="button"
            className={`ed-menu-manager-tab-btn${
              menuEntry.id === activeMenuId ? ' is-active' : ''
            }`}
            title={menuEntry.description}
            onClick={() => onOpenMenu(menuEntry.id)}
          >
            {menuEntry.name}
          </button>
        ))}
      </div>
      <div
        className={`ed-menu-manager-section ed-menu-manager-haloband-extras${
          activeMenuId !== 'haloband' ? ' is-hidden' : ''
        }`}
      >
        <div className="ed-menu-manager-section-title">HaloBand tabs</div>
        {HALOBAND_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`ed-menu-manager-tab-btn${
              tab.id === activeHaloBandTab ? ' is-active' : ''
            }`}
            data-tab={tab.id}
            onClick={() => {
              if (tab.id === 'ship' && !shipMode) {
                onShipModeChange(true);
              }
              onHaloBandTab(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
        <label className="ed-menu-manager-check" htmlFor="ed-menu-manager-ship-mode">
          <input
            id="ed-menu-manager-ship-mode"
            type="checkbox"
            checked={shipMode}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              onShipModeChange(next);
              if (next) {
                onHaloBandTab('ship');
              }
            }}
          />
          {' Ship mode'}
        </label>
      </div>
    </>
  );
}

export const MenuManagerPanel = forwardRef<MenuManagerEditor, MenuManagerPanelProps>(
  function MenuManagerPanel({ hidden }, ref): ReactElement {
    const [activeMenuId, setActiveMenuId] = useState<MenuPreviewId>('haloband');
    const [shipMode, setShipMode] = useState(false);
    const [activeHaloBandTab, setActiveHaloBandTab] = useState<HaloBandTab>('home');

    const activeMenuIdRef = useRef(activeMenuId);
    const previewHostRef = useRef<HTMLDivElement>(null);
    const sidebarHostRef = useRef<HTMLDivElement | null>(null);
    if (sidebarHostRef.current === null) {
      sidebarHostRef.current = createSidebarHost();
    }

    activeMenuIdRef.current = activeMenuId;

    const { activate, deactivate } = useMenuPreviewRuntime(
      previewHostRef,
      activeMenuId,
      shipMode,
      activeHaloBandTab,
    );

    const openMenu = useCallback((id: string): boolean => {
      const entry = findMenuCatalogEntry(id);
      if (!entry) return false;
      const nextId = entry.id as MenuPreviewId;
      setActiveMenuId(nextId);
      activeMenuIdRef.current = nextId;
      return true;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        activate,
        deactivate,
        canLeave: () => true,
        isDirty: () => false,
        save: async () => true,
        openMenu,
        getActiveMenuId: () => activeMenuIdRef.current,
        getLeftPanel: () => sidebarHostRef.current!,
        dispose: () => {
          deactivate();
        },
      }),
      [activate, deactivate, openMenu],
    );

    useEffect(() => {
      return () => {
        sidebarHostRef.current?.remove();
      };
    }, []);

    const sidebarHost = sidebarHostRef.current;

    return (
      <>
        <div
          className={`ed-scene-panel ed-menu-manager-host${hidden ? ' is-hidden' : ''}`}
        >
          <div ref={previewHostRef} className="ed-menu-manager-preview" />
        </div>
        {sidebarHost
          ? createPortal(
              <MenuManagerSidebar
                activeMenuId={activeMenuId}
                activeHaloBandTab={activeHaloBandTab}
                shipMode={shipMode}
                onOpenMenu={openMenu}
                onHaloBandTab={setActiveHaloBandTab}
                onShipModeChange={setShipMode}
              />,
              sidebarHost,
            )
          : null}
      </>
    );
  },
);
