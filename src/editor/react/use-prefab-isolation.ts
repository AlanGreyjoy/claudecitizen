import { useCallback, useRef, useState } from 'react';
import { fetchPrefab } from '../api';
import type { EditorStore } from '../document';
import {
  createPrefabIsolationSession,
  type IsolationBreadcrumb,
} from '../document-session';
import {
  showConfirmDialog,
  showSaveDiscardCancelDialog,
  showToast,
} from '../dom';
import { fromPrefabDocument } from '../serialize';
import type { SceneEditorTab } from './types';

type ConfirmDiscard = (message: string) => Promise<boolean>;

type UsePrefabIsolationArgs = {
  store: EditorStore;
  audioPreview: { stop: () => void };
  saveCurrent: () => Promise<string | null>;
  stopInEditorPlay: () => void;
  playingRef: { current: boolean };
  setTab: (tab: SceneEditorTab) => void;
};

/**
 * Unity-style prefab isolation: open a prefab without destroying the scene.
 */
export function usePrefabIsolation(args: UsePrefabIsolationArgs) {
  const {
    store,
    audioPreview,
    saveCurrent,
    stopInEditorPlay,
    playingRef,
    setTab,
  } = args;

  const isolationRef = useRef(createPrefabIsolationSession());
  const [isolationUi, setIsolationUi] = useState<IsolationBreadcrumb | null>(null);

  const confirmDiscard: ConfirmDiscard = useCallback(async (message) => {
    return showConfirmDialog({
      title: 'Unsaved changes',
      message,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
  }, []);

  const syncIsolationUi = useCallback(() => {
    setIsolationUi(isolationRef.current.getBreadcrumb(store));
  }, [store]);

  const clearIsolation = useCallback(() => {
    isolationRef.current.clear();
    setIsolationUi(null);
  }, []);

  const confirmLeaveDocument = useCallback(
    async (options?: {
      discardMessage?: string;
      deferBaseDiscard?: boolean;
    }): Promise<boolean> => {
      const isolation = isolationRef.current;
      const discardMessage =
        options?.discardMessage ?? 'Discard unsaved changes and load?';
      if (isolation.isActive()) {
        if (store.isDirty()) {
          const choice = await showSaveDiscardCancelDialog({
            title: 'Unsaved prefab',
            message: 'Save the prefab before leaving?',
          });
          if (choice === 'cancel') return false;
          if (choice === 'save' && (await saveCurrent()) === null) return false;
          if (choice === 'discard') store.markSaved();
        }
        if (
          !options?.deferBaseDiscard &&
          isolation.isBaseDirty() &&
          !(await confirmDiscard('Discard unsaved scene changes and continue?'))
        ) {
          return false;
        }
        return true;
      }
      if (store.isDirty() && !(await confirmDiscard(discardMessage))) {
        return false;
      }
      return true;
    },
    [store, confirmDiscard, saveCurrent],
  );

  const requestExitIsolation = useCallback(async () => {
    const isolation = isolationRef.current;
    if (!isolation.isActive()) return;
    if (store.isDirty()) {
      const choice = await showSaveDiscardCancelDialog({
        title: 'Unsaved prefab',
        message: 'Save prefab before returning to the scene?',
      });
      if (choice === 'cancel') return;
      if (choice === 'save' && (await saveCurrent()) === null) return;
    }
    audioPreview.stop();
    if (playingRef.current) stopInEditorPlay();
    isolation.exit(store);
    setIsolationUi(null);
    setTab('scene');
    showToast('Returned to scene');
  }, [store, audioPreview, saveCurrent, stopInEditorPlay, playingRef, setTab]);

  const loadPrefabById = useCallback(
    async (id: string) => {
      const isolation = isolationRef.current;
      // Opening a prefab from a scene suspends the scene — do not discard it.
      if (isolation.isActive()) {
        if (store.isDirty()) {
          const choice = await showSaveDiscardCancelDialog({
            title: 'Unsaved prefab',
            message: 'Save the current prefab before opening another?',
          });
          if (choice === 'cancel') return;
          if (choice === 'save' && (await saveCurrent()) === null) return;
        }
      } else if (
        store.getState().documentType !== 'scene' &&
        store.isDirty() &&
        !(await confirmDiscard('Discard unsaved changes and load?'))
      ) {
        return;
      }
      audioPreview.stop();
      if (playingRef.current) stopInEditorPlay();
      try {
        const doc = await fetchPrefab(id);
        isolation.enter(store, fromPrefabDocument(doc));
        syncIsolationUi();
        setTab('scene');
        showToast(
          isolation.isActive()
            ? `Editing prefab "${id}"`
            : `Loaded prefab "${id}"`,
        );
      } catch (error) {
        showToast(`Load failed: ${(error as Error).message}`, true);
      }
    },
    [
      store,
      audioPreview,
      confirmDiscard,
      saveCurrent,
      stopInEditorPlay,
      playingRef,
      syncIsolationUi,
      setTab,
    ],
  );

  const confirmBaseDiscardIfNeeded = useCallback(async (): Promise<boolean> => {
    const isolation = isolationRef.current;
    if (
      isolation.isActive() &&
      isolation.isBaseDirty() &&
      !(await confirmDiscard('Discard unsaved scene changes and continue?'))
    ) {
      return false;
    }
    return true;
  }, [confirmDiscard]);

  return {
    isolationRef,
    isolationUi,
    confirmDiscard,
    confirmLeaveDocument,
    clearIsolation,
    requestExitIsolation,
    loadPrefabById,
    confirmBaseDiscardIfNeeded,
    hasUnsavedWork: () => isolationRef.current.hasUnsavedWork(store),
  };
}
