import { useCallback, useMemo, type MutableRefObject, type RefObject } from 'react';
import { getDesktopEditorBridge } from '../../platform/editor-desktop';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import { showToast } from '../dom';
import { startEditorPlay, type EditorPlaySession } from '../play-in-editor';
import { startPlanetSurfaceTest } from '../planet-test';
import { startShipTest } from '../ship-test';
import { addBox, addEmpty } from '../session-helpers';
import type { EditorViewport } from '../../render/editor/viewport';
import type { ShipEditor } from './panels/ShipPanel';
import type { ShipTestEnv } from './panels/ship/types';
import type { ToolbarGizmoMode, ToolbarHandle } from './panels/Toolbar';
import type { TabEditorHandles } from './TabEditorHosts';
import type { SceneEditorTab } from './types';

/**
 * Tear down every tab preview WebGPU device *before* Play creates its own
 * renderer. `setPlaying(true)` only reaches TabEditorHosts after React commits
 * — too late for Planet Authoring Test Play. Planet preview `deactivate`
 * disposes its adapter (not just RAF); a concurrent device stalls takram
 * atmosphere LUT fill and leaves a black sky over lit terrain.
 */
function pauseTabPreviews(handles: TabEditorHandles): void {
  handles.baseCharacterEditor?.deactivate();
  handles.planetAuthoringEditor?.deactivate();
  handles.systemMapEditor?.deactivate();
  handles.menuManagerEditor?.deactivate();
}

export type EditorAppSessionArgs = {
  store: EditorStore;
  audioPreview: EditorAudioPreviewController;
  playing: boolean;
  paused: boolean;
  building: boolean;
  setPlaying: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setBuilding: (v: boolean) => void;
  setSceneSettingsOpen: (v: boolean) => void;
  setPrefabSettingsOpen: (v: boolean) => void;
  setProjectSettingsOpen: (v: boolean) => void;
  setTabState: (v: SceneEditorTab) => void;
  setTab: (next: SceneEditorTab) => void;
  tabRef: MutableRefObject<SceneEditorTab>;
  tabHandlesRef: MutableRefObject<TabEditorHandles>;
  shipEditorRef: RefObject<ShipEditor | null>;
  viewportRef: MutableRefObject<EditorViewport | null>;
  toolbarRef: RefObject<ToolbarHandle | null>;
  playSessionRef: MutableRefObject<EditorPlaySession | null>;
  allowUnloadRef: MutableRefObject<boolean>;
  stopInEditorPlay: () => void;
  saveActive: () => Promise<boolean>;
  newDocument: () => void | Promise<void>;
  newSceneDocument: () => void | Promise<void>;
  loadById: (id: string) => void | Promise<void>;
  loadSceneById: (id: string) => void | Promise<void>;
  deleteSceneById: (id: string) => void | Promise<void>;
  deleteCurrentScene: () => void | Promise<void>;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  confirmDiscard: (message: string) => Promise<boolean>;
  hasUnsavedWork: () => boolean;
};

type PlayLaunch =
  | { kind: 'session'; session: EditorPlaySession; setViewportPlayMode?: boolean }
  | { kind: 'abort' }
  | { kind: 'blocked'; message: string; error?: boolean };

async function resolvePlayLaunch(args: {
  tab: SceneEditorTab;
  handles: TabEditorHandles;
  store: EditorStore;
  shipTestEnv: ShipTestEnv;
}): Promise<PlayLaunch> {
  const { tab, handles, store, shipTestEnv } = args;
  if (tab === 'system-map' && !(await handles.systemMapEditor?.save())) {
    return { kind: 'abort' };
  }
  if (tab === 'base-characters') {
    await handles.baseCharacterEditor?.save();
    return {
      kind: 'blocked',
      message: 'Use the Play Test control in the Base Characters panel.',
    };
  }
  if (tab === 'server') {
    return { kind: 'blocked', message: 'Open a scene to play.', error: true };
  }
  if (tab === 'ship') {
    if (store.getState().kind !== 'ship') {
      return { kind: 'blocked', message: 'Open a ship prefab to test it.', error: true };
    }
    return {
      kind: 'session',
      session: startShipTest(store, shipTestEnv),
      setViewportPlayMode: true,
    };
  }
  if (tab === 'planet-authoring') {
    if (!(await handles.planetAuthoringEditor?.save())) return { kind: 'abort' };
    const planetId = handles.planetAuthoringEditor?.getDocument()?.id;
    if (!planetId) {
      return { kind: 'blocked', message: 'Open a planet to test play.', error: true };
    }
    return { kind: 'session', session: startPlanetSurfaceTest(planetId) };
  }
  return {
    kind: 'session',
    session: startEditorPlay(store),
    setViewportPlayMode: true,
  };
}

export function useEditorAppSession(args: EditorAppSessionArgs) {
  const {
    store,
    audioPreview,
    playing,
    paused,
    building,
    setPlaying,
    setPaused,
    setBuilding,
    setSceneSettingsOpen,
    setPrefabSettingsOpen,
    setProjectSettingsOpen,
    setTabState,
    setTab,
    tabRef,
    tabHandlesRef,
    shipEditorRef,
    viewportRef,
    toolbarRef,
    playSessionRef,
    allowUnloadRef,
    stopInEditorPlay,
    saveActive,
    newDocument,
    newSceneDocument,
    loadById,
    loadSceneById,
    deleteSceneById,
    deleteCurrentScene,
    duplicateSelection,
    deleteSelection,
    confirmDiscard,
    hasUnsavedWork,
  } = args;

const togglePlay = useCallback(async () => {
  if (playing) {
    stopInEditorPlay();
    return;
  }

  const current = tabRef.current;
  audioPreview.stop();
  // Imperative pause before resolvePlayLaunch — that path may call
  // startPlanetSurfaceTest synchronously, which creates the game WebGPU device.
  pauseTabPreviews(tabHandlesRef.current);
  const launch = await resolvePlayLaunch({
    tab: current,
    handles: tabHandlesRef.current,
    store,
    shipTestEnv: shipEditorRef.current?.getTestEnv() ?? 'pad',
  });
  if (launch.kind === 'abort') return;
  if (launch.kind === 'blocked') {
    showToast(launch.message, launch.error === true);
    return;
  }
  if (current !== 'scene' && current !== 'ship' && current !== 'planet-authoring') {
    setTabState('scene');
  }
  if (launch.setViewportPlayMode) viewportRef.current?.setPlayMode(true);
  playSessionRef.current = launch.session;
  setPaused(false);
  setPlaying(true);
}, [playing, audioPreview, stopInEditorPlay, store]);

/** Planet Authoring → Test Play: panel already saved; just boot surface play. */
const startPlanetAuthoringPlay = useCallback(() => {
  if (playing) {
    stopInEditorPlay();
  }
  const planetId = tabHandlesRef.current.planetAuthoringEditor?.getDocument()?.id;
  if (!planetId) {
    showToast('Open a planet to test play.', true);
    return;
  }
  audioPreview.stop();
  pauseTabPreviews(tabHandlesRef.current);
  playSessionRef.current = startPlanetSurfaceTest(planetId);
  setPaused(false);
  setPlaying(true);
}, [playing, stopInEditorPlay, audioPreview, tabHandlesRef, playSessionRef, setPaused, setPlaying]);

const togglePause = useCallback(() => {
  const session = playSessionRef.current;
  if (!session) return;
  const next = !session.isPaused();
  session.setPaused(next);
  setPaused(next);
}, []);

const buildWeb = useCallback(async () => {
  const bridge = getDesktopEditorBridge();
  if (!bridge) {
    showToast('Build Web is available in the Electron editor.', true);
    return;
  }
  if (!(await saveActive())) return;
  setBuilding(true);
  try {
    const result = await bridge.buildWeb();
    showToast(
      result.ok
        ? `Web release built at ${result.outputDir ?? 'dist/'}`
        : result.message,
      !result.ok,
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Web build failed.', true);
  } finally {
    setBuilding(false);
  }
}, [saveActive]);

const exitToTitle = useCallback(async () => {
  const handles = tabHandlesRef.current;
  if (hasUnsavedWork() && !(await confirmDiscard('Discard unsaved changes and exit?'))) {
    return;
  }
  if (
    handles.planetAuthoringEditor?.isDirty() &&
    !(await confirmDiscard('Discard unsaved planet changes and exit?'))
  ) {
    return;
  }
  if (
    handles.systemMapEditor?.isDirty() &&
    !(await confirmDiscard('Discard unsaved system map changes and exit?'))
  ) {
    return;
  }
  audioPreview.stop();
  allowUnloadRef.current = true;
  window.location.href = '/';
}, [audioPreview, confirmDiscard, hasUnsavedWork]);

const onSave = useCallback(() => {
  void saveActive();
}, [saveActive]);

const openSceneSettings = useCallback(() => {
  if (store.getState().documentType !== 'scene') {
    showToast('Open a scene to edit Scene Settings.', true);
    return;
  }
  setSceneSettingsOpen(true);
}, [store, setSceneSettingsOpen]);

const openPrefabSettings = useCallback(() => {
  if (store.getState().documentType !== 'prefab') {
    showToast('Open a prefab to edit Prefab Settings.', true);
    return;
  }
  setPrefabSettingsOpen(true);
}, [store, setPrefabSettingsOpen]);

const openProjectSettings = useCallback(() => {
  setProjectSettingsOpen(true);
}, [setProjectSettingsOpen]);

const setGizmoMode = useCallback(
  (mode: ToolbarGizmoMode) => {
    if (tabRef.current === 'base-characters') {
      tabHandlesRef.current.baseCharacterEditor?.setGizmoMode(mode);
      return;
    }
    viewportRef.current?.setGizmoMode(mode);
    toolbarRef.current?.setGizmoMode(mode);
  },
  [],
);

const toolbarActions = useMemo(
  () => ({
    onGizmoMode: (mode: ToolbarGizmoMode) => viewportRef.current?.setGizmoMode(mode),
    onGizmoSpace: (space: 'local' | 'world') => viewportRef.current?.setGizmoSpace(space),
    onSnapChange: (enabled: boolean, translate: number, rotate: number) =>
      viewportRef.current?.setSnap(enabled, translate, rotate),
    onEnvironmentLightsChange: (enabled: boolean) =>
      viewportRef.current?.setEnvironmentLights(enabled),
    onProceduralSkyChange: (enabled: boolean) =>
      viewportRef.current?.setProceduralSky(enabled),
    onShowAllCollidersChange: (enabled: boolean) =>
      viewportRef.current?.setShowAllColliders(enabled),
    onGridVisibleChange: (enabled: boolean) =>
      viewportRef.current?.setGridVisible(enabled),
    onFocusSelection: () => viewportRef.current?.focusSelection(),
    onAddBox: () => addBox(store),
    onAddEmpty: () => addEmpty(store),
    onNew: () => {
      void newDocument();
    },
    onNewScene: () => {
      void newSceneDocument();
    },
    onSave,
    onLoad: (id: string) => void loadById(id),
    onLoadScene: (id: string) => void loadSceneById(id),
    onDeleteScene: (id: string) => void deleteSceneById(id),
    onLoadPlanet: (id: string) => {
      setTab('planet-authoring');
      void tabHandlesRef.current.planetAuthoringEditor?.loadPlanet(id);
    },
    onOpenSceneSettings: openSceneSettings,
    onOpenPrefabSettings: openPrefabSettings,
    onDeleteCurrentScene: () => {
      void deleteCurrentScene();
    },
    onOpenProjectSettings: openProjectSettings,
    onOpenMenu: (id: string) => {
      setTab('menu-manager');
      queueMicrotask(() => tabHandlesRef.current.menuManagerEditor?.openMenu(id));
    },
    onDuplicate: duplicateSelection,
    onDelete: deleteSelection,
    onTogglePlay: () => void togglePlay(),
    onTogglePause: togglePause,
    onStopPlay: stopInEditorPlay,
    onBuildWeb: () => void buildWeb(),
    onOpenProject: () => {
      void getDesktopEditorBridge()?.returnToProjects();
    },
    onExit: () => void exitToTitle(),
    onShipPreviewChange: (state: Parameters<EditorViewport['setShipPreview']>[0]) =>
      viewportRef.current?.setShipPreview(state),
    playing,
    paused,
    building,
  }),
  [
    store,
    newDocument,
    newSceneDocument,
    onSave,
    openSceneSettings,
    openPrefabSettings,
    openProjectSettings,
    loadById,
    loadSceneById,
    deleteSceneById,
    deleteCurrentScene,
    setTab,
    duplicateSelection,
    deleteSelection,
    togglePlay,
    togglePause,
    stopInEditorPlay,
    buildWeb,
    exitToTitle,
    playing,
    paused,
    building,
  ],
);

  return {
    togglePlay,
    togglePause,
    startPlanetAuthoringPlay,
    buildWeb,
    exitToTitle,
    onSave,
    openSceneSettings,
    openPrefabSettings,
    openProjectSettings,
    setGizmoMode,
    toolbarActions,
  };
}
