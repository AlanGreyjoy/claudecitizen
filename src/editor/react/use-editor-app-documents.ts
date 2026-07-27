import { useCallback, type MutableRefObject } from 'react';
import {
  deleteScene,
  fetchProjectSettings,
  fetchScene,
  fetchSceneList,
  fetchSceneReferences,
} from '../api';
import { createPrefabFromSelection } from '../create-prefab-from-selection';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { EditorStore } from '../document';
import { showConfirmDialog, showToast } from '../dom';
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
  refreshSceneList: () => Promise<void>;
  saveCurrent: () => Promise<string | null>;
  loadPrefabById: (id: string) => void | Promise<void>;
};

function formatSceneReferenceWarning(references: string[]): string {
  if (references.length === 0) return '';
  const preview = references.slice(0, 5).join('\n');
  const extra =
    references.length > 5 ? `\n…and ${references.length - 5} more.` : '';
  return `\n\nStill referenced by:\n${preview}${extra}`;
}

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
    refreshSceneList,
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
    [store, audioPreview, confirmLeaveDocument, clearIsolation, stopInEditorPlay, setTab],
  );

  const loadFallbackSceneAfterDelete = useCallback(async (deletedId: string) => {
    audioPreview.stop();
    if (playingRef.current) stopInEditorPlay();
    clearIsolation();

    let scenes: Awaited<ReturnType<typeof fetchSceneList>> = [];
    try {
      scenes = await fetchSceneList();
    } catch {
      // Dev API unavailable — fall through to empty template.
    }

    let nextId: string | null = null;
    try {
      const settings = await fetchProjectSettings();
      if (
        settings.defaultScene !== deletedId &&
        scenes.some((entry) => entry.id === settings.defaultScene)
      ) {
        nextId = settings.defaultScene;
      }
    } catch {
      // Ignore — pick first remaining scene instead.
    }
    if (!nextId) {
      nextId = scenes.find((entry) => entry.id !== deletedId)?.id ?? null;
    }

    if (nextId) {
      try {
        const doc = await fetchScene(nextId);
        store.loadDocument(fromSceneDocument(doc));
        setTab('scene');
        return;
      } catch {
        // Fall through to empty template.
      }
    }

    store.loadDocument(createSceneEditorStateFromTemplate('empty', '', 'New Scene'));
    setTab('scene');
  }, [store, audioPreview, clearIsolation, stopInEditorPlay, setTab, playingRef]);

  /**
   * Deletes a scene from disk (or discards an unsaved in-memory scene). When the
   * open document matches, loads the project default / next remaining / empty.
   */
  const deleteSceneById = useCallback(
    async (id: string | null) => {
      const state = store.getState();
      const openId = state.documentType === 'scene' ? state.prefabId || null : null;
      const targetId = id;
      const deletingOpen = targetId !== null && targetId !== '' && openId === targetId;
      const discardingUnsaved = targetId === null || targetId === '';

      if (discardingUnsaved) {
        if (state.documentType !== 'scene') return;
        const confirmed = await showConfirmDialog({
          title: 'Delete Scene',
          message: 'This scene has not been saved to disk. Discard it?',
          confirmLabel: 'Discard',
          destructive: true,
        });
        if (!confirmed) return;
        await loadFallbackSceneAfterDelete('');
        showToast('Discarded unsaved scene');
        return;
      }

      let references: string[] = [];
      try {
        references = await fetchSceneReferences(targetId);
      } catch (error) {
        showToast(`Could not delete scene: ${(error as Error).message}`, true);
        return;
      }

      const confirmed = await showConfirmDialog({
        title: 'Delete Scene',
        message: `Delete scene "${targetId}"? This cannot be undone.${formatSceneReferenceWarning(references)}`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const result = await deleteScene(targetId);
        await refreshSceneList();
        if (deletingOpen || (store.getState().documentType === 'scene' && store.getState().prefabId === targetId)) {
          await loadFallbackSceneAfterDelete(targetId);
        }
        const refNote =
          result.references.length > 0
            ? ` (${result.references.length} document${result.references.length === 1 ? '' : 's'} still reference it)`
            : '';
        showToast(`Deleted scene "${targetId}"${refNote}`);
      } catch (error) {
        showToast(`Could not delete scene: ${(error as Error).message}`, true);
      }
    },
    [store, refreshSceneList, loadFallbackSceneAfterDelete],
  );

  const deleteCurrentScene = useCallback(async () => {
    const state = store.getState();
    if (state.documentType !== 'scene') {
      showToast('Open a scene to delete it.', true);
      return;
    }
    await deleteSceneById(state.prefabId || null);
  }, [store, deleteSceneById]);

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
    deleteSceneById,
    deleteCurrentScene,
    newDocument,
    newSceneDocument,
    newShipDocument,
    openShipById,
    createSceneFromTemplate,
    createItemPrefab,
    saveActive,
  };
}
