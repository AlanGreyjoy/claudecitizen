import type { EditorStore } from '../document';
import { fromPrefabDocument } from '../serialize';
import type { DesktopNativeCommand } from '../../platform/editor-desktop';
import type { takeEditorHmrSnapshot } from './hmr-snapshot';
import type { BrowsePanelKind, ToolbarGizmoMode } from './panels/Toolbar';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';

export function restoreSnapshot(
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

export const GIZMO_SHORTCUTS: Readonly<Partial<Record<string, ToolbarGizmoMode>>> = {
  w: 'translate',
  e: 'rotate',
  r: 'scale',
};

export type NativeCommandHandlers = {
  togglePlay: () => void;
  togglePause: () => void;
  stopPlay: () => void;
  buildWeb: () => void;
  newScene: () => void;
  newPrefab: () => void;
  save: () => void;
  openBrowse: (panel: BrowsePanelKind) => void;
  openSceneSettings: () => void;
  openProjectSettings: () => void;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  exitToTitle: () => void;
  reloadSidekickPack: () => void;
};

export function dispatchNativeCommand(
  command: DesktopNativeCommand,
  handlers: NativeCommandHandlers,
): void {
  const actions: Record<DesktopNativeCommand['type'], () => void> = {
    play: handlers.togglePlay,
    'pause-play': handlers.togglePause,
    'stop-play': handlers.stopPlay,
    'build-web': handlers.buildWeb,
    'new-scene': handlers.newScene,
    'new-prefab': handlers.newPrefab,
    save: handlers.save,
    'open-scene': () => handlers.openBrowse('scene'),
    'open-prefab': () => handlers.openBrowse('prefab'),
    'open-planet': () => handlers.openBrowse('planet'),
    'open-menu': () => handlers.openBrowse('menu'),
    'open-scene-settings': handlers.openSceneSettings,
    'open-project-settings': handlers.openProjectSettings,
    undo: handlers.undo,
    redo: handlers.redo,
    duplicate: handlers.duplicate,
    delete: handlers.deleteSelection,
    'exit-to-title': handlers.exitToTitle,
    'new-project': () => {},
    'sidekick-pack-changed': handlers.reloadSidekickPack,
  };
  actions[command.type]?.();
}
