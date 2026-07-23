import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorStore } from '../document';
import {
  InspectorPanel,
  type InspectorPanelOptions,
} from '../react/panels/InspectorPanel';

export type { InspectorPanelOptions };

/**
 * Bridge for leftover imperative hosts: mounts the React Inspector panel into
 * `container` (expected to have class `ed-inspector-panel`). Prefer importing
 * `InspectorPanel` from `src/editor/react/panels/InspectorPanel` in new React shell code.
 */
export function createInspectorPanel(
  container: HTMLElement,
  store: EditorStore,
  options: InspectorPanelOptions,
): void {
  const root = createRoot(container);
  root.render(createElement(InspectorPanel, { store, ...options }));
}
