import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorStore } from '../document';
import {
  HierarchyPanel,
  type HierarchyPanelOptions,
} from '../react/panels/HierarchyPanel';

export type { HierarchyPanelOptions };
export {
  componentBadge,
  collectUsedComponentTypes,
  createMoveToPanel,
  entitySubtreeHasMatch,
  glbSubtreeHasMatch,
  parseDraggedEntityIds,
  parseDraggedGlbNode,
  GLB_NODE_DND_TYPE,
} from './hierarchy_logic';

/**
 * Bridge for leftover imperative hosts: mounts the React Hierarchy panel into
 * `container` (expected to have class `ed-hierarchy`). Prefer importing
 * `HierarchyPanel` from `src/editor/react/panels/HierarchyPanel` in new React shell code.
 */
export function createHierarchyPanel(
  container: HTMLElement,
  store: EditorStore,
  options: HierarchyPanelOptions = {},
): void {
  const root = createRoot(container);
  root.render(createElement(HierarchyPanel, { store, ...options }));
}
