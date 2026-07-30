import type { EditorStore } from '../document';
import { fromPrefabDocument } from '../serialize';
import type { DesktopNativeCommand } from '../../platform/editor-desktop';
import { isTypingTarget } from '../session-helpers';
import type { takeEditorHmrSnapshot } from './hmr-snapshot';
import type { BrowsePanelKind, ToolbarGizmoMode } from './panels/Toolbar';
import { SCENE_EDITOR_TABS, type SceneEditorTab } from './types';

export function restoreSnapshot(
  store: EditorStore,
  snapshot: ReturnType<typeof takeEditorHmrSnapshot>,
): SceneEditorTab {
  if (!snapshot) return 'scene';
  if (snapshot.prefabDocument) {
    // The snapshot body is always a prefab document; scene identity comes back
    // from the fields beside it, or Play would stage the scene as a prefab.
    const restored = fromPrefabDocument(snapshot.prefabDocument);
    store.loadDocument({
      ...restored,
      documentType: snapshot.documentType ?? restored.documentType,
      sceneKind: snapshot.sceneKind ?? restored.sceneKind,
    });
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
  openDeployFrontend: () => void;
  openDeployBackend: () => void;
  newScene: () => void;
  newPrefab: () => void;
  save: () => void;
  openBrowse: (panel: BrowsePanelKind) => void;
  openSceneSettings: () => void;
  deleteScene: () => void;
  openProjectSettings: () => void;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  exitToTitle: () => void;
  openMultiplayerDebug: () => void;
  openPackages: () => void;
  transcodeTextures: () => void;
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
    'deploy-frontend': handlers.openDeployFrontend,
    'deploy-backend': handlers.openDeployBackend,
    'new-scene': handlers.newScene,
    'new-prefab': handlers.newPrefab,
    save: handlers.save,
    'open-scene': () => handlers.openBrowse('scene'),
    'open-prefab': () => handlers.openBrowse('prefab'),
    'open-planet': () => handlers.openBrowse('planet'),
    'open-menu': () => handlers.openBrowse('menu'),
    'open-scene-settings': handlers.openSceneSettings,
    'delete-scene': handlers.deleteScene,
    'open-project-settings': handlers.openProjectSettings,
    // Electron menu accelerators fire even while an <input> is focused —
    // skip edit commands so Delete/Ctrl+Z don't nuke the scene mid-type.
    undo: () => {
      if (isTypingTarget(document.activeElement)) return;
      handlers.undo();
    },
    redo: () => {
      if (isTypingTarget(document.activeElement)) return;
      handlers.redo();
    },
    duplicate: () => {
      if (isTypingTarget(document.activeElement)) return;
      handlers.duplicate();
    },
    delete: () => {
      if (isTypingTarget(document.activeElement)) return;
      handlers.deleteSelection();
    },
    'exit-to-title': handlers.exitToTitle,
    'open-multiplayer-debug': handlers.openMultiplayerDebug,
    'open-packages': handlers.openPackages,
    'transcode-textures': handlers.transcodeTextures,
    'new-project': () => {},
    'sidekick-pack-changed': handlers.reloadSidekickPack,
  };
  actions[command.type]?.();
}
