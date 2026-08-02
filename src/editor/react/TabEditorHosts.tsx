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
  /** When true, pause every tab preview WebGPU loop (Play / Planet Test Play). */
  playing: boolean;
  onHandles: (handles: TabEditorHandles) => void;
  onPlanetTestPlay: () => void;
};

/**
 * Tab editors with React chrome and imperative preview stages. React owns visibility /
 * activate lifecycle; preview runtimes stay in their modules.
 *
 * Preview stages must not keep a live WebGPU device during in-editor Play.
 * Planet Authoring Test Play stays on this tab, so without the `playing` gate
 * the planet preview adapter sits beside the game — and takram atmosphere LUT
 * compute then fails to fill, leaving a pitch-black sky over lit terrain.
 * `deactivate` disposes that device; RAF pause alone is not enough.
 */
export function TabEditorHosts({
  tab,
  playing,
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

    // Play pauses every tab preview, even the active tab — concurrent WebGPU
    // renderers break atmosphere LUT fill on the game path.
    if (tab === 'base-characters' && !playing) {
      h.baseCharacterEditor?.activate();
    } else {
      h.baseCharacterEditor?.deactivate();
    }

    if (tab === 'planet-authoring' && !playing) {
      h.planetAuthoringEditor?.activate();
    } else {
      h.planetAuthoringEditor?.deactivate();
    }

    if (tab === 'system-map' && !playing) {
      h.systemMapEditor?.activate();
    } else {
      h.systemMapEditor?.deactivate();
    }

    if (tab === 'menu-manager' && !playing) {
      h.menuManagerEditor?.activate();
    } else {
      h.menuManagerEditor?.deactivate();
    }

    syncHandles();
  }, [tab, playing, syncHandles]);

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
