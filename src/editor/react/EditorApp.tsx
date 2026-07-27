import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  installAgentBridgeListener,
  registerAgentBridge,
} from '../agent-bridge';
import { createEditorAudioPreviewController } from '../audio-preview';
import { createEditorStore } from '../document';
import type { EditorPlaySession } from '../play-in-editor';
import type { EditorViewport } from '../../render/editor/viewport';
import { takeEditorHmrSnapshot } from './hmr-snapshot';
import { useEditorStoreInstance } from './hooks';
import { usePanelSplitters } from './PanelSplitters';
import { usePrefabIsolation } from './use-prefab-isolation';
import type { ProjectPanelHandle } from './panels/ProjectPanel';
import type { ShipEditor } from './panels/ShipPanel';
import type { ToolbarHandle } from './panels/Toolbar';
import type { TabEditorHandles } from './TabEditorHosts';
import type { SceneEditorTab } from './types';
import { restoreSnapshot } from './editor-app-native';
import { EditorWorkspace } from './EditorWorkspace';
import { useEditorAppDocuments } from './use-editor-app-documents';
import { useEditorAppEffects } from './use-editor-app-effects';
import { useEditorAppSave } from './use-editor-app-save';
import { useEditorAppSession } from './use-editor-app-session';

export function EditorApp(): ReactElement {
  const store = useEditorStoreInstance(() => createEditorStore());
  const audioPreview = useMemo(() => createEditorAudioPreviewController(), []);
  const [tab, setTabState] = useState<SceneEditorTab>(() => {
    const snap = takeEditorHmrSnapshot();
    return restoreSnapshot(store, snap);
  });
  const [viewport, setViewport] = useState<EditorViewport | null>(null);
  const [tabHandles, setTabHandles] = useState<TabEditorHandles>({
    baseCharacterEditor: null,
    planetAuthoringEditor: null,
    systemMapEditor: null,
    menuManagerEditor: null,
  });
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [building, setBuilding] = useState(false);
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [newSceneOpen, setNewSceneOpen] = useState(false);

  const toolbarRef = useRef<ToolbarHandle | null>(null);
  const shipEditorRef = useRef<ShipEditor | null>(null);
  const projectRef = useRef<ProjectPanelHandle | null>(null);
  const allowUnloadRef = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const tabHandlesRef = useRef(tabHandles);
  tabHandlesRef.current = tabHandles;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const playSessionRef = useRef<EditorPlaySession | null>(null);

  const stopInEditorPlay = useCallback(() => {
    playSessionRef.current?.stop();
    playSessionRef.current = null;
    viewportRef.current?.setPlayMode(false);
    setPaused(false);
    setPlaying(false);
  }, []);

  const rootRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const hierarchyPanelRef = useRef<HTMLDivElement | null>(null);
  const inspectorPanelRef = useRef<HTMLDivElement | null>(null);
  const hierarchySplitterRef = useRef<HTMLDivElement | null>(null);
  const inspectorSplitterRef = useRef<HTMLDivElement | null>(null);
  const projectSplitterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rootRef.current = document.getElementById('editor-root');
  }, []);

  useEffect(() => {
    const syncTitle = (): void => {
      const name = store.getState().prefabName.trim() || 'Untitled';
      document.title = `AsteronEngine - ${name}`;
    };
    syncTitle();
    return store.subscribe((event) => {
      if (event.type === 'document') syncTitle();
    });
  }, [store]);

  usePanelSplitters({
    rootRef,
    mainRef,
    hierarchySplitterRef,
    inspectorSplitterRef,
    projectSplitterRef,
  });

  useEffect(() => {
    const root = document.getElementById('editor-root');
    if (!root) return;
    root.classList.toggle('is-ship', tab === 'ship');
    root.classList.toggle('is-base-characters', tab === 'base-characters');
    root.classList.toggle('is-planet-authoring', tab === 'planet-authoring');
    root.classList.toggle('is-system-map', tab === 'system-map');
    root.classList.toggle('is-menu-manager', tab === 'menu-manager');
    root.classList.toggle('is-server', tab === 'server');
  }, [tab]);

  // Dock tab-editor sidebars into Scene hierarchy/inspector so scene tabs sit
  // between them (same chrome as Scene).
  useEffect(() => {
    const hierarchy = hierarchyPanelRef.current;
    const inspector = inspectorPanelRef.current;
    if (!hierarchy) return;

    const docked: HTMLElement[] = [];
    const dockLeft = (panel: HTMLElement): void => {
      if (panel.parentElement !== hierarchy) hierarchy.append(panel);
      docked.push(panel);
    };
    const dockRight = (panel: HTMLElement): void => {
      if (!inspector) return;
      if (panel.parentElement !== inspector) inspector.append(panel);
      docked.push(panel);
    };

    if (tab === 'base-characters' && tabHandles.baseCharacterEditor) {
      dockLeft(tabHandles.baseCharacterEditor.getLeftPanel());
      dockRight(tabHandles.baseCharacterEditor.getRightPanel());
    } else if (tab === 'planet-authoring' && tabHandles.planetAuthoringEditor) {
      dockLeft(tabHandles.planetAuthoringEditor.getLeftPanel());
    } else if (tab === 'system-map' && tabHandles.systemMapEditor) {
      dockLeft(tabHandles.systemMapEditor.getLeftPanel());
    } else if (tab === 'menu-manager' && tabHandles.menuManagerEditor) {
      dockLeft(tabHandles.menuManagerEditor.getLeftPanel());
    }

    return () => {
      for (const panel of docked) panel.remove();
    };
  }, [
    tab,
    tabHandles.baseCharacterEditor,
    tabHandles.planetAuthoringEditor,
    tabHandles.systemMapEditor,
    tabHandles.menuManagerEditor,
  ]);

  const setTab = useCallback((next: SceneEditorTab) => {
    const handles = tabHandlesRef.current;
    const current = tabRef.current;
    if (current === 'base-characters' && next !== current && !handles.baseCharacterEditor?.canLeave()) {
      return;
    }
    if (
      current === 'planet-authoring' &&
      next !== current &&
      !handles.planetAuthoringEditor?.canLeave()
    ) {
      return;
    }
    if (current === 'system-map' && next !== current && !handles.systemMapEditor?.canLeave()) {
      return;
    }
    if (playingRef.current) {
      // A ship playtest belongs to the Ship tab; scene Play survives the two
      // tabs that keep showing the scene viewport.
      const survivesTabChange =
        current === 'ship'
          ? next === 'ship'
          : next === 'scene' || next === 'material-manager';
      if (!survivesTabChange) stopInEditorPlay();
    }
    setTabState(next);
    if (next === 'base-characters') {
      projectRef.current?.selectFolder('protected/animations');
    }
  }, [stopInEditorPlay]);

  const onTabHandles = useCallback((handles: TabEditorHandles) => {
    setTabHandles(handles);
  }, []);

  const {
    duplicateGlbNode,
    duplicateSelection,
    extractGlbNode,
    deleteSelection,
    refreshPrefabList,
    refreshPrefabLibrary,
    refreshSceneList,
    refreshPlanetList,
    saveCurrent,
  } = useEditorAppSave({
    store,
    viewportRef,
    toolbarRef,
    projectRef,
  });

  const {
    isolationRef,
    isolationUi,
    confirmDiscard,
    confirmLeaveDocument,
    clearIsolation,
    requestExitIsolation,
    loadPrefabById: loadById,
    confirmBaseDiscardIfNeeded,
    hasUnsavedWork,
  } = usePrefabIsolation({
    store,
    audioPreview,
    saveCurrent,
    stopInEditorPlay,
    playingRef,
    setTab,
  });
  const isolationUiRef = useRef(isolationUi);
  isolationUiRef.current = isolationUi;

  const {
    createPrefabsInFolder,
    loadSceneById,
    newDocument,
    newSceneDocument,
    newShipDocument,
    openShipById,
    createSceneFromTemplate,
    createItemPrefab,
    saveActive,
  } = useEditorAppDocuments({
    store,
    audioPreview,
    tabRef,
    tabHandlesRef,
    playingRef,
    stopInEditorPlay,
    setTab,
    setNewSceneOpen,
    confirmLeaveDocument,
    clearIsolation,
    confirmBaseDiscardIfNeeded,
    refreshPrefabList,
    saveCurrent,
    loadPrefabById: loadById,
  });

  const {
    togglePlay,
    togglePause,
    buildWeb,
    exitToTitle,
    onSave,
    openSceneSettings,
    openProjectSettings,
    setGizmoMode,
    toolbarActions,
  } = useEditorAppSession({
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
    duplicateSelection,
    deleteSelection,
    confirmDiscard,
    hasUnsavedWork,
  });

  useEditorAppEffects({
    store,
    setBuilding,
    setTab,
    tabRef,
    tabHandlesRef,
    toolbarRef,
    viewportRef,
    playingRef,
    allowUnloadRef,
    isolationRef,
    refreshPrefabList,
    refreshSceneList,
    refreshPlanetList,
    togglePlay,
    togglePause,
    stopInEditorPlay,
    buildWeb,
    newSceneDocument,
    newDocument,
    onSave,
    openSceneSettings,
    openProjectSettings,
    duplicateSelection,
    deleteSelection,
    exitToTitle,
    loadById,
    loadSceneById,
    setGizmoMode,
    requestExitIsolation,
    hasUnsavedWork,
  });

  useEffect(() => {
    const unsubscribeListener = installAgentBridgeListener();
    return unsubscribeListener;
  }, []);

  useEffect(() => {
    return registerAgentBridge({
      store,
      getTab: () => tabRef.current,
      getPlaying: () => playingRef.current,
      getPaused: () => pausedRef.current,
      getIsolation: () => isolationUiRef.current,
      getCaptureTarget: () => {
        const tab = tabRef.current;
        const playing = playingRef.current;
        const element = playing
          ? document.getElementById('editor-play-host')
          : tab === 'scene' || tab === 'ship'
            ? document.querySelector('.ed-viewport')
            : null;
        if (!(element instanceof HTMLElement)) return null;
        const bounds = element.getBoundingClientRect();
        const width = Math.floor(bounds.width);
        const height = Math.floor(bounds.height);
        if (width <= 0 || height <= 0) return null;
        return {
          source: playing ? 'play' : 'scene',
          tab,
          playing,
          rect: {
            x: Math.floor(bounds.x),
            y: Math.floor(bounds.y),
            width,
            height,
          },
        };
      },
      play: () => {
        if (!playingRef.current) togglePlay();
      },
      stopPlay: stopInEditorPlay,
      save: () => {
        void onSave();
      },
      loadSceneById,
      loadPrefabById: loadById,
    });
  }, [store, togglePlay, stopInEditorPlay, onSave, loadSceneById, loadById]);

  return (
    <EditorWorkspace
      store={store}
      audioPreview={audioPreview}
      tab={tab}
      setTab={setTab}
      viewport={viewport}
      setViewport={setViewport}
      playing={playing}
      isolationUi={isolationUi}
      toolbarRef={toolbarRef}
      shipEditorRef={shipEditorRef}
      projectRef={projectRef}
      mainRef={mainRef}
      hierarchyPanelRef={hierarchyPanelRef}
      inspectorPanelRef={inspectorPanelRef}
      hierarchySplitterRef={hierarchySplitterRef}
      inspectorSplitterRef={inspectorSplitterRef}
      projectSplitterRef={projectSplitterRef}
      viewportRef={viewportRef}
      tabHandlesRef={tabHandlesRef}
      toolbarActions={toolbarActions}
      onTabHandles={onTabHandles}
      duplicateGlbNode={duplicateGlbNode}
      extractGlbNode={extractGlbNode}
      refreshPrefabLibrary={refreshPrefabLibrary}
      requestExitIsolation={requestExitIsolation}
      createItemPrefab={createItemPrefab}
      loadById={loadById}
      openShipById={openShipById}
      newShipDocument={newShipDocument}
      togglePlay={() => void togglePlay()}
      createPrefabsInFolder={createPrefabsInFolder}
      newSceneOpen={newSceneOpen}
      setNewSceneOpen={setNewSceneOpen}
      createSceneFromTemplate={createSceneFromTemplate}
      sceneSettingsOpen={sceneSettingsOpen}
      setSceneSettingsOpen={setSceneSettingsOpen}
      projectSettingsOpen={projectSettingsOpen}
      setProjectSettingsOpen={setProjectSettingsOpen}
    />
  );
}
