import type {
  Dispatch,
  MutableRefObject,
  ReactElement,
  RefObject,
  SetStateAction,
} from 'react';
import { useState } from 'react';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import { addAssetEntity, addPrefabInstanceEntity } from '../session-helpers';
import { getModelThumbnail } from '../../render/editor/thumbnails';
import type { EditorViewport } from '../../render/editor/viewport';
import type { Vec3 } from '../../types';
import type { SceneTemplateId } from '../../world/scenes/templates';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import {
  MaterialManagerPanel,
  type MaterialFocusTarget,
} from './panels/MaterialManagerPanel';
import { MaterialInspectorPanel } from './panels/MaterialInspectorPanel';
import { ProjectPanel, type ProjectPanelHandle } from './panels/ProjectPanel';
import { NewSceneModal } from './panels/NewSceneModal';
import { ProjectSettingsModal } from './panels/ProjectSettingsModal';
import { SceneSettingsModal } from './panels/SceneSettingsModal';
import { ShipPanel, type ShipEditor } from './panels/ShipPanel';
import { Toolbar, type ToolbarHandle } from './panels/Toolbar';
import { TabEditorHosts, type TabEditorHandles } from './TabEditorHosts';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';
import { ViewportHost } from './ViewportHost';
import type { usePrefabIsolation } from './use-prefab-isolation';

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
  createPrefabsInFolder: (entityIds: string[], folder: string) => Promise<string[]>;
  newSceneOpen: boolean;
  setNewSceneOpen: (open: boolean) => void;
  createSceneFromTemplate: (templateId: SceneTemplateId, name: string) => void | Promise<void>;
  sceneSettingsOpen: boolean;
  setSceneSettingsOpen: (open: boolean) => void;
  projectSettingsOpen: boolean;
  setProjectSettingsOpen: (open: boolean) => void;
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
    createPrefabsInFolder,
    newSceneOpen,
    setNewSceneOpen,
    createSceneFromTemplate,
    sceneSettingsOpen,
    setSceneSettingsOpen,
    projectSettingsOpen,
    setProjectSettingsOpen,
  } = props;

  const [materialFocus, setMaterialFocus] = useState<MaterialFocusTarget | null>(
    null,
  );
  const [materialCheckedKeys, setMaterialCheckedKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const selectMaterial = (target: MaterialFocusTarget): void => {
    setMaterialFocus(target);
    store.setSelection(target.entityId);
  };

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