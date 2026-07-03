/** Drag splitters for resizable editor panels. */

type SplitterBounds = {
  min: number;
  max: number;
};

type ColumnSplitterOptions = SplitterBounds & {
  invert?: boolean;
  storageKey?: string;
};

type RowSplitterOptions = {
  min: number;
  max: number | (() => number);
  storageKey?: string;
};

const STORAGE_PREFIX = 'editor.panel.';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readCssVarPx(host: HTMLElement, cssVar: string, fallback: number): number {
  const raw = getComputedStyle(host).getPropertyValue(cssVar).trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setCssVarPx(host: HTMLElement, cssVar: string, value: number): void {
  host.style.setProperty(cssVar, `${Math.round(value)}px`);
}

function readStoredPx(key: string): number | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredPx(key: string, value: number): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(Math.round(value)));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export const PANEL_SIZE_DEFAULTS = {
  hierarchyWidth: 264,
  inspectorWidth: 320,
  projectHeight: 240,
  projectSideWidth: 280,
} as const;

export const PANEL_SIZE_BOUNDS = {
  hierarchyWidth: { min: 160, max: 480 },
  inspectorWidth: { min: 200, max: 560 },
  projectHeight: { min: 120, max: () => window.innerHeight * 0.5 },
  projectSideWidth: { min: 160, max: 480 },
} as const;

export function restorePanelSizes(
  root: HTMLElement,
  mainEl: HTMLElement,
  projectEl?: HTMLElement,
): void {
  const hierarchy = readStoredPx('hierarchyWidth');
  if (hierarchy !== null) {
    setCssVarPx(
      mainEl,
      '--ed-hierarchy-width',
      clamp(hierarchy, PANEL_SIZE_BOUNDS.hierarchyWidth.min, PANEL_SIZE_BOUNDS.hierarchyWidth.max),
    );
  }

  const inspector = readStoredPx('inspectorWidth');
  if (inspector !== null) {
    setCssVarPx(
      mainEl,
      '--ed-inspector-width',
      clamp(inspector, PANEL_SIZE_BOUNDS.inspectorWidth.min, PANEL_SIZE_BOUNDS.inspectorWidth.max),
    );
  }

  const project = readStoredPx('projectHeight');
  if (project !== null) {
    const maxHeight = PANEL_SIZE_BOUNDS.projectHeight.max();
    setCssVarPx(
      root,
      '--ed-project-height',
      clamp(project, PANEL_SIZE_BOUNDS.projectHeight.min, maxHeight),
    );
  }

  if (projectEl) {
    const projectSide = readStoredPx('projectSideWidth');
    if (projectSide !== null) {
      setCssVarPx(
        projectEl,
        '--ed-project-side-width',
        clamp(
          projectSide,
          PANEL_SIZE_BOUNDS.projectSideWidth.min,
          PANEL_SIZE_BOUNDS.projectSideWidth.max,
        ),
      );
    }
  }
}

export function attachColumnSplitter(
  splitter: HTMLElement,
  host: HTMLElement,
  cssVar: string,
  options: ColumnSplitterOptions,
): void {
  const { min, max, invert = false, storageKey } = options;
  let startX = 0;
  let startSize = 0;

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    startX = event.clientX;
    startSize = readCssVarPx(host, cssVar, min);
    splitter.classList.add('is-dragging');
    document.body.classList.add('ed-resize-active', 'ed-resize-col');
  });

  splitter.addEventListener('pointermove', (event) => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - startX;
    const next = clamp(startSize + (invert ? -delta : delta), min, max);
    setCssVarPx(host, cssVar, next);
  });

  const finish = (event: PointerEvent): void => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    splitter.releasePointerCapture(event.pointerId);
    splitter.classList.remove('is-dragging');
    document.body.classList.remove('ed-resize-active', 'ed-resize-col');
    if (storageKey) {
      writeStoredPx(storageKey, readCssVarPx(host, cssVar, min));
    }
  };

  splitter.addEventListener('pointerup', finish);
  splitter.addEventListener('pointercancel', finish);
}

export function attachRowSplitter(
  splitter: HTMLElement,
  host: HTMLElement,
  cssVar: string,
  options: RowSplitterOptions,
): void {
  const { min, max: maxOption, storageKey } = options;
  let startY = 0;
  let startSize = 0;

  const resolveMax = (): number =>
    typeof maxOption === 'function' ? maxOption() : maxOption;

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    startY = event.clientY;
    startSize = readCssVarPx(host, cssVar, min);
    splitter.classList.add('is-dragging');
    document.body.classList.add('ed-resize-active', 'ed-resize-row');
  });

  splitter.addEventListener('pointermove', (event) => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    const max = resolveMax();
    const delta = event.clientY - startY;
    const next = clamp(startSize - delta, min, max);
    setCssVarPx(host, cssVar, next);
  });

  const finish = (event: PointerEvent): void => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    splitter.releasePointerCapture(event.pointerId);
    splitter.classList.remove('is-dragging');
    document.body.classList.remove('ed-resize-active', 'ed-resize-row');
    if (storageKey) {
      writeStoredPx(storageKey, readCssVarPx(host, cssVar, min));
    }
  };

  splitter.addEventListener('pointerup', finish);
  splitter.addEventListener('pointercancel', finish);
}
