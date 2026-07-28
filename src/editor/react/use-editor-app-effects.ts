import { useEffect, type MutableRefObject, type RefObject } from 'react';
import { getDesktopEditorBridge } from '../../platform/editor-desktop';
import type { EditorStore } from '../document';
import { isTypingTarget } from '../session-helpers';
import { parsePrefabDocument } from '../../world/prefabs/schema';
import { toPrefabDocument } from '../serialize';
import { fetchEditorSession, fetchProjectSettings, fetchScene } from '../api';
import { saveEditorHmrSnapshot, takeEditorHmrSnapshot } from './hmr-snapshot';
import { dispatchNativeCommand, GIZMO_SHORTCUTS } from './editor-app-native';
import type { ToolbarGizmoMode, ToolbarHandle } from './panels/Toolbar';
import type { TabEditorHandles } from './TabEditorHosts';
import type { SceneEditorTab } from './types';
import type { EditorViewport } from '../../render/editor/viewport';

const FALLBACK_BOOT_SCENE_ID = 'main-game';

/**
 * Scene the editor opens on a cold start: where you left off, else the
 * project's own boot scene, else the scaffold default. Consulting
 * `defaultScene` matters now that it names the document owning the game flow —
 * opening a different scene would hide the project's entry point.
 */
async function resolveBootSceneId(): Promise<string> {
  const candidates: string[] = [];
  try {
    const session = await fetchEditorSession();
    if (session.lastOpenedSceneId) candidates.push(session.lastOpenedSceneId);
  } catch {
    // No project session yet — fall through to the project default.
  }
  try {
    const { defaultScene } = await fetchProjectSettings();
    if (defaultScene) candidates.push(defaultScene);
  } catch {
    // A project without settings must not break cold start.
  }
  candidates.push(FALLBACK_BOOT_SCENE_ID);

  for (const id of [...new Set(candidates)]) {
    try {
      await fetchScene(id);
      return id;
    } catch {
      // Try the next candidate.
    }
  }
  return FALLBACK_BOOT_SCENE_ID;
}

export type EditorAppEffectsArgs = {
  store: EditorStore;
  setBuilding: (v: boolean) => void;
  setTab: (next: SceneEditorTab) => void;
  tabRef: MutableRefObject<SceneEditorTab>;
  tabHandlesRef: MutableRefObject<TabEditorHandles>;
  toolbarRef: RefObject<ToolbarHandle | null>;
  viewportRef: MutableRefObject<EditorViewport | null>;
  playingRef: MutableRefObject<boolean>;
  allowUnloadRef: MutableRefObject<boolean>;
  isolationRef: { current: { isActive: () => boolean } };
  refreshPrefabList: () => Promise<void>;
  refreshSceneList: () => Promise<void>;
  refreshPlanetList: () => Promise<void>;
  togglePlay: () => void | Promise<void>;
  togglePause: () => void;
  stopInEditorPlay: () => void;
  buildWeb: () => void | Promise<void>;
  newSceneDocument: () => void | Promise<void>;
  newDocument: () => void | Promise<void>;
  onSave: () => void;
  openSceneSettings: () => void;
  deleteCurrentScene: () => void | Promise<void>;
  openProjectSettings: () => void;
  openDeployFrontend: () => void;
  openDeployBackend: () => void;
  openMultiplayerDebug: () => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  exitToTitle: () => void | Promise<void>;
  loadById: (id: string) => void | Promise<void>;
  loadSceneById: (id: string) => void | Promise<void>;
  setGizmoMode: (mode: ToolbarGizmoMode) => void;
  requestExitIsolation: () => void | Promise<void>;
  hasUnsavedWork: () => boolean;
};

export function useEditorAppEffects(args: EditorAppEffectsArgs): void {
  const {
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
    deleteCurrentScene,
    openProjectSettings,
    openDeployFrontend,
    openDeployBackend,
    openMultiplayerDebug,
    duplicateSelection,
    deleteSelection,
    exitToTitle,
    loadById,
    loadSceneById,
    setGizmoMode,
    requestExitIsolation,
    hasUnsavedWork,
  } = args;

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
      deleteScene: () => void deleteCurrentScene(),
      openProjectSettings: openProjectSettings,
      openDeployFrontend,
      openDeployBackend,
      openMultiplayerDebug,
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
  deleteCurrentScene,
  openProjectSettings,
  openDeployFrontend,
  openDeployBackend,
  openMultiplayerDebug,
  store,
  duplicateSelection,
  deleteSelection,
  exitToTitle,
]);

// Boot query params + restore last opened scene (or main-game) when starting fresh.
useEffect(() => {
  const bootParams = new URLSearchParams(window.location.search);
  const prefabParam = bootParams.get('prefab');
  const sceneParam = bootParams.get('openScene');
  const tabParam = bootParams.get('tab');
  if (prefabParam) {
    // `?tab=ship` keeps a returning ship prefab in the Ship tab; the Scene tab
    // shows the same viewport, so the only difference is which bar is up.
    void Promise.resolve(loadById(prefabParam)).then(() => {
      setTab(tabParam === 'ship' ? 'ship' : 'scene');
    });
    return;
  }
  if (sceneParam) {
    setTab('scene');
    void loadSceneById(sceneParam);
    return;
  }
  if (tabParam === 'ship') setTab('ship');
  if (tabParam === 'planet') setTab('planet-authoring');
  if (tabParam === 'system') setTab('system-map');
  if (tabParam === 'menu') {
    setTab('menu-manager');
    const menuId = bootParams.get('menu');
    if (menuId) {
      queueMicrotask(() => tabHandlesRef.current.menuManagerEditor?.openMenu(menuId));
    }
    return;
  }
  // Cold start: reopen last scene when the store is still an empty untitled scene.
  const state = store.getState();
  if (
    state.documentType === 'scene'
    && !state.prefabId
    && state.roots.length === 0
    && !takeEditorHmrSnapshot()
  ) {
    void resolveBootSceneId().then((sceneId) => {
      void loadSceneById(sceneId);
    });
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
    const state = store.getState();
    const base = {
      tab: tabRef.current,
      documentType: state.documentType,
      sceneKind: state.sceneKind,
      dirty: store.isDirty(),
      selectedIds: store.getSelectedIds(),
      subSelection: store.getSubSelection(),
    };
    try {
      saveEditorHmrSnapshot({
        ...base,
        prefabDocument: parsePrefabDocument(toPrefabDocument(state)),
      });
    } catch {
      saveEditorHmrSnapshot({ ...base, prefabDocument: null });
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
}
