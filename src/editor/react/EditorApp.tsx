import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  fetchPlanetList,
  fetchPrefabList,
  fetchScene,
  fetchSceneList,
  savePrefab,
  saveScene,
  type AssetRoot,
} from '../api';
import { createPrefabFromSelection } from '../create-prefab-from-selection';
import { createEditorAudioPreviewController } from '../audio-preview';
import { getDesktopEditorBridge } from '../../platform/editor-desktop';
import { createEditorStore, type EditorStore } from '../document';
import { showToast } from '../dom';
import {
  createSceneEditorStateFromTemplate,
  fromPrefabDocument,
  fromSceneDocument,
  toPrefabDocument,
  toSceneDocument,
} from '../serialize';
import { startEditorPlay, type EditorPlaySession } from '../play-in-editor';
import {
  addAssetEntity,
  addBox,
  addEmpty,
  addPrefabInstanceEntity,
  isTypingTarget,
  itemNameFromUrl,
} from '../session-helpers';
import { parsePrefabDocument, slugifyPrefabName } from '../../world/prefabs/schema';
import { parseSceneDocument, SCENE_ID_PATTERN } from '../../world/scenes/schema';
import type { SceneTemplateId } from '../../world/scenes/templates';
import { getModelThumbnail } from '../../render/editor/thumbnails';
import type { EditorViewport } from '../../render/editor/viewport';
import type { Vec3 } from '../../types';
import { saveEditorHmrSnapshot, takeEditorHmrSnapshot } from './hmr-snapshot';
import { useEditorStoreInstance } from './hooks';
import { usePanelSplitters } from './PanelSplitters';
import { usePrefabIsolation } from './use-prefab-isolation';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { MaterialManagerPanel } from './panels/MaterialManagerPanel';
import { ProjectPanel, type ProjectPanelHandle } from './panels/ProjectPanel';
import { NewSceneModal } from './panels/NewSceneModal';
import { ProjectSettingsModal } from './panels/ProjectSettingsModal';
import { SceneSettingsModal } from './panels/SceneSettingsModal';
import {
  Toolbar,
  type BrowsePanelKind,
  type ToolbarGizmoMode,
  type ToolbarHandle,
} from './panels/Toolbar';
import { TabEditorHosts, type TabEditorHandles } from './TabEditorHosts';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';
import { ViewportHost } from './ViewportHost';
import type { DesktopNativeCommand } from '../../platform/editor-desktop';

function restoreSnapshot(
  store: EditorStore,
  snapshot: ReturnType<typeof takeEditorHmrSnapshot>,
): SceneEditorTab {
  if (!snapshot) return 'scene';
  if (snapshot.prefabDocument) {
    store.loadDocument(fromPrefabDocument(snapshot.prefabDocument));
    if (!snapshot.dirty) store.markSaved();
  }
  if (snapshot.selectedIds.length > 0) {
    const [first, ...rest] = snapshot.selectedIds;
    store.setSelection(first ?? null);
    for (const id of rest) store.setEntitySelection(id, 'toggle');
  }
  if (snapshot.subSelection) {
    store.setSubSelection(snapshot.subSelection.entityId, snapshot.subSelection.nodeUuid);
  }
  const known = SCENE_EDITOR_TABS.some((entry) => entry.id === snapshot.tab);
  return known ? snapshot.tab : 'scene';
}

const GIZMO_SHORTCUTS: Readonly<Partial<Record<string, ToolbarGizmoMode>>> = {
  w: 'translate',
  e: 'rotate',
  r: 'scale',
};

type NativeCommandHandlers = {
  togglePlay: () => void;
  togglePause: () => void;
  stopPlay: () => void;
  buildWeb: () => void;
  newScene: () => void;
  newPrefab: () => void;
  save: () => void;
  openBrowse: (panel: BrowsePanelKind) => void;
  openSceneSettings: () => void;
  openProjectSettings: () => void;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  exitToTitle: () => void;
  reloadSidekickPack: () => void;
};

function dispatchNativeCommand(
  command: DesktopNativeCommand,
  handlers: NativeCommandHandlers,
): void {
  const actions: Record<DesktopNativeCommand['type'], () => void> = {
    play: handlers.togglePlay,
    'pause-play': handlers.togglePause,
    'stop-play': handlers.stopPlay,
    'build-web': handlers.buildWeb,
    'new-scene': handlers.newScene,
    'new-prefab': handlers.newPrefab,
    save: handlers.save,
    'open-scene': () => handlers.openBrowse('scene'),
    'open-prefab': () => handlers.openBrowse('prefab'),
    'open-planet': () => handlers.openBrowse('planet'),
    'open-menu': () => handlers.openBrowse('menu'),
    'open-scene-settings': handlers.openSceneSettings,
    'open-project-settings': handlers.openProjectSettings,
    undo: handlers.undo,
    redo: handlers.redo,
    duplicate: handlers.duplicate,
    delete: handlers.deleteSelection,
    'exit-to-title': handlers.exitToTitle,
    'new-project': () => {},
    'sidekick-pack-changed': handlers.reloadSidekickPack,
  };
  actions[command.type]?.();
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
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [newSceneOpen, setNewSceneOpen] = useState(false);

  const toolbarRef = useRef<ToolbarHandle | null>(null);
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
    if (playingRef.current && next !== 'scene' && next !== 'material-manager') {
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

  const duplicateGlbNode = useCallback(
    (entityId: string, nodeUuid: string) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const nodeName = store.getGlbNodeName(entityId, nodeUuid);
      const transform = vp.getGlbNodePrefabTransform(entityId, nodeUuid);
      if (!nodeName || !transform) {
        showToast('Could not duplicate the model node — its transform is unavailable.', true);
        return;
      }
      if (!store.duplicateGlbNode(entityId, nodeName, transform)) {
        showToast('Could not duplicate the model node.', true);
      }
    },
    [store],
  );

  const duplicateSelection = useCallback(() => {
    const sub = store.getSubSelection();
    if (sub) {
      duplicateGlbNode(sub.entityId, sub.nodeUuid);
      return;
    }
    const selectedIds = store.getSelectedIds();
    if (selectedIds.length > 0) store.duplicateEntities(selectedIds);
  }, [store, duplicateGlbNode]);

  const extractGlbNode = useCallback(
    (entityId: string, nodeUuid: string, targetParentId: string | null): boolean => {
      const vp = viewportRef.current;
      if (!vp) return false;
      const transform = vp.getGlbNodePrefabTransform(entityId, nodeUuid, targetParentId);
      if (!transform) {
        showToast('Could not move the model node — its target transform is unavailable.', true);
        return false;
      }
      if (!store.extractGlbNode(entityId, nodeUuid, targetParentId, transform)) {
        showToast('Could not move the model node out of its prefab.', true);
        return false;
      }
      return true;
    },
    [store],
  );

  const deleteSelection = useCallback(() => {
    const sub = store.getSubSelection();
    if (sub) {
      store.hideGlbNode(sub.entityId, sub.nodeUuid);
      return;
    }
    const selectedIds = store.getSelectedIds();
    if (selectedIds.length > 0) store.deleteEntities(selectedIds);
  }, [store]);

  // Cached so a fetch that finishes before Toolbar mounts is not dropped.
  const prefabListCacheRef = useRef<Awaited<ReturnType<typeof fetchPrefabList>> | null>(null);
  const sceneListCacheRef = useRef<Awaited<ReturnType<typeof fetchSceneList>> | null>(null);
  const planetListCacheRef = useRef<Awaited<ReturnType<typeof fetchPlanetList>> | null>(null);

  const refreshPrefabList = useCallback(async () => {
    try {
      const prefabs = await fetchPrefabList();
      prefabListCacheRef.current = prefabs;
      toolbarRef.current?.setPrefabOptions(prefabs);
    } catch {
      // Dev API unavailable.
    }
  }, []);

  /**
   * Prefab files are project assets, and there is no filesystem watcher, so
   * every write has to refresh both the Open Prefab list and the Project panel.
   */
  const refreshPrefabLibrary = useCallback(() => {
    void refreshPrefabList();
    void projectRef.current?.refresh();
  }, [refreshPrefabList]);

  const refreshSceneList = useCallback(async () => {
    try {
      const scenes = await fetchSceneList();
      sceneListCacheRef.current = scenes;
      toolbarRef.current?.setSceneOptions(scenes);
    } catch {
      // Dev API unavailable.
    }
  }, []);

  const refreshPlanetList = useCallback(async () => {
    try {
      const planets = await fetchPlanetList();
      planetListCacheRef.current = planets;
      toolbarRef.current?.setPlanetOptions(planets);
    } catch {
      const fallback = [{ id: 'asteron', name: 'Asteron' }];
      planetListCacheRef.current = fallback;
      toolbarRef.current?.setPlanetOptions(fallback);
    }
  }, []);

  const saveCurrent = useCallback(async (): Promise<string | null> => {
    const state = store.getState();
    const id = state.prefabId || slugifyPrefabName(state.prefabName);
    const isScene = state.documentType === 'scene';
    if (!id) {
      showToast(`Give the ${isScene ? 'scene' : 'prefab'} a name before saving.`, true);
      return null;
    }
    if (isScene && !SCENE_ID_PATTERN.test(id)) {
      showToast('Scene id must be a lowercase slug.', true);
      return null;
    }
    store.setDocumentMeta({ prefabId: id });
    try {
      if (isScene) {
        const doc = parseSceneDocument(toSceneDocument(store.getState()));
        if (!doc) {
          showToast('Scene document is invalid.', true);
          return null;
        }
        const path = await saveScene(doc);
        store.markSaved();
        showToast(`Saved ${path}`);
        void refreshSceneList();
        return id;
      }
      if (state.roots.length === 0) {
        showToast('Nothing to save — the prefab is empty.', true);
        return null;
      }
      const doc = parsePrefabDocument(toPrefabDocument(store.getState()));
      const path = await savePrefab(doc);
      store.markSaved();
      showToast(`Saved ${path}`);
      refreshPrefabLibrary();
      return id;
    } catch (error) {
      showToast(`Save failed: ${(error as Error).message}`, true);
      return null;
    }
  }, [store, refreshPrefabLibrary, refreshSceneList]);

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

  /**
   * Hierarchy -> Project folder drop. Each dragged GameObject becomes a prefab
   * in that folder and is replaced in the scene by a `prefab-instance`.
   */
  const createPrefabsInFolder = useCallback(
    async (entityIds: string[], target: { root: AssetRoot; folder: string }) => {
      const created: string[] = [];
      for (const entityId of entityIds) {
        const id = await createPrefabFromSelection(store, entityId, undefined, target);
        if (id) created.push(id);
      }
      // The panel refreshes its own listing after revealing the target folder.
      if (created.length > 0) void refreshPrefabList();
      return created;
    },
    [store, refreshPrefabList],
  );

  const loadSceneById = useCallback(
    async (id: string) => {
      if (!(await confirmLeaveDocument())) return;
      audioPreview.stop();
      if (playingRef.current) stopInEditorPlay();
      clearIsolation();
      try {
        const doc = await fetchScene(id);
        store.loadDocument(fromSceneDocument(doc));
        setTab('scene');
        showToast(`Loaded scene "${id}"`);
      } catch (error) {
        showToast(`Load failed: ${(error as Error).message}`, true);
      }
    },
    [
      store,
      audioPreview,
      confirmLeaveDocument,
      clearIsolation,
      stopInEditorPlay,
      setTab,
    ],
  );

  const newDocument = useCallback(async () => {
    if (!(await confirmLeaveDocument({ discardMessage: 'Discard unsaved changes?' }))) {
      return;
    }
    audioPreview.stop();
    if (playingRef.current) stopInEditorPlay();
    clearIsolation();
    store.newDocument();
    setTab('scene');
  }, [
    store,
    audioPreview,
    confirmLeaveDocument,
    clearIsolation,
    stopInEditorPlay,
    setTab,
  ]);

  const newSceneDocument = useCallback(async () => {
    if (
      !(await confirmLeaveDocument({
        discardMessage: 'Discard unsaved changes?',
        deferBaseDiscard: true,
      }))
    ) {
      return;
    }
    setNewSceneOpen(true);
  }, [confirmLeaveDocument]);

  const createSceneFromTemplate = useCallback(
    async (templateId: SceneTemplateId, name: string) => {
      if (!(await confirmBaseDiscardIfNeeded())) return;
      setNewSceneOpen(false);
      audioPreview.stop();
      if (playingRef.current) stopInEditorPlay();
      clearIsolation();
      store.loadDocument(createSceneEditorStateFromTemplate(templateId, '', name));
      setTab('scene');
    },
    [
      store,
      audioPreview,
      clearIsolation,
      stopInEditorPlay,
      setTab,
      confirmBaseDiscardIfNeeded,
    ],
  );

  const createItemPrefab = useCallback(
    async (url: string) => {
      if (
        !(await confirmLeaveDocument({
          discardMessage: 'Discard unsaved changes and create an item prefab?',
        }))
      ) {
        return;
      }
      audioPreview.stop();
      if (playingRef.current) stopInEditorPlay();
      clearIsolation();
      const name = itemNameFromUrl(url);
      store.newDocument();
      store.setDocumentMeta({ kind: 'item', prefabName: name, prefabId: slugifyPrefabName(name) });
      addAssetEntity(store, url, { x: 0, y: 0, z: 0 });
      setTab('scene');
      showToast(`Created item prefab "${name}". Add sockets if this is a backpack, then save.`);
    },
    [
      store,
      audioPreview,
      confirmLeaveDocument,
      clearIsolation,
      stopInEditorPlay,
      setTab,
    ],
  );

  const saveActive = useCallback(async (): Promise<boolean> => {
    const current = tabRef.current;
    const handles = tabHandlesRef.current;
    // The Server console writes straight to the backend; nothing to save here.
    if (current === 'server') return true;
    const documentIsActive = current === 'scene' || current === 'material-manager';
    if (!documentIsActive && store.isDirty() && !(await saveCurrent())) return false;
    if (current === 'system-map') return handles.systemMapEditor?.save() ?? false;
    if (current === 'planet-authoring') return handles.planetAuthoringEditor?.save() ?? false;
    if (current === 'base-characters') {
      await handles.baseCharacterEditor?.save();
      return true;
    }
    if (current === 'menu-manager') return handles.menuManagerEditor?.save() ?? true;
    return (await saveCurrent()) !== null;
  }, [saveCurrent, store]);

  /**
   * Unity-style Play: every tab plays the open document in the Game view. Tabs
   * with their own editor save first so the runtime reads current data.
   */
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
      onLoadPlanet: (id: string) => {
        setTab('planet-authoring');
        void tabHandlesRef.current.planetAuthoringEditor?.loadPlanet(id);
      },
      onOpenSceneSettings: openSceneSettings,
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

  // Prefab/planet/scene lists for File → Open… browse dialogs.
  useEffect(() => {
    void refreshPrefabList();
    void refreshSceneList();
    void refreshPlanetList();
  }, [refreshPrefabList, refreshSceneList, refreshPlanetList]);

  useEffect(() => {
    const bridge = getDesktopEditorBridge();
    if (!bridge) return;
    const unsubscribeBuild = bridge.onBuildState((state) => {
      setBuilding(state.phase === 'building');
    });
    const unsubscribeCommand = bridge.onNativeCommand((command) => {
      dispatchNativeCommand(command, {
        togglePlay: () => void togglePlay(),
        togglePause,
        stopPlay: stopInEditorPlay,
        buildWeb: () => void buildWeb(),
        newScene: () => void newSceneDocument(),
        newPrefab: () => void newDocument(),
        save: onSave,
        openBrowse: (panel) => toolbarRef.current?.openBrowsePanel(panel),
        openSceneSettings,
        openProjectSettings: openProjectSettings,
        undo: () => store.undo(),
        redo: () => store.redo(),
        duplicate: duplicateSelection,
        deleteSelection,
        exitToTitle: () => void exitToTitle(),
        reloadSidekickPack: () => {
          void tabHandlesRef.current.baseCharacterEditor?.reloadSidekickPack?.();
        },
      });
    });
    return () => {
      unsubscribeBuild();
      unsubscribeCommand();
    };
  }, [
    buildWeb,
    togglePlay,
    togglePause,
    stopInEditorPlay,
    newSceneDocument,
    newDocument,
    onSave,
    openSceneSettings,
    openProjectSettings,
    store,
    duplicateSelection,
    deleteSelection,
    exitToTitle,
  ]);

  // Boot query params + default open main-game scene when starting fresh.
  useEffect(() => {
    const bootParams = new URLSearchParams(window.location.search);
    const prefabParam = bootParams.get('prefab');
    const sceneParam = bootParams.get('openScene');
    if (prefabParam) {
      setTab('scene');
      void loadById(prefabParam);
      return;
    }
    if (sceneParam) {
      setTab('scene');
      void loadSceneById(sceneParam);
      return;
    }
    if (bootParams.get('tab') === 'planet') setTab('planet-authoring');
    if (bootParams.get('tab') === 'system') setTab('system-map');
    if (bootParams.get('tab') === 'menu') {
      setTab('menu-manager');
      const menuId = bootParams.get('menu');
      if (menuId) {
        queueMicrotask(() => tabHandlesRef.current.menuManagerEditor?.openMenu(menuId));
      }
      return;
    }
    // Cold start: open main-game scene when the store is still an empty untitled scene.
    const state = store.getState();
    if (
      state.documentType === 'scene'
      && !state.prefabId
      && state.roots.length === 0
      && !takeEditorHmrSnapshot()
    ) {
      void loadSceneById('main-game');
    }
  }, [loadById, loadSceneById, setTab, store]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleEscape = (): void => {
      if (store.getSelectedIds().length > 0 || store.getSubSelection()) {
        store.clearSelection();
        return;
      }
      if (isolationRef.current.isActive()) {
        void requestExitIsolation();
        return;
      }
      store.clearSelection();
    };

    const handleModKey = (key: string, shiftKey: boolean): boolean => {
      if (key === 's') {
        onSave();
        return true;
      }
      if (key === 'b') {
        void buildWeb();
        return true;
      }
      if (key === 'd') {
        duplicateSelection();
        return true;
      }
      if (key === 'z') {
        if (shiftKey) store.redo();
        else store.undo();
        return true;
      }
      if (key === 'y') {
        store.redo();
        return true;
      }
      return false;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (viewportRef.current?.isFlying()) return;

      if (event.key === 'F6') {
        event.preventDefault();
        void togglePlay();
        return;
      }

      // Play Mode: Scene view is live — only fly / stop, no edit shortcuts.
      if (playingRef.current) return;

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (handleModKey(key, event.shiftKey)) event.preventDefault();
        return;
      }

      const key = event.key.toLowerCase();
      const gizmoMode = GIZMO_SHORTCUTS[key];
      if (gizmoMode) {
        setGizmoMode(gizmoMode);
        return;
      }

      switch (key) {
        case 'f':
          viewportRef.current?.focusSelection();
          break;
        case 'backspace':
          // Delete is owned by the Electron Edit menu accelerator so it is
          // not handled here — both would fire and the second pass would
          // delete the parent entity after a GLB-node hide clears subSelection.
          event.preventDefault();
          deleteSelection();
          break;
        case 'escape':
          handleEscape();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    store,
    onSave,
    buildWeb,
    togglePlay,
    duplicateSelection,
    deleteSelection,
    setGizmoMode,
    requestExitIsolation,
  ]);

  // beforeunload + HMR snapshot
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const handles = tabHandlesRef.current;
      if (
        allowUnloadRef.current ||
        (!hasUnsavedWork() &&
          !handles.baseCharacterEditor?.isDirty() &&
          !handles.planetAuthoringEditor?.isDirty() &&
          !handles.systemMapEditor?.isDirty())
      ) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    const saveSnapshot = (): void => {
      try {
        const doc = parsePrefabDocument(toPrefabDocument(store.getState()));
        saveEditorHmrSnapshot({
          tab: tabRef.current,
          prefabDocument: doc,
          dirty: store.isDirty(),
          selectedIds: store.getSelectedIds(),
          subSelection: store.getSubSelection(),
        });
      } catch {
        saveEditorHmrSnapshot({
          tab: tabRef.current,
          prefabDocument: null,
          dirty: store.isDirty(),
          selectedIds: store.getSelectedIds(),
          subSelection: store.getSubSelection(),
        });
      }
    };

    if (import.meta.hot) {
      import.meta.hot.dispose(saveSnapshot);
    }

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      saveSnapshot();
    };
  }, [store, hasUnsavedWork]);

  return (
    <>
      <Toolbar ref={toolbarRef} store={store} actions={toolbarActions} />

      <div ref={mainRef} className="ed-main">
        <div ref={hierarchyPanelRef} className="ed-panel ed-hierarchy-panel">
          <div
            className={`ed-panel-swap${
              tab === 'base-characters' ||
              tab === 'planet-authoring' ||
              tab === 'system-map' ||
              tab === 'menu-manager'
                ? ' is-hidden'
                : ''
            }`}
          >
            <HierarchyPanel
              store={store}
              getGlbNodePrefabPosition={(entityId, nodeUuid) =>
                viewportRef.current?.getGlbNodePrefabPosition(entityId, nodeUuid) ?? null
              }
              getGlbNodeBounds={(entityId, nodeUuid) =>
                viewportRef.current?.getGlbNodeBounds(entityId, nodeUuid) ?? null
              }
              onDuplicateGlbNode={duplicateGlbNode}
              onExtractGlbNode={extractGlbNode}
              onPrefabLibraryChanged={refreshPrefabLibrary}
            />
          </div>
        </div>
        <div
          ref={hierarchySplitterRef}
          className="ed-splitter ed-splitter-col ed-hierarchy-splitter"
        />

        <div className={`ed-scene-shell${isolationUi ? ' has-isolation' : ''}`}>
          <div className="ed-scene-tabs">
            {SCENE_EDITOR_TABS.map((entry) => {
              const label =
                entry.id === 'scene' &&
                (store.getState().documentType === 'prefab' || isolationUi)
                  ? 'Prefab'
                  : entry.label;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`ed-scene-tab${tab === entry.id ? ' is-active' : ''}`}
                  onClick={() => setTab(entry.id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {isolationUi ? (
            <div className="ed-prefab-isolation-bar" role="status">
              <button
                type="button"
                className="ed-btn ed-prefab-isolation-back"
                onClick={() => void requestExitIsolation()}
                title="Return to scene (Esc)"
              >
                ← Scene
              </button>
              <span className="ed-prefab-isolation-crumb">
                <span className="ed-prefab-isolation-scene">{isolationUi.sceneName}</span>
                <span className="ed-prefab-isolation-sep" aria-hidden="true">
                  ›
                </span>
                <span className="ed-prefab-isolation-prefab">{isolationUi.prefabName}</span>
              </span>
              <span className="ed-prefab-isolation-hint">Editing Prefab</span>
            </div>
          ) : null}
          <div className="ed-scene-body">
            <ViewportHost
              store={store}
              hidden={tab !== 'scene'}
              playing={playing && (tab === 'scene' || tab === 'material-manager')}
              onReady={setViewport}
              onDropAsset={(url: string, position: Vec3) =>
                addAssetEntity(store, url, position)
              }
              onDropPrefab={(prefabId: string, position: Vec3) =>
                addPrefabInstanceEntity(store, prefabId, position)
              }
            />
            <div
              className={`ed-scene-panel ed-material-manager${
                tab !== 'material-manager' ? ' is-hidden' : ''
              }`}
            >
              <MaterialManagerPanel store={store} />
            </div>
            <TabEditorHosts tab={tab} onHandles={onTabHandles} />
          </div>
        </div>

        <div
          ref={inspectorSplitterRef}
          className="ed-splitter ed-splitter-col ed-inspector-splitter"
        />
        <div ref={inspectorPanelRef} className="ed-panel ed-inspector-panel">
          <div
            className={`ed-panel-swap${
              tab === 'base-characters' ? ' is-hidden' : ''
            }`}
          >
            {viewport ? (
              <InspectorPanel
                store={store}
                audioPreview={audioPreview}
                particlePreview={viewport.particlePreview}
                getGlbNodeLocalTransform={(entityId, nodeUuid) =>
                  viewport.getGlbNodeLocalTransform(entityId, nodeUuid)
                }
                setGlbNodeLocalTransform={(entityId, nodeUuid, transform) =>
                  viewport.setGlbNodeLocalTransform(entityId, nodeUuid, transform)
                }
                getGlbNodeBounds={(entityId, nodeUuid) =>
                  viewport.getGlbNodeBounds(entityId, nodeUuid)
                }
                onToggleShipDoorPreview={(doorId) =>
                  toolbarRef.current?.toggleDoorPreview(doorId)
                }
              />
            ) : null}
          </div>
        </div>

        <div
          ref={projectSplitterRef}
          className="ed-splitter ed-splitter-row ed-project-splitter"
        />
        <ProjectPanel
          ref={projectRef}
          audioPreview={audioPreview}
          getModelThumbnail={getModelThumbnail}
          onPreviewAnimationSource={async (url) => {
            setTab('base-characters');
            await tabHandlesRef.current.baseCharacterEditor?.loadAnimationFromAsset(url);
          }}
          onCreateItemPrefab={createItemPrefab}
          onOpenPrefab={(prefabId) => void loadById(prefabId)}
          onCreatePrefabsInFolder={createPrefabsInFolder}
        />
      </div>

      <NewSceneModal
        open={newSceneOpen}
        onCancel={() => setNewSceneOpen(false)}
        onCreate={createSceneFromTemplate}
      />
      <SceneSettingsModal
        open={sceneSettingsOpen}
        store={store}
        onClose={() => setSceneSettingsOpen(false)}
      />
      <ProjectSettingsModal
        open={projectSettingsOpen}
        onClose={() => setProjectSettingsOpen(false)}
      />
    </>
  );
}
