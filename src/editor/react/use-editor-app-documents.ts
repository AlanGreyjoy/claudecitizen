import { useCallback, type MutableRefObject } from 'react';
import { fetchScene } from '../api';
import { createPrefabFromSelection } from '../create-prefab-from-selection';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import { showToast } from '../dom';
import {
  createSceneEditorStateFromTemplate,
  fromSceneDocument,
} from '../serialize';
import { addAssetEntity, itemNameFromUrl } from '../session-helpers';
import { slugifyPrefabName } from '../../world/prefabs/schema';
import type { SceneTemplateId } from '../../world/scenes/templates';
import type { TabEditorHandles } from './TabEditorHosts';
import type { SceneEditorTab } from './types';

type ConfirmLeaveDocument = (options?: {
  discardMessage?: string;
  deferBaseDiscard?: boolean;
}) => Promise<boolean>;

export type EditorAppDocumentsArgs = {
  store: EditorStore;
  audioPreview: EditorAudioPreviewController;
  tabRef: MutableRefObject<SceneEditorTab>;
  tabHandlesRef: MutableRefObject<TabEditorHandles>;
  playingRef: MutableRefObject<boolean>;
  stopInEditorPlay: () => void;
  setTab: (next: SceneEditorTab) => void;
  setNewSceneOpen: (open: boolean) => void;
  confirmLeaveDocument: ConfirmLeaveDocument;
  clearIsolation: () => void;
  confirmBaseDiscardIfNeeded: () => Promise<boolean>;
  refreshPrefabList: () => Promise<void>;
  saveCurrent: () => Promise<string | null>;
  loadPrefabById: (id: string) => void | Promise<void>;
};

export function useEditorAppDocuments(args: EditorAppDocumentsArgs) {
  const {
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
    loadPrefabById,
  } = args;

const createPrefabsInFolder = useCallback(
  async (entityIds: string[], folder: string) => {
    const created: string[] = [];
    for (const entityId of entityIds) {
      const id = await createPrefabFromSelection(store, entityId, undefined, folder);
      if (id) created.push(id);
    }
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

/**
 * Opens a ship prefab without bouncing back to the Scene tab — the Ship tab
 * shows the same viewport, so the document swap is all that has to happen.
 */
const openShipById = useCallback(
  async (id: string) => {
    await loadPrefabById(id);
    if (store.getState().kind === 'ship') setTab('ship');
  },
  [loadPrefabById, setTab, store],
);

const newShipDocument = useCallback(async () => {
  if (!(await confirmLeaveDocument({ discardMessage: 'Discard unsaved changes?' }))) {
    return;
  }
  audioPreview.stop();
  if (playingRef.current) stopInEditorPlay();
  clearIsolation();
  store.newDocument();
  // `toPrefabDocument` seeds the ship-frame from the kind, so kind is enough.
  store.setDocumentMeta({ kind: 'ship', prefabName: 'New Ship', prefabId: '' });
  setTab('ship');
  showToast('New ship — add a hull GLB with a ship-controller, then save.');
}, [
  store,
  audioPreview,
  confirmLeaveDocument,
  clearIsolation,
  playingRef,
  stopInEditorPlay,
  setTab,
]);

const saveActive = useCallback(async (): Promise<boolean> => {
  const current = tabRef.current;
  const handles = tabHandlesRef.current;
  if (current === 'server') return true;
  const documentIsActive =
    current === 'scene' || current === 'material-manager' || current === 'ship';
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

  return {
    createPrefabsInFolder,
    loadSceneById,
    newDocument,
    newSceneDocument,
    newShipDocument,
    openShipById,
    createSceneFromTemplate,
    createItemPrefab,
    saveActive,
  };
}
