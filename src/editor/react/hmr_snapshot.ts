import type { PrefabDocument } from '../../world/prefabs/schema';
import type { SceneEditorTab } from './types';

const STORAGE_KEY = 'claudecitizen.editor.hmrSnapshot';

export type EditorHmrSnapshot = {
  tab: SceneEditorTab;
  prefabDocument: PrefabDocument | null;
  dirty: boolean;
  selectedIds: string[];
  subSelection: { entityId: string; nodeUuid: string } | null;
};

export function saveEditorHmrSnapshot(snapshot: EditorHmrSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function takeEditorHmrSnapshot(): EditorHmrSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as EditorHmrSnapshot;
  } catch {
    return null;
  }
}
