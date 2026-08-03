import type { PrefabDocument } from '../../world/prefabs/schema';
import type { SceneKind, SceneRuntime } from '../../world/scenes/schema';
import type { EditorDocumentType } from '../document-types';
import type { SceneEditorTab } from './types';

const STORAGE_KEY = 'claudecitizen.editor.hmrSnapshot';

export type EditorHmrSnapshot = {
  tab: SceneEditorTab;
  prefabDocument: PrefabDocument | null;
  /**
   * The body is always serialized as a prefab document, so scene identity has
   * to ride alongside it. Without these a dev reload silently turns the open
   * scene into a prefab document and Play stops running the scene's flow.
   */
  documentType?: EditorDocumentType;
  sceneKind?: SceneKind;
  sceneRuntime?: SceneRuntime;
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
