import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ProjectPanel,
  type ProjectPanelHandle,
  type ProjectPanelOptions,
} from '../react/panels/ProjectPanel';

export type { ProjectPanelHandle, ProjectPanelOptions };

/**
 * Bridge for leftover imperative hosts: mounts the React Project panel into `container`.
 * Prefer importing `ProjectPanel` from `src/editor/react/panels/ProjectPanel` in new
 * React shell code (Rogue layout places bottom-left + asset browser as grid children).
 */
export function createProjectPanel(
  container: HTMLElement,
  options: ProjectPanelOptions,
): ProjectPanelHandle {
  const root = createRoot(container);
  const panelRef = createRef<ProjectPanelHandle>();
  flushSync(() => {
    root.render(createElement(ProjectPanel, { ...options, ref: panelRef }));
  });
  return {
    selectFolder(folderPath: string) {
      panelRef.current?.selectFolder(folderPath);
    },
  };
}
