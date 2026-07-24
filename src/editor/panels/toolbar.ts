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
  type BrowsePanelKind,
} from '../react/panels/Toolbar';

export type {
  ToolbarActions,
  ToolbarGizmoMode,
  ToolbarHandle,
  ToolbarProps,
  ShipPreviewToggles,
  BrowsePanelKind,
};

/**
 * Bridge for leftover imperative hosts: mounts the React Toolbar into `container`.
 * Prefer importing `Toolbar` from `src/editor/react/panels/Toolbar` in new React shell code.
 */
export function createToolbar(
  container: HTMLElement,
  store: EditorStore,
  actions: ToolbarActions,
): ToolbarHandle {
  const root = createRoot(container);
  const panelRef = createRef<ToolbarHandle>();
  flushSync(() => {
    root.render(
      createElement(Toolbar, {
        store,
        actions,
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
    setSceneOptions(entries) {
      panelRef.current?.setSceneOptions(entries);
    },
    setPlanetOptions(entries) {
      panelRef.current?.setPlanetOptions(entries);
    },
    toggleDoorPreview(doorId) {
      panelRef.current?.toggleDoorPreview(doorId);
    },
    openBrowsePanel(panel) {
      panelRef.current?.openBrowsePanel(panel);
    },
  };
}
