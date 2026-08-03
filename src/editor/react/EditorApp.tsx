import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
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
import type { DeployTarget } from '../../platform/editor-desktop';
import { DeployBackendModal } from './panels/deploy/DeployBackendModal';
import { DeployFrontendModal } from './panels/deploy/DeployFrontendModal';
import { MultiplayerDebugModal } from './panels/multiplayer_debug/MultiplayerDebugModal';
import { PackagesModal } from './panels/PackagesModal';
import { TranscodeTexturesModal } from './panels/TranscodeTexturesModal';
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
import { useEditorDocModals } from './use-editor-doc-modals';

function playSurvivesTabChange(current: SceneEditorTab, next: SceneEditorTab): boolean {
  if (current === 'ship') return next === 'ship';
  if (current === 'planets' || current === 'planet-authoring') {
    return next === 'planets' || next === 'planet-authoring';
  }
  return next === 'scene' || next === 'material-manager';
}

type EditorAppModalsProps = {
  deployTarget: DeployTarget | null;
  multiplayerDebugOpen: boolean;
  packagesOpen: boolean;
  transcodeOpen: boolean;
  transcodeAutoStart: boolean;
  onCloseDeploy: () => void;
  onCloseMultiplayer: () => void;
  onClosePackages: () => void;
  onCloseTranscode: () => void;
  onTranscodeAutoStartConsumed: () => void;
};

function EditorAppModals(props: EditorAppModalsProps): ReactElement {
  return (
    <>
      <DeployBackendModal
        open={props.deployTarget === 'backend'}
        onClose={props.onCloseDeploy}
      />
      <DeployFrontendModal
        open={props.deployTarget === 'client'}
        onClose={props.onCloseDeploy}
      />
      <MultiplayerDebugModal
        open={props.multiplayerDebugOpen}
        onClose={props.onCloseMultiplayer}
      />
      <PackagesModal open={props.packagesOpen} onClose={props.onClosePackages} />
      <TranscodeTexturesModal
        open={props.transcodeOpen}
        autoStart={props.transcodeAutoStart}
        onAutoStartConsumed={props.onTranscodeAutoStartConsumed}
        onClose={props.onCloseTranscode}
      />
    </>
  );
}

function useEditorRootTabClass(tab: SceneEditorTab): void {
  useEffect(() => {
    const root = document.getElementById('editor-root');
    if (!root) return;
    root.classList.toggle('is-ship', tab === 'ship');
    root.classList.toggle('is-base-characters', tab === 'base-characters');
    root.classList.toggle(
      'is-planets',
      tab === 'planets' || tab === 'planet-authoring',
    );
    root.classList.toggle('is-stations', tab === 'stations');
    root.classList.toggle(
      'is-star-map',
      tab === 'star-map' || tab === 'system-map',
    );
    // Keep the old class names for project CSS overrides and old snapshots.
    root.classList.toggle('is-planet-authoring', tab === 'planet-authoring');
    root.classList.toggle('is-system-map', tab === 'system-map');
    root.classList.toggle('is-menu-manager', tab === 'menu-manager');
    root.classList.toggle('is-server', tab === 'server');
  }, [tab]);
}

type EditorTabDockingArgs = {
  tab: SceneEditorTab;
  tabHandles: TabEditorHandles;
  hierarchyPanelRef: RefObject<HTMLDivElement | null>;
  inspectorPanelRef: RefObject<HTMLDivElement | null>;
};

function useEditorTabDocking({
  tab,
  tabHandles,
  hierarchyPanelRef,
  inspectorPanelRef,
}: EditorTabDockingArgs): void {
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
    } else if (
      (tab === 'planets' || tab === 'planet-authoring') &&
      tabHandles.planetAuthoringEditor
    ) {
      dockLeft(tabHandles.planetAuthoringEditor.getLeftPanel());
    } else if (
      (tab === 'star-map' || tab === 'system-map') &&
      tabHandles.systemMapEditor
    ) {
      dockLeft(tabHandles.systemMapEditor.getLeftPanel());
    } else if (tab === 'menu-manager' && tabHandles.menuManagerEditor) {
      dockLeft(tabHandles.menuManagerEditor.getLeftPanel());
    }

    return () => {
      for (const panel of docked) panel.remove();
    };
  }, [
    tab,
    hierarchyPanelRef,
    inspectorPanelRef,
    tabHandles.baseCharacterEditor,
    tabHandles.planetAuthoringEditor,
    tabHandles.systemMapEditor,
    tabHandles.menuManagerEditor,
  ]);
}

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
  const docModals = useEditorDocModals();
  /** Deploy → Front End… / Backend…. Self-contained modals; no store plumbing needed. */
  const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null);
  const [multiplayerDebugOpen, setMultiplayerDebugOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [transcodeOpen, setTranscodeOpen] = useState(false);
  const [transcodeAutoStart, setTranscodeAutoStart] = useState(false);

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

  useEditorRootTabClass(tab);

  // Dock tab-editor sidebars into Scene hierarchy/inspector so scene tabs sit
  // between them (same chrome as Scene).
  useEditorTabDocking({ tab, tabHandles, hierarchyPanelRef, inspectorPanelRef });

  const setTab = useCallback((next: SceneEditorTab) => {
    const handles = tabHandlesRef.current;
    const current = tabRef.current;
    if (current === 'base-characters' && next !== current && !handles.baseCharacterEditor?.canLeave()) {
      return;
    }
    if (
      (current === 'planets' || current === 'planet-authoring') &&
      next !== current &&
      !handles.planetAuthoringEditor?.canLeave()
    ) {
      return;
    }
    if (
      (current === 'star-map' || current === 'system-map') &&
      next !== current &&
      !handles.systemMapEditor?.canLeave()
    ) {
      return;
    }
    if (playingRef.current && !playSurvivesTabChange(current, next)) {
      stopInEditorPlay();
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
    deleteSceneById,
    deleteCurrentScene,
    newDocument,
    createPrefabDocument,
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
    setNewSceneOpen: docModals.setNewSceneOpen,
    setNewPrefabOpen: docModals.setNewPrefabOpen,
    confirmLeaveDocument,
    clearIsolation,
    confirmBaseDiscardIfNeeded,
    refreshPrefabList,
    refreshSceneList,
    saveCurrent,
    loadPrefabById: loadById,
  });

  const {
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
  } = useEditorAppSession({
    store,
    audioPreview,
    playing,
    paused,
    building,
    setPlaying,
    setPaused,
    setBuilding,
    setSceneSettingsOpen: docModals.setSceneSettingsOpen,
    setPrefabSettingsOpen: docModals.setPrefabSettingsOpen,
    setProjectSettingsOpen: docModals.setProjectSettingsOpen,
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
    openPrefabSettings,
    deleteCurrentScene,
    openProjectSettings,
    openDeployFrontend: () => setDeployTarget('client'),
    openDeployBackend: () => setDeployTarget('backend'),
    openMultiplayerDebug: () => setMultiplayerDebugOpen(true),
    openPackages: () => setPackagesOpen(true),
    transcodeTextures: () => {
      setTranscodeAutoStart(true);
      setTranscodeOpen(true);
    },
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
    <>
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
      onOpenStation={loadById}
      duplicateGlbNode={duplicateGlbNode}
      extractGlbNode={extractGlbNode}
      refreshPrefabLibrary={refreshPrefabLibrary}
      requestExitIsolation={requestExitIsolation}
      createItemPrefab={createItemPrefab}
      loadById={loadById}
      openShipById={openShipById}
      newShipDocument={newShipDocument}
      togglePlay={() => void togglePlay()}
      startPlanetAuthoringPlay={startPlanetAuthoringPlay}
      createPrefabsInFolder={createPrefabsInFolder}
      docModals={docModals}
      createSceneFromTemplate={createSceneFromTemplate}
      createPrefabDocument={createPrefabDocument}
      refreshPrefabList={refreshPrefabList}
    />
    <EditorAppModals
      deployTarget={deployTarget}
      multiplayerDebugOpen={multiplayerDebugOpen}
      packagesOpen={packagesOpen}
      transcodeOpen={transcodeOpen}
      transcodeAutoStart={transcodeAutoStart}
      onCloseDeploy={() => setDeployTarget(null)}
      onCloseMultiplayer={() => setMultiplayerDebugOpen(false)}
      onClosePackages={() => setPackagesOpen(false)}
      onCloseTranscode={() => {
        setTranscodeOpen(false);
        setTranscodeAutoStart(false);
      }}
      onTranscodeAutoStartConsumed={() => setTranscodeAutoStart(false)}
    />
    </>
  );
}
