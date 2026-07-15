import { fetchPrefab, fetchPrefabList, savePrefab } from './api';
import { createEditorStore, createEmptyEntity } from './document';
import { el, showConfirmDialog, showToast } from './dom';
import { createHierarchyPanel } from './panels/hierarchy';
import { createInspectorPanel } from './panels/inspector';
import { createMaterialManagerPanel } from './panels/material_manager';
import { createProjectPanel } from './panels/project';
import { createToolbar, type ToolbarGizmoMode } from './panels/toolbar';
import { fromPrefabDocument, toPrefabDocument } from './serialize';
import {
  attachColumnSplitter,
  attachRowSplitter,
  PANEL_SIZE_BOUNDS,
  restorePanelSizes,
} from './panel_resize';
import { injectEditorStyles } from './styles';
import { parsePrefabDocument, slugifyPrefabName } from '../world/prefabs/schema';
import { createEditorViewport } from '../render/editor/viewport';
import { createCharacterAnimationPreviewer } from '../render/editor/character_previewer';
import { getModelThumbnail } from '../render/editor/thumbnails';
import type { Vec3 } from '../types';
import { createEditorAudioPreviewController } from './audio_preview';
import { getComponentDef } from '../world/prefabs/component_registry';

const AUDIO_EXTENSIONS = /\.(ogg|mp3|wav|m4a)(?:[?#].*)?$/i;

let started = false;
type SceneEditorTab = 'scene' | 'character-preview' | 'material-manager';

function entityNameFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  return fileName.replace(/\.(glb|gltf|ogg|mp3|wav|m4a)(?:[?#].*)?$/i, '') || 'Asset';
}

export function startEditorSession(): void {
  if (started) return;
  started = true;

  document.getElementById('title-screen')?.classList.add('is-hidden');
  document.getElementById('app')?.classList.add('is-hidden');

  injectEditorStyles();
  const root = document.getElementById('editor-root');
  if (!root) throw new Error('Missing #editor-root');
  root.classList.remove('is-hidden');

  // --- layout ---------------------------------------------------------------
  const toolbarEl = el('div', { className: 'ed-toolbar' });
  const viewportToolbarEl = el('div', { className: 'ed-viewport-toolbar' });
  const hierarchyEl = el('div', { className: 'ed-panel' });
  const sceneTabSceneBtn = el('button', {
    className: 'ed-scene-tab is-active',
    text: 'Scene',
    on: { click: () => setSceneEditorTab('scene') },
  });
  const sceneTabPreviewBtn = el('button', {
    className: 'ed-scene-tab',
    text: 'Character Preview',
    on: { click: () => setSceneEditorTab('character-preview') },
  });
  const sceneTabMaterialBtn = el('button', {
    className: 'ed-scene-tab',
    text: 'Material Manager',
    on: { click: () => setSceneEditorTab('material-manager') },
  });
  const viewportEl = el('div', { className: 'ed-viewport' }, [
    viewportToolbarEl,
    el('div', {
      className: 'ed-viewport-hint',
      text: 'LMB select · Ctrl+click multi · re-click drill · RMB sub-mesh: add empty/component · MMB pan · wheel zoom · hold RMB + WASD fly · W/E/R gizmo · F focus · Ctrl+D duplicate · Del delete',
    }),
  ]);
  const characterPreviewEl = el('div', { className: 'ed-scene-panel ed-character-preview is-hidden' });
  const materialManagerEl = el('div', { className: 'ed-scene-panel ed-material-manager is-hidden' });
  const sceneShellEl = el('div', { className: 'ed-scene-shell' }, [
    el('div', { className: 'ed-scene-tabs' }, [
      sceneTabSceneBtn,
      sceneTabPreviewBtn,
      sceneTabMaterialBtn,
    ]),
    el('div', { className: 'ed-scene-body' }, [
      viewportEl,
      characterPreviewEl,
      materialManagerEl,
    ]),
  ]);
  const inspectorEl = el('div', { className: 'ed-panel' });
  const hierarchySplitter = el('div', { className: 'ed-splitter ed-splitter-col' });
  const inspectorSplitter = el('div', { className: 'ed-splitter ed-splitter-col' });
  const projectSplitter = el('div', { className: 'ed-splitter ed-splitter-row' });
  const mainEl = el('div', { className: 'ed-main' }, [
    hierarchyEl,
    hierarchySplitter,
    sceneShellEl,
    inspectorSplitter,
    inspectorEl,
  ]);
  const projectEl = el('div', { className: 'ed-project' });
  root.append(toolbarEl, mainEl, projectSplitter, projectEl);

  restorePanelSizes(root, mainEl, projectEl);
  attachColumnSplitter(hierarchySplitter, mainEl, '--ed-hierarchy-width', {
    ...PANEL_SIZE_BOUNDS.hierarchyWidth,
    storageKey: 'hierarchyWidth',
  });
  attachColumnSplitter(inspectorSplitter, mainEl, '--ed-inspector-width', {
    ...PANEL_SIZE_BOUNDS.inspectorWidth,
    invert: true,
    storageKey: 'inspectorWidth',
  });
  attachRowSplitter(projectSplitter, root, '--ed-project-height', {
    min: PANEL_SIZE_BOUNDS.projectHeight.min,
    max: PANEL_SIZE_BOUNDS.projectHeight.max,
    storageKey: 'projectHeight',
  });

  // --- store + viewport -------------------------------------------------------
  const store = createEditorStore();
  const audioPreview = createEditorAudioPreviewController();
  const characterPreviewer = createCharacterAnimationPreviewer(characterPreviewEl);
  let sceneEditorTab: SceneEditorTab = 'scene';

  function setSceneEditorTab(tab: SceneEditorTab): void {
    sceneEditorTab = tab;
    sceneTabSceneBtn.classList.toggle('is-active', sceneEditorTab === 'scene');
    sceneTabPreviewBtn.classList.toggle(
      'is-active',
      sceneEditorTab === 'character-preview',
    );
    sceneTabMaterialBtn.classList.toggle(
      'is-active',
      sceneEditorTab === 'material-manager',
    );
    viewportEl.classList.toggle('is-hidden', sceneEditorTab !== 'scene');
    characterPreviewEl.classList.toggle(
      'is-hidden',
      sceneEditorTab !== 'character-preview',
    );
    materialManagerEl.classList.toggle(
      'is-hidden',
      sceneEditorTab !== 'material-manager',
    );
  }

  const viewport = createEditorViewport(viewportEl, store, {
    onDropAsset(url, position) {
      addAssetEntity(url, position);
    },
  });

  function duplicateGlbNode(entityId: string, nodeUuid: string): void {
    const nodeName = store.getGlbNodeName(entityId, nodeUuid);
    const transform = viewport.getGlbNodePrefabTransform(entityId, nodeUuid);
    if (!nodeName || !transform) {
      showToast('Could not duplicate the model node — its transform is unavailable.', true);
      return;
    }
    if (!store.duplicateGlbNode(entityId, nodeName, transform)) {
      showToast('Could not duplicate the model node.', true);
    }
  }

  function duplicateSelection(): void {
    const sub = store.getSubSelection();
    if (sub) {
      duplicateGlbNode(sub.entityId, sub.nodeUuid);
      return;
    }
    const selectedIds = store.getSelectedIds();
    if (selectedIds.length > 0) store.duplicateEntities(selectedIds);
  }

  function extractGlbNode(
    entityId: string,
    nodeUuid: string,
    targetParentId: string | null,
  ): boolean {
    const transform = viewport.getGlbNodePrefabTransform(
      entityId,
      nodeUuid,
      targetParentId,
    );
    if (!transform) {
      showToast('Could not move the model node — its target transform is unavailable.', true);
      return false;
    }
    if (!store.extractGlbNode(entityId, nodeUuid, targetParentId, transform)) {
      showToast('Could not move the model node out of its prefab.', true);
      return false;
    }
    return true;
  }

  function deleteSelection(): void {
    const sub = store.getSubSelection();
    if (sub) {
      store.hideGlbNode(sub.entityId, sub.nodeUuid);
      return;
    }
    const selectedIds = store.getSelectedIds();
    if (selectedIds.length > 0) store.deleteEntities(selectedIds);
  }

  function addAssetEntity(url: string, position: Vec3): void {
    const entity = createEmptyEntity(entityNameFromUrl(url));
    if (AUDIO_EXTENSIONS.test(url)) {
      const kind = store.getState().kind;
      if (kind !== 'station' && kind !== 'ship') {
        showToast('Sound objects are available in station and ship prefabs.', true);
        return;
      }
      const component = getComponentDef('sound')?.createDefault();
      if (!component || component.type !== 'sound') return;
      entity.components = [{ ...component, soundUrl: url }];
      entity.position = position;
      store.addEntity(entity);
      return;
    }
    entity.asset = { url };
    entity.position = position;
    store.addEntity(entity);
    void maybeOfferShipPrefab(entity.id, url);
  }

  /** Dropping a GLB from a ships folder offers to switch into Ship Editor mode. */
  async function maybeOfferShipPrefab(entityId: string, url: string): Promise<void> {
    if (!/\/ships\//i.test(url)) return;
    const state = store.getState();
    if (state.kind === 'ship') {
      markAsHullIfFirst(entityId);
      return;
    }
    const modelName = entityNameFromUrl(url);
    const create = await showConfirmDialog({
      title: 'Ship model detected',
      message: `Create "${modelName}" as a ship prefab? This switches the prefab kind to ship and marks this model as the hull.`,
      confirmLabel: 'Create ship prefab',
      cancelLabel: 'Keep as scenery',
    });
    if (!create) return;
    const meta: Parameters<typeof store.setPrefabMeta>[0] = { kind: 'ship' };
    if (!state.prefabId && state.prefabName === 'Untitled Prefab') {
      meta.prefabName = modelName;
      meta.prefabId = slugifyPrefabName(modelName);
    }
    store.setPrefabMeta(meta);
    markAsHullIfFirst(entityId);
    showToast('Ship Editor mode — add a ship-controller on the hull, deck colliders, then Preview Ship.');
  }

  /** Tags the hull entity with ship-controller when no other hull claims it yet. */
  function markAsHullIfFirst(entityId: string): void {
    let hullExists = false;
    const visit = (list: ReturnType<typeof store.getState>['roots']): void => {
      for (const entity of list) {
        if (
          entity.components.some(
            (component) =>
              component.type === 'ship-controller' || component.type === 'ship-hull',
          )
        ) {
          hullExists = true;
          return;
        }
        visit(entity.children);
      }
    };
    visit(store.getState().roots);
    if (hullExists) return;
    const entity = store.locate(entityId)?.entity;
    if (!entity) return;
    // The game recenters the hull model on the ship origin, so the hull
    // entity must sit at 0,0,0 for the editor to match the game.
    store.setTransform(entityId, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { ...entity.rotation },
      scale: { ...entity.scale },
    });
    store.setComponents(entityId, [
      ...entity.components.filter(
        (component) => component.type !== 'ship-hull',
      ),
      {
        type: 'ship-controller',
        restHeight: 3.16,
        stats: {
          maxSpeedMps: 100,
          maxHp: 1000,
          maxShields: 500,
          shieldRegenPerSec: 25,
        },
        gear: {
          nodes: [
            { name: 'LandingGear_BackLeft', deployRadians: -0.55 },
            { name: 'LandingGear_BackRight', deployRadians: -0.55 },
            { name: 'LandingLeg_Front', deployRadians: 1.4 },
          ],
        },
        ramp: {
          hinge: { node: 'RampParent', lowerRadians: -0.85 },
        },
        doors: [],
        seats: [],
        cameraBounds: [],
      },
    ]);
  }

  function addBox(): void {
    const entity = createEmptyEntity('Box');
    entity.primitive = { shape: 'box', size: { x: 2, y: 2, z: 2 }, color: '#4c5663' };
    entity.position = { x: 0, y: 1, z: 0 };
    store.addEntity(entity);
  }

  function addEmpty(): void {
    const entity = createEmptyEntity('Empty');
    store.addEntity(entity);
  }

  // --- save / load -------------------------------------------------------------
  async function refreshPrefabList(): Promise<void> {
    try {
      toolbar.setPrefabOptions(await fetchPrefabList());
    } catch {
      // Dev API unavailable (should not happen under `npm run dev`).
    }
  }

  async function saveCurrent(): Promise<string | null> {
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
  }

  async function confirmDiscard(message: string): Promise<boolean> {
    return showConfirmDialog({
      title: 'Unsaved changes',
      message,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
  }

  async function loadById(id: string): Promise<void> {
    if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes and load?'))) return;
    audioPreview.stop();
    try {
      const doc = await fetchPrefab(id);
      store.loadDocument(fromPrefabDocument(doc));
      showToast(`Loaded "${id}"`);
    } catch (error) {
      showToast(`Load failed: ${(error as Error).message}`, true);
    }
  }

  async function newDocument(): Promise<void> {
    if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes?'))) return;
    audioPreview.stop();
    store.newDocument();
  }

  async function previewInPlay(): Promise<void> {
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
  }

  let allowUnload = false;

  async function exitToTitle(): Promise<void> {
    if (store.isDirty() && !(await confirmDiscard('Discard unsaved changes and exit?'))) return;
    audioPreview.stop();
    allowUnload = true;
    window.location.href = '/';
  }

  // --- panels -------------------------------------------------------------------
  const toolbar = createToolbar({ doc: toolbarEl, viewport: viewportToolbarEl }, store, {
    onGizmoMode: (mode) => viewport.setGizmoMode(mode),
    onGizmoSpace: (space) => viewport.setGizmoSpace(space),
    onSnapChange: (enabled, translate, rotate) => viewport.setSnap(enabled, translate, rotate),
    onAddBox: addBox,
    onAddEmpty: addEmpty,
    onNew: () => void newDocument(),
    onSave: () => void saveCurrent(),
    onLoad: (id) => void loadById(id),
    onDuplicate: duplicateSelection,
    onDelete: deleteSelection,
    onPreview: () => void previewInPlay(),
    onExit: () => void exitToTitle(),
    onShipPreviewChange: (state) => viewport.setShipPreview(state),
  });

  createHierarchyPanel(hierarchyEl, store, {
    getGlbNodePrefabPosition: (entityId, nodeUuid) =>
      viewport.getGlbNodePrefabPosition(entityId, nodeUuid),
    getGlbNodeBounds: (entityId, nodeUuid) =>
      viewport.getGlbNodeBounds(entityId, nodeUuid),
    onDuplicateGlbNode: duplicateGlbNode,
    onExtractGlbNode: extractGlbNode,
  });
  createInspectorPanel(inspectorEl, store, {
    audioPreview,
    getGlbNodeLocalTransform: (entityId, nodeUuid) =>
      viewport.getGlbNodeLocalTransform(entityId, nodeUuid),
    setGlbNodeLocalTransform: (entityId, nodeUuid, transform) =>
      viewport.setGlbNodeLocalTransform(entityId, nodeUuid, transform),
    getGlbNodeBounds: (entityId, nodeUuid) =>
      viewport.getGlbNodeBounds(entityId, nodeUuid),
  });
  createMaterialManagerPanel(materialManagerEl, store);
  createProjectPanel(projectEl, {
    audioPreview,
    getModelThumbnail,
    onPreviewAnimationSource: async (url) => {
      setSceneEditorTab('character-preview');
      await characterPreviewer.loadAnimationSource(url);
    },
    onPreviewCharacter: async (url) => {
      setSceneEditorTab('character-preview');
      await characterPreviewer.loadCharacter(url);
    },
  });
  void refreshPrefabList();

  // Round trip from Play preview: /?boot=editor&prefab=<id> reopens the prefab.
  const prefabParam = new URLSearchParams(window.location.search).get('prefab');
  if (prefabParam) void loadById(prefabParam);

  // --- keyboard -------------------------------------------------------------------
  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );
  }

  function setGizmoMode(mode: ToolbarGizmoMode): void {
    viewport.setGizmoMode(mode);
    toolbar.setGizmoMode(mode);
  }

  window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (viewport.isFlying()) return; // WASD belongs to the flythrough camera

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void saveCurrent();
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
        viewport.focusSelection();
        break;
      case 'delete':
      case 'backspace': {
        deleteSelection();
        break;
      }
      case 'escape':
        store.clearSelection();
        break;
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (allowUnload || !store.isDirty()) return;
    event.preventDefault();
  });
}
