import { useEffect, type RefObject } from 'react';
import {
  attachColumnSplitter,
  attachRowSplitter,
  PANEL_SIZE_BOUNDS,
  restorePanelSizes,
} from '../panel_resize';

type PanelSplittersProps = {
  rootRef: RefObject<HTMLElement | null>;
  mainRef: RefObject<HTMLElement | null>;
  projectRef: RefObject<HTMLElement | null>;
  hierarchySplitterRef: RefObject<HTMLElement | null>;
  inspectorSplitterRef: RefObject<HTMLElement | null>;
  projectSplitterRef: RefObject<HTMLElement | null>;
};

/** Attach drag splitters once the shell DOM is mounted. */
export function usePanelSplitters({
  rootRef,
  mainRef,
  projectRef,
  hierarchySplitterRef,
  inspectorSplitterRef,
  projectSplitterRef,
}: PanelSplittersProps): void {
  useEffect(() => {
    const root = rootRef.current;
    const main = mainRef.current;
    const project = projectRef.current;
    const hierarchySplitter = hierarchySplitterRef.current;
    const inspectorSplitter = inspectorSplitterRef.current;
    const projectSplitter = projectSplitterRef.current;
    if (
      !root ||
      !main ||
      !project ||
      !hierarchySplitter ||
      !inspectorSplitter ||
      !projectSplitter
    ) {
      return;
    }

    restorePanelSizes(root, main, project);
    attachColumnSplitter(hierarchySplitter, main, '--ed-hierarchy-width', {
      ...PANEL_SIZE_BOUNDS.hierarchyWidth,
      storageKey: 'hierarchyWidth',
    });
    attachColumnSplitter(inspectorSplitter, main, '--ed-inspector-width', {
      ...PANEL_SIZE_BOUNDS.inspectorWidth,
      invert: true,
      storageKey: 'inspectorWidth',
    });
    attachRowSplitter(projectSplitter, root, '--ed-project-height', {
      min: PANEL_SIZE_BOUNDS.projectHeight.min,
      max: PANEL_SIZE_BOUNDS.projectHeight.max,
      storageKey: 'projectHeight',
    });
  }, [
    rootRef,
    mainRef,
    projectRef,
    hierarchySplitterRef,
    inspectorSplitterRef,
    projectSplitterRef,
  ]);
}
