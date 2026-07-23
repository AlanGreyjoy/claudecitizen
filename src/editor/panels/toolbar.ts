import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { EditorStore } from '../document';
import {
  Toolbar,
  type ToolbarActions,
  type ToolbarGizmoMode,
  type ToolbarHandle,
  type ToolbarProps,
  type ShipPreviewToggles,
} from '../react/panels/Toolbar';

export type {
  ToolbarActions,
  ToolbarGizmoMode,
  ToolbarHandle,
  ToolbarProps,
  ShipPreviewToggles,
};

/**
 * Bridge for leftover imperative hosts: mounts the React Toolbar into `containers.doc`
 * and portals viewport tools into `containers.viewport`. Prefer importing `Toolbar`
 * from `src/editor/react/panels/Toolbar` in new React shell code.
 */
export function createToolbar(
  containers: { doc: HTMLElement; viewport: HTMLElement },
  store: EditorStore,
  actions: ToolbarActions,
): ToolbarHandle {
  const root = createRoot(containers.doc);
  const panelRef = createRef<ToolbarHandle>();
  flushSync(() => {
    root.render(
      createElement(Toolbar, {
        store,
        actions,
        viewportHost: containers.viewport,
        ref: panelRef,
      }),
    );
  });
  return {
    setGizmoMode(mode) {
      panelRef.current?.setGizmoMode(mode);
    },
    setPrefabOptions(entries) {
      panelRef.current?.setPrefabOptions(entries);
    },
    setPlanetOptions(entries) {
      panelRef.current?.setPlanetOptions(entries);
    },
    toggleDoorPreview(doorId) {
      panelRef.current?.toggleDoorPreview(doorId);
    },
  };
}
