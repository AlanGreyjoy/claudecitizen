import type {
  EditorDocumentState,
  EditorStore,
} from './document';

export type SuspendedDocument = {
  state: EditorDocumentState;
  dirty: boolean;
  selection: string | null;
  selectedIds: string[];
};

export type IsolationBreadcrumb = {
  sceneName: string;
  sceneId: string;
  prefabName: string;
  prefabId: string;
};

type Isolation = {
  base: SuspendedDocument;
  editingPrefabId: string;
};

export type PrefabIsolationEnterResult = 'pushed' | 'swapped' | 'replaced';

/**
 * Unity-style prefab isolation: suspend the open scene, edit a prefab on top,
 * then restore the scene on exit. Max depth is one scene + one prefab.
 */
export function createPrefabIsolationSession() {
  let isolation: Isolation | null = null;

  function snapshot(store: EditorStore): SuspendedDocument {
    return {
      state: structuredClone(store.getState()),
      dirty: store.isDirty(),
      selection: store.getSelection(),
      selectedIds: store.getSelectedIds(),
    };
  }

  function restoreSelection(store: EditorStore, suspended: SuspendedDocument): void {
    if (suspended.selectedIds.length > 0) {
      const [first, ...rest] = suspended.selectedIds;
      store.setSelection(first ?? null);
      for (const id of rest) store.setEntitySelection(id, 'toggle');
      return;
    }
    if (suspended.selection) store.setSelection(suspended.selection);
  }

  function restore(store: EditorStore, suspended: SuspendedDocument): void {
    store.loadDocument(suspended.state);
    store.setDirty(suspended.dirty);
    restoreSelection(store, suspended);
  }

  /**
   * Enter prefab edit. When a scene is open, it is snapshotted underneath.
   * When already isolating, swaps the prefab layer (caller must handle dirty).
   * When a bare prefab is open (no isolation), replaces like a normal load.
   */
  function enter(
    store: EditorStore,
    prefabState: EditorDocumentState,
  ): PrefabIsolationEnterResult {
    if (isolation) {
      store.loadDocument(prefabState);
      isolation = {
        base: isolation.base,
        editingPrefabId: prefabState.prefabId,
      };
      return 'swapped';
    }

    if (store.getState().documentType === 'scene') {
      isolation = {
        base: snapshot(store),
        editingPrefabId: prefabState.prefabId,
      };
      store.loadDocument(prefabState);
      return 'pushed';
    }

    store.loadDocument(prefabState);
    return 'replaced';
  }

  /** Restore the suspended scene. Returns false if not isolating. */
  function exit(store: EditorStore): boolean {
    if (!isolation) return false;
    const base = isolation.base;
    isolation = null;
    restore(store, base);
    return true;
  }

  /** Drop isolation without restoring (caller is about to load another document). */
  function clear(): void {
    isolation = null;
  }

  function isActive(): boolean {
    return isolation !== null;
  }

  function getBreadcrumb(store: EditorStore): IsolationBreadcrumb | null {
    if (!isolation) return null;
    const prefab = store.getState();
    return {
      sceneName: isolation.base.state.prefabName || 'Scene',
      sceneId: isolation.base.state.prefabId,
      prefabName: prefab.prefabName || isolation.editingPrefabId,
      prefabId: prefab.prefabId || isolation.editingPrefabId,
    };
  }

  function hasUnsavedWork(store: EditorStore): boolean {
    return store.isDirty() || (isolation?.base.dirty ?? false);
  }

  /** Suspended scene is dirty (even if the active prefab is clean). */
  function isBaseDirty(): boolean {
    return isolation?.base.dirty ?? false;
  }

  return {
    enter,
    exit,
    clear,
    isActive,
    getBreadcrumb,
    hasUnsavedWork,
    isBaseDirty,
  };
}

export type PrefabIsolationSession = ReturnType<typeof createPrefabIsolationSession>;
