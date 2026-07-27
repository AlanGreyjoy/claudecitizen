import { useCallback, useMemo, type MutableRefObject, type RefObject } from 'react';
import { getDesktopEditorBridge } from '../../platform/editor-desktop';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import { showToast } from '../dom';
import { startEditorPlay, type EditorPlaySession } from '../play-in-editor';
import { startShipTest } from '../ship-test';
import { addBox, addEmpty } from '../session-helpers';
import type { EditorViewport } from '../../render/editor/viewport';
import type { ShipEditor } from './panels/ShipPanel';
import type { ToolbarGizmoMode, ToolbarHandle } from './panels/Toolbar';
import type { TabEditorHandles } from './TabEditorHosts';
import type { SceneEditorTab } from './types';

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
  const handles = tabHandlesRef.current;
  audioPreview.stop();

  if (current === 'planet-authoring' && !(await handles.planetAuthoringEditor?.save())) {
    return;
  }
  if (current === 'system-map' && !(await handles.systemMapEditor?.save())) return;
  if (current === 'base-characters') {
    await handles.baseCharacterEditor?.save();
    showToast('Use the Play Test control in the Base Characters panel.');
    return;
  }
  if (current === 'server') {
    showToast('Open a scene to play.', true);
    return;
  }
  if (current === 'ship') {
    if (store.getState().kind !== 'ship') {
      showToast('Open a ship prefab to test it.', true);
      return;
    }
    viewportRef.current?.setPlayMode(true);
    playSessionRef.current = startShipTest(store, shipEditorRef.current?.getTestEnv() ?? 'pad');
    setPaused(false);
    setPlaying(true);
    return;
  }
  if (current !== 'scene') setTabState('scene');

  viewportRef.current?.setPlayMode(true);
  playSessionRef.current = startEditorPlay(store);
  setPaused(false);
  setPlaying(true);
}, [playing, audioPreview, stopInEditorPlay, store]);

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
}, [store]);

const openProjectSettings = useCallback(() => {
  setProjectSettingsOpen(true);
}, []);

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
    buildWeb,
    exitToTitle,
    onSave,
    openSceneSettings,
    openProjectSettings,
    setGizmoMode,
    toolbarActions,
  };
}
