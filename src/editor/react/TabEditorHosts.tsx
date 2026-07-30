import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  BaseCharactersPanel,
  type BaseCharacterEquipmentEditor,
} from './panels/BaseCharactersPanel';
import {
  PlanetAuthoringPanel,
  type PlanetAuthoringEditor,
} from './panels/PlanetAuthoringPanel';
import {
  SystemMapPanel,
  type SystemMapEditor,
} from './panels/SystemMapPanel';
import {
  MenuManagerPanel,
  type MenuManagerEditor,
} from './panels/MenuManagerPanel';
import { ServerConsolePanel } from './panels/server/ServerConsolePanel';
import type { SceneEditorTab } from './types';

export type TabEditorHandles = {
  baseCharacterEditor: BaseCharacterEquipmentEditor | null;
  planetAuthoringEditor: PlanetAuthoringEditor | null;
  systemMapEditor: SystemMapEditor | null;
  menuManagerEditor: MenuManagerEditor | null;
};

type TabEditorHostsProps = {
  tab: SceneEditorTab;
  onHandles: (handles: TabEditorHandles) => void;
  onPlanetTestPlay: () => void;
};

/**
 * Tab editors with React chrome and imperative preview stages. React owns visibility /
 * activate lifecycle; preview runtimes stay in their modules.
 */
export function TabEditorHosts({
  tab,
  onHandles,
  onPlanetTestPlay,
}: TabEditorHostsProps): ReactElement {
  const baseCharacterRef = useRef<BaseCharacterEquipmentEditor | null>(null);
  const planetRef = useRef<PlanetAuthoringEditor | null>(null);
  const systemRef = useRef<SystemMapEditor | null>(null);
  const menuManagerRef = useRef<MenuManagerEditor | null>(null);

  const handlesRef = useRef<TabEditorHandles>({
    baseCharacterEditor: null,
    planetAuthoringEditor: null,
    systemMapEditor: null,
    menuManagerEditor: null,
  });

  const syncHandles = useCallback((): void => {
    onHandles({ ...handlesRef.current });
  }, [onHandles]);

  const setBaseCharacterEditor = useCallback(
    (editor: BaseCharacterEquipmentEditor | null): void => {
      handlesRef.current.baseCharacterEditor = editor;
      syncHandles();
    },
    [syncHandles],
  );

  useEffect(() => {
    syncHandles();
  }, [syncHandles]);

  useEffect(() => {
    const h = handlesRef.current;
    h.planetAuthoringEditor = planetRef.current;
    h.systemMapEditor = systemRef.current;
    h.menuManagerEditor = menuManagerRef.current;

    if (tab === 'base-characters') {
      h.baseCharacterEditor?.activate();
    } else {
      h.baseCharacterEditor?.deactivate();
    }

    if (tab === 'planet-authoring') {
      h.planetAuthoringEditor?.activate();
    } else {
      h.planetAuthoringEditor?.deactivate();
    }

    if (tab === 'system-map') {
      h.systemMapEditor?.activate();
    } else {
      h.systemMapEditor?.deactivate();
    }

    if (tab === 'menu-manager') {
      h.menuManagerEditor?.activate();
    } else {
      h.menuManagerEditor?.deactivate();
    }

    syncHandles();
  }, [tab, syncHandles]);

  useEffect(() => {
    return () => {
      const h = handlesRef.current;
      h.baseCharacterEditor?.deactivate();
      h.planetAuthoringEditor?.deactivate();
      h.systemMapEditor?.deactivate();
      h.menuManagerEditor?.deactivate();
      h.menuManagerEditor?.dispose?.();
    };
  }, []);

  return (
    <>
      <BaseCharactersPanel
        ref={baseCharacterRef}
        hidden={tab !== 'base-characters'}
        onReady={setBaseCharacterEditor}
      />
      <PlanetAuthoringPanel
        ref={planetRef}
        hidden={tab !== 'planet-authoring'}
        onTestPlay={onPlanetTestPlay}
      />
      <SystemMapPanel
        ref={systemRef}
        hidden={tab !== 'system-map'}
      />
      <MenuManagerPanel
        ref={menuManagerRef}
        hidden={tab !== 'menu-manager'}
      />
      <ServerConsolePanel active={tab === 'server'} />
    </>
  );
}
