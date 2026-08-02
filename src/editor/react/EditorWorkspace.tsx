import type {
  Dispatch,
  MutableRefObject,
  ReactElement,
  RefObject,
  SetStateAction,
} from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import type { DraggedGlbNode } from '../panels/hierarchy-logic';
import type { AssetInspectorItem } from '../panels/project-logic';
import { addAssetEntity, addPrefabInstanceEntity } from '../session-helpers';
import { getModelThumbnail } from '../../render/editor/thumbnails';
import type { EditorViewport } from '../../render/editor/viewport';
import type { Vec3 } from '../../types';
import type { SceneTemplateId } from '../../world/scenes/templates';
import type { PrefabKind } from '../../world/prefabs/schema';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import {
  MaterialManagerPanel,
  type MaterialFocusTarget,
} from './panels/MaterialManagerPanel';
import { MaterialInspectorPanel } from './panels/MaterialInspectorPanel';
import { ProjectPanel, type ProjectPanelHandle } from './panels/ProjectPanel';
import { NewSceneModal } from './panels/NewSceneModal';
import { NewPrefabModal } from './panels/NewPrefabModal';
import { ProjectSettingsModal } from './panels/ProjectSettingsModal';
import { SceneSettingsModal } from './panels/SceneSettingsModal';
import { PrefabSettingsModal } from './panels/PrefabSettingsModal';
import { ShipPanel, type ShipEditor } from './panels/ShipPanel';
import { PrefabBar } from './panels/PrefabBar';
import { Toolbar, type ToolbarHandle } from './panels/Toolbar';
import { TabEditorHosts, type TabEditorHandles } from './TabEditorHosts';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';
import { ViewportHost } from './ViewportHost';
import type { usePrefabIsolation } from './use-prefab-isolation';
import type { EditorDocModals } from './use-editor-doc-modals';

export type EditorWorkspaceProps = {
  store: EditorStore;
  audioPreview: EditorAudioPreviewController;
  tab: SceneEditorTab;
  setTab: (next: SceneEditorTab) => void;
  viewport: EditorViewport | null;
  setViewport: Dispatch<SetStateAction<EditorViewport | null>>;
  playing: boolean;
  isolationUi: ReturnType<typeof usePrefabIsolation>['isolationUi'];
  toolbarRef: RefObject<ToolbarHandle | null>;
  shipEditorRef: RefObject<ShipEditor | null>;
  projectRef: RefObject<ProjectPanelHandle | null>;
  mainRef: RefObject<HTMLDivElement | null>;
  hierarchyPanelRef: RefObject<HTMLDivElement | null>;
  inspectorPanelRef: RefObject<HTMLDivElement | null>;
  hierarchySplitterRef: RefObject<HTMLDivElement | null>;
  inspectorSplitterRef: RefObject<HTMLDivElement | null>;
  projectSplitterRef: RefObject<HTMLDivElement | null>;
  viewportRef: MutableRefObject<EditorViewport | null>;
  tabHandlesRef: MutableRefObject<TabEditorHandles>;
  toolbarActions: React.ComponentProps<typeof Toolbar>['actions'];
  onTabHandles: (handles: TabEditorHandles) => void;
  duplicateGlbNode: (entityId: string, nodeUuid: string) => void;
  extractGlbNode: (entityId: string, nodeUuid: string, targetParentId: string | null) => boolean;
  refreshPrefabLibrary: () => void;
  requestExitIsolation: () => void | Promise<void>;
  createItemPrefab: (url: string) => void | Promise<void>;
  loadById: (id: string) => void | Promise<void>;
  openShipById: (id: string) => void | Promise<void>;
  newShipDocument: () => void | Promise<void>;
  togglePlay: () => void;
  startPlanetAuthoringPlay: () => void;
  createPrefabsInFolder: (entityIds: string[], folder: string) => Promise<string[]>;
  docModals: EditorDocModals;
  createSceneFromTemplate: (templateId: SceneTemplateId, name: string) => void | Promise<void>;
  createPrefabDocument: (name: string, kind: PrefabKind) => void | Promise<void>;
  refreshPrefabList: () => void | Promise<void>;
};

export function EditorWorkspace(props: EditorWorkspaceProps): ReactElement {
  const {
    store,
    audioPreview,
    tab,
    setTab,
    viewport,
    setViewport,
    playing,
    isolationUi,
    toolbarRef,
    shipEditorRef,
    projectRef,
    mainRef,
    hierarchyPanelRef,
    inspectorPanelRef,
    hierarchySplitterRef,
    inspectorSplitterRef,
    projectSplitterRef,
    viewportRef,
    tabHandlesRef,
    toolbarActions,
    onTabHandles,
    duplicateGlbNode,
    extractGlbNode,
    refreshPrefabLibrary,
    requestExitIsolation,
    createItemPrefab,
    loadById,
    openShipById,
    newShipDocument,
    togglePlay,
    startPlanetAuthoringPlay,
    createPrefabsInFolder,
    docModals,
    createSceneFromTemplate,
    createPrefabDocument,
    refreshPrefabList,
  } = props;

  const onSocketWeaponPreviewChange = useCallback((enabled: boolean) => {
    viewportRef.current?.setSocketWeaponPreview(enabled);
  }, [viewportRef]);

  const {
    newSceneOpen,
    setNewSceneOpen,
    newPrefabOpen,
    setNewPrefabOpen,
    sceneSettingsOpen,
    setSceneSettingsOpen,
    prefabSettingsOpen,
    setPrefabSettingsOpen,
    projectSettingsOpen,
    setProjectSettingsOpen,
  } = docModals;

  const [materialFocus, setMaterialFocus] = useState<MaterialFocusTarget | null>(
    null,
  );
  const [materialCheckedKeys, setMaterialCheckedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [assetFocus, setAssetFocus] = useState<AssetInspectorItem[]>([]);

  const selectMaterial = (target: MaterialFocusTarget): void => {
    setMaterialFocus(target);
    store.setSelection(target.entityId);
  };

  const onAssetSelectionChange = useCallback(
    (items: AssetInspectorItem[]): void => {
      setAssetFocus(items);
      if (items.length > 0) store.clearSelection();
    },
    [store],
  );

  useEffect(() => {
    return store.subscribe((event) => {
      if (event.type !== 'selection') return;
      if (store.getSelectedIds().length === 0) return;
      setAssetFocus((current) => (current.length === 0 ? current : []));
      projectRef.current?.clearAssetSelection();
    });
  }, [projectRef, store]);

  /**
   * Unity-style: drag a Hierarchy GLB mesh into a Project folder.
   * Extracts under the same host (keeps hierarchy place), writes prefab,
   * swaps that GameObject for a blue prefab-instance.
   */
  const createPrefabsFromGlbNodesInFolder = useCallback(
    async (nodes: DraggedGlbNode[], folder: string) => {
      const created: string[] = [];
      for (const node of nodes) {
        // Parent under the host model so the instance stays where the mesh was,
        // not at the scene root.
        if (!extractGlbNode(node.entityId, node.nodeUuid, node.entityId)) continue;
        const entityId = store.getSelectedIds()[0];
        if (!entityId) continue;
        const ids = await createPrefabsInFolder([entityId], folder);
        created.push(...ids);
      }
      return created;
    },
    [createPrefabsInFolder, extractGlbNode, store],
  );

  return (
    <>
      <Toolbar ref={toolbarRef} store={store} actions={toolbarActions} />

      <div
        ref={mainRef}
        className={`ed-main${tab === 'server' ? ' is-server-tab' : ''}`}
      >
        <div ref={hierarchyPanelRef} className="ed-panel ed-hierarchy-panel">
          <div
            className={`ed-panel-swap${
              tab === 'base-characters' ||
              tab === 'planet-authoring' ||
              tab === 'system-map' ||
              tab === 'menu-manager' ||
              tab === 'server'
                ? ' is-hidden'
                : ''
            }`}
          >
            <HierarchyPanel
              store={store}
              getViewFocusPosition={(parentEntityId) =>
                viewportRef.current?.getViewFocusPosition(parentEntityId) ?? null
              }
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
          <PrefabBar
            store={store}
            hidden={tab !== 'scene'}
            onOpenSettings={toolbarActions.onOpenPrefabSettings}
            onSave={toolbarActions.onSave}
            onOpenShipTab={() => setTab('ship')}
            onRenamed={() => void refreshPrefabList()}
            onSocketWeaponPreviewChange={onSocketWeaponPreviewChange}
          />
          <ShipPanel
            ref={shipEditorRef}
            store={store}
            hidden={tab !== 'ship'}
            playing={playing}
            onOpenShip={openShipById}
            onNewShip={newShipDocument}
            onSave={toolbarActions.onSave}
            onTogglePlay={togglePlay}
          />
          <div className="ed-scene-body">
            <ViewportHost
              store={store}
              hidden={tab !== 'scene' && tab !== 'ship'}
              playing={
                playing
                && (tab === 'scene' || tab === 'material-manager' || tab === 'ship')
              }
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
              <MaterialManagerPanel
                store={store}
                selected={materialFocus}
                checkedKeys={materialCheckedKeys}
                onCheckedKeysChange={setMaterialCheckedKeys}
                onSelectMaterial={selectMaterial}
              />
            </div>
            <TabEditorHosts
              tab={tab}
              playing={playing}
              onHandles={onTabHandles}
              onPlanetTestPlay={startPlanetAuthoringPlay}
            />
          </div>
        </div>

        <div
          ref={inspectorSplitterRef}
          className="ed-splitter ed-splitter-col ed-inspector-splitter"
        />
        <div ref={inspectorPanelRef} className="ed-panel ed-inspector-panel">
          <div
            className={`ed-panel-swap${
              tab === 'base-characters' || tab === 'material-manager'
                ? ' is-hidden'
                : ''
            }`}
          >
            {viewport ? (
              <InspectorPanel
                store={store}
                audioPreview={audioPreview}
                particlePreview={viewport.particlePreview}
                assetFocus={assetFocus}
                onOpenPrefab={(prefabId) => void loadById(prefabId)}
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
                onPlayShipRampPreview={() =>
                  toolbarRef.current?.playRampPreview()
                }
                onPlayShipCanopyPreview={() =>
                  toolbarRef.current?.playCanopyPreview()
                }
                onOpenMaterial={(target) => {
                  selectMaterial({ ...target, nonce: Date.now() });
                  setTab('material-manager');
                }}
              />
            ) : null}
          </div>
          {tab === 'material-manager' ? (
            <div className="ed-panel-swap">
              <MaterialInspectorPanel
                store={store}
                selection={materialFocus}
                checkedKeys={materialCheckedKeys}
                viewport={viewport}
              />
            </div>
          ) : null}
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
          onCreatePrefabsFromGlbNodesInFolder={createPrefabsFromGlbNodesInFolder}
          onAssetSelectionChange={onAssetSelectionChange}
        />
      </div>

      <NewSceneModal
        open={newSceneOpen}
        onCancel={() => setNewSceneOpen(false)}
        onCreate={createSceneFromTemplate}
      />
      <NewPrefabModal
        open={newPrefabOpen}
        onCancel={() => setNewPrefabOpen(false)}
        onCreate={createPrefabDocument}
      />
      <SceneSettingsModal
        open={sceneSettingsOpen}
        store={store}
        onClose={() => setSceneSettingsOpen(false)}
      />
      <PrefabSettingsModal
        open={prefabSettingsOpen}
        store={store}
        onClose={() => setPrefabSettingsOpen(false)}
        onRenamed={() => void refreshPrefabList()}
      />
      <ProjectSettingsModal
        open={projectSettingsOpen}
        onClose={() => setProjectSettingsOpen(false)}
      />
    </>
  );
}