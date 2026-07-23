import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { fetchPlanetList, fetchPrefab, fetchPrefabList, savePrefab } from '../api';
import { createEditorAudioPreviewController } from '../audio_preview';
import { createEditorStore, type EditorStore } from '../document';
import { showConfirmDialog, showToast } from '../dom';
import { fromPrefabDocument, toPrefabDocument } from '../serialize';
import {
  addAssetEntity,
  addBox,
  addEmpty,
  isTypingTarget,
  itemNameFromUrl,
} from '../session_helpers';
import { parsePrefabDocument, slugifyPrefabName } from '../../world/prefabs/schema';
import { getModelThumbnail } from '../../render/editor/thumbnails';
import type { EditorViewport } from '../../render/editor/viewport';
import type { Vec3 } from '../../types';
import { saveEditorHmrSnapshot, takeEditorHmrSnapshot } from './hmr_snapshot';
import { useEditorStoreInstance } from './hooks';
import { usePanelSplitters } from './PanelSplitters';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { MaterialManagerPanel } from './panels/MaterialManagerPanel';
import { ProjectPanel, type ProjectPanelHandle } from './panels/ProjectPanel';
import {
  Toolbar,
  type ToolbarGizmoMode,
  type ToolbarHandle,
} from './panels/Toolbar';
import { TabEditorHosts, type TabEditorHandles } from './TabEditorHosts';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';
import { ViewportHost } from './ViewportHost';

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

export function EditorApp(): ReactElement {
  const store = useEditorStoreInstance(() => createEditorStore());
  const audioPreview = useMemo(() => createEditorAudioPreviewController(), []);
  const [tab, setTabState] = useState<SceneEditorTab>(() => {
    const snap = takeEditorHmrSnapshot();
    return restoreSnapshot(store, snap);
  });
  const [viewport, setViewport] = useState<EditorViewport | null>(null);
  const [viewportToolbarHost, setViewportToolbarHost] = useState<HTMLElement | null>(null);
  const [tabHandles, setTabHandles] = useState<TabEditorHandles>({
    baseCharacterEditor: null,
    planetAuthoringEditor: null,
    systemMapEditor: null,
    menuManagerEditor: null,
  });

  const toolbarRef = useRef<ToolbarHandle | null>(null);
  const projectRef = useRef<ProjectPanelHandle | null>(null);
  const allowUnloadRef = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const tabHandlesRef = useRef(tabHandles);
  tabHandlesRef.current = tabHandles;

  const rootRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const projectHostRef = useRef<HTMLDivElement | null>(null);
  const hierarchyPanelRef = useRef<HTMLDivElement | null>(null);
  const inspectorPanelRef = useRef<HTMLDivElement | null>(null);
  const hierarchySplitterRef = useRef<HTMLDivElement | null>(null);
  const inspectorSplitterRef = useRef<HTMLDivElement | null>(null);
  const projectSplitterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rootRef.current = document.getElementById('editor-root');
  }, []);

  usePanelSplitters({
    rootRef,
    mainRef,
    projectRef: projectHostRef,
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
    setTabState(next);
    if (next === 'base-characters') {
      projectRef.current?.selectFolder('protected/animations');
    }
  }, []);

  const onToolbarSlot = useCallback((host: HTMLDivElement | null) => {
    setViewportToolbarHost(host);
  }, []);

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

  const confirmDiscard = useCallback(async (message: string): Promise<boolean> => {
    return showConfirmDialog({
      title: 'Unsaved changes',
      message,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
  }, []);

  // Cached so a fetch that finishes before Toolbar mounts is not dropped.
  // Toolbar only mounts after ViewportHost provides viewportToolbarHost.
  const prefabListCacheRef = useRef<Awaited<ReturnType<typeof fetchPrefabList>> | null>(null);
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
    if (!id) {
      showToast('Give the prefab a name before saving.', true);
      return null;
    }
    if (state.roots.length === 0) {
      showToast('Nothing to save — the scene is empty.', true);
      return null;
    }
    store.setPrefabMeta({ prefabId: id });
    try {
      const doc = parsePrefabDocument(toPrefabDocument(store.getState()));
      const path = await savePrefab(doc);
      store.markSaved();
      showToast(`Saved ${path}`);
      void refreshPrefabList();
      return id;
    } catch (error) {
      showToast(`Save failed: ${(error as Error).message}`, true);
      return null;
    }
  }, [store, refreshPrefabList]);

  const loadById = useCallback(
    async (id: string) => {
      if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes and load?'))) return;
      audioPreview.stop();
      try {
        const doc = await fetchPrefab(id);
        store.loadDocument(fromPrefabDocument(doc));
        showToast(`Loaded "${id}"`);
      } catch (error) {
        showToast(`Load failed: ${(error as Error).message}`, true);
      }
    },
    [store, audioPreview, confirmDiscard],
  );

  const newDocument = useCallback(async () => {
    if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes?'))) return;
    audioPreview.stop();
    store.newDocument();
  }, [store, audioPreview, confirmDiscard]);

  const createItemPrefab = useCallback(
    async (url: string) => {
      if (
        store.isDirty() &&
        !(await confirmDiscard('Discard unsaved changes and create an item prefab?'))
      ) {
        return;
      }
      audioPreview.stop();
      const name = itemNameFromUrl(url);
      store.newDocument();
      store.setPrefabMeta({ kind: 'item', prefabName: name, prefabId: slugifyPrefabName(name) });
      addAssetEntity(store, url, { x: 0, y: 0, z: 0 });
      setTab('scene');
      showToast(`Created item prefab "${name}". Add sockets if this is a backpack, then save.`);
    },
    [store, audioPreview, confirmDiscard, setTab],
  );

  const previewInPlay = useCallback(async () => {
    const kind = store.getState().kind;
    if (kind !== 'station' && kind !== 'ship') {
      showToast('Preview in Play supports station and ship prefabs.', true);
      return;
    }
    const id = await saveCurrent();
    if (!id) return;
    audioPreview.stop();
    const param = kind === 'ship' ? 'shipPrefab' : 'stationPrefab';
    window.location.href = `/?${param}=${encodeURIComponent(id)}`;
  }, [store, saveCurrent, audioPreview]);

  const exitToTitle = useCallback(async () => {
    const handles = tabHandlesRef.current;
    if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes and exit?'))) return;
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
  }, [store, audioPreview, confirmDiscard]);

  const onSave = useCallback(() => {
    const current = tabRef.current;
    const handles = tabHandlesRef.current;
    if (current === 'system-map') void handles.systemMapEditor?.save();
    else if (current === 'planet-authoring') void handles.planetAuthoringEditor?.save();
    else if (current === 'base-characters') void handles.baseCharacterEditor?.save();
    else void saveCurrent();
  }, [saveCurrent]);

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
      onAddBox: () => addBox(store),
      onAddEmpty: () => addEmpty(store),
      onNew: () => void newDocument(),
      onSave,
      onLoad: (id: string) => void loadById(id),
      onLoadPlanet: (id: string) => {
        setTab('planet-authoring');
        void tabHandlesRef.current.planetAuthoringEditor?.loadPlanet(id);
      },
      onOpenMenu: (id: string) => {
        setTab('menu-manager');
        queueMicrotask(() => tabHandlesRef.current.menuManagerEditor?.openMenu(id));
      },
      onDuplicate: duplicateSelection,
      onDelete: deleteSelection,
      onPreview: () => void previewInPlay(),
      onPreviewPlanet: () => void tabHandlesRef.current.planetAuthoringEditor?.previewPlanet(),
      onExit: () => void exitToTitle(),
      onShipPreviewChange: (state: Parameters<EditorViewport['setShipPreview']>[0]) =>
        viewportRef.current?.setShipPreview(state),
      isPlanetAuthoring: () => tabRef.current === 'planet-authoring',
    }),
    [
      store,
      newDocument,
      onSave,
      loadById,
      setTab,
      duplicateSelection,
      deleteSelection,
      previewInPlay,
      exitToTitle,
    ],
  );

  // Prefab/planet lists — fetch early, and re-apply when Toolbar mounts.
  useEffect(() => {
    void refreshPrefabList();
    void refreshPlanetList();
  }, [refreshPrefabList, refreshPlanetList]);

  useEffect(() => {
    if (!viewportToolbarHost) return;
    if (prefabListCacheRef.current) {
      toolbarRef.current?.setPrefabOptions(prefabListCacheRef.current);
    } else {
      void refreshPrefabList();
    }
    if (planetListCacheRef.current) {
      toolbarRef.current?.setPlanetOptions(planetListCacheRef.current);
    } else {
      void refreshPlanetList();
    }
  }, [viewportToolbarHost, refreshPrefabList, refreshPlanetList]);

  // Boot query params
  useEffect(() => {
    const bootParams = new URLSearchParams(window.location.search);
    const prefabParam = bootParams.get('prefab');
    if (prefabParam) void loadById(prefabParam);
    if (bootParams.get('tab') === 'planet') setTab('planet-authoring');
    if (bootParams.get('tab') === 'system') setTab('system-map');
    if (bootParams.get('tab') === 'menu') {
      setTab('menu-manager');
      const menuId = bootParams.get('menu');
      if (menuId) {
        queueMicrotask(() => tabHandlesRef.current.menuManagerEditor?.openMenu(menuId));
      }
    }
  }, [loadById, setTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (viewportRef.current?.isFlying()) return;

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 's') {
          event.preventDefault();
          onSave();
        } else if (key === 'd') {
          event.preventDefault();
          duplicateSelection();
        } else if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
        } else if (key === 'y') {
          event.preventDefault();
          store.redo();
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'w':
          setGizmoMode('translate');
          break;
        case 'e':
          setGizmoMode('rotate');
          break;
        case 'r':
          setGizmoMode('scale');
          break;
        case 'f':
          viewportRef.current?.focusSelection();
          break;
        case 'delete':
        case 'backspace':
          deleteSelection();
          break;
        case 'escape':
          store.clearSelection();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, onSave, duplicateSelection, deleteSelection, setGizmoMode]);

  // beforeunload + HMR snapshot
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const handles = tabHandlesRef.current;
      if (
        allowUnloadRef.current ||
        (!store.isDirty() &&
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
  }, [store]);

  return (
    <>
      <div className="ed-toolbar">
        {viewportToolbarHost ? (
          <Toolbar
            ref={toolbarRef}
            store={store}
            actions={toolbarActions}
            viewportHost={viewportToolbarHost}
          />
        ) : null}
      </div>

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
            />
          </div>
        </div>
        <div
          ref={hierarchySplitterRef}
          className="ed-splitter ed-splitter-col ed-hierarchy-splitter"
        />

        <div ref={centerColumnRef} className="ed-center-column">
          <div className="ed-scene-shell">
            <div className="ed-scene-tabs">
              {SCENE_EDITOR_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`ed-scene-tab${tab === entry.id ? ' is-active' : ''}`}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="ed-scene-body">
              <ViewportHost
                store={store}
                hidden={tab !== 'scene'}
                onReady={setViewport}
                onDropAsset={(url: string, position: Vec3) =>
                  addAssetEntity(store, url, position)
                }
                toolbarSlot={onToolbarSlot}
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
            ref={projectSplitterRef}
            className="ed-splitter ed-splitter-row ed-project-splitter"
          />
          <div ref={projectHostRef} className="ed-project">
            <ProjectPanel
              ref={projectRef}
              audioPreview={audioPreview}
              getModelThumbnail={getModelThumbnail}
              onPreviewAnimationSource={async (url) => {
                setTab('base-characters');
                await tabHandlesRef.current.baseCharacterEditor?.loadAnimationFromAsset(url);
              }}
              onCreateItemPrefab={createItemPrefab}
            />
          </div>
        </div>

        <div
          ref={inspectorSplitterRef}
          className="ed-splitter ed-splitter-col ed-inspector-splitter"
        />
        <div ref={inspectorPanelRef} className="ed-panel ed-inspector-panel">
          <div
            className={`ed-panel-swap${tab === 'base-characters' ? ' is-hidden' : ''}`}
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
      </div>
    </>
  );
}
