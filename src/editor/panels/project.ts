import {
  ASSET_DND_TYPE,
  EDITOR_ASSET_ROOT,
  SOURCE_ASSET_ROOT,
  assetUrlFor,
  fetchAssetListing,
  type AssetEntry,
  type AssetRoot,
} from '../api';
import { attachColumnSplitter, PANEL_SIZE_BOUNDS } from '../panel_resize';
import { clearChildren, el, showToast } from '../dom';

const MODEL_EXTENSIONS = ['.glb', '.gltf'];
const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a'];
const DEFAULT_EXPANDED_FOLDERS = ['', 'protected'];
const PROJECT_ROOT_LABEL = 'assets';
const PROJECT_ASSET_ROOTS: readonly AssetRoot[] = [EDITOR_ASSET_ROOT, SOURCE_ASSET_ROOT];

export interface ProjectPanelOptions {
  /** Render a thumbnail data-url for a model asset (provided by render/editor). */
  getModelThumbnail: (url: string) => Promise<string>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onPreviewCharacter: (url: string) => void | Promise<void>;
}

interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: ProjectAssetEntry[];
}

type ProjectAssetEntry = AssetEntry & { root: AssetRoot };

function isModelPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MODEL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isAudioPath(path: string): boolean {
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isDraggableAssetPath(path: string): boolean {
  return isModelPath(path) || isAudioPath(path);
}

function emptyNoteForFolder(folderPath: string): string {
  const fullPath = folderPath ? `${PROJECT_ROOT_LABEL}/${folderPath}` : PROJECT_ROOT_LABEL;
  return `No GLB / GLTF / image / audio files in ${fullPath}.`;
}

async function fetchProjectAssetEntries(): Promise<ProjectAssetEntry[]> {
  const listings = await Promise.all(
    PROJECT_ASSET_ROOTS.map(async (root) => {
      const entries = await fetchAssetListing(root);
      return entries.map((entry): ProjectAssetEntry => ({ ...entry, root }));
    }),
  );
  return listings.flat();
}

function buildFolderTree(entries: ProjectAssetEntry[]): FolderNode {
  const root: FolderNode = { name: '', path: '', children: new Map(), files: [] };
  const ensureDir = (path: string): FolderNode => {
    if (path === '') return root;
    let node = root;
    let current = '';
    for (const segment of path.split('/')) {
      current = current === '' ? segment : `${current}/${segment}`;
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path: current, children: new Map(), files: [] };
        node.children.set(segment, child);
      }
      node = child;
    }
    return node;
  };
  for (const entry of entries) {
    if (entry.kind === 'dir') {
      ensureDir(entry.path);
    } else {
      const slash = entry.path.lastIndexOf('/');
      const dir = ensureDir(slash === -1 ? '' : entry.path.slice(0, slash));
      dir.files.push(entry);
    }
  }
  return root;
}

export function createProjectPanel(container: HTMLElement, options: ProjectPanelOptions): void {
  let tree: FolderNode = { name: '', path: '', children: new Map(), files: [] };
  let selectedFolder = '';
  const expanded = new Set<string>(DEFAULT_EXPANDED_FOLDERS);

  const refreshBtn = el('button', {
    className: 'ed-btn',
    text: '↻',
    title: 'Refresh assets',
    attrs: { 'aria-label': 'Refresh assets' },
    on: { click: () => void load() },
  });
  const folderTree = el('div', { className: 'ed-folder-tree' });
  const grid = el('div', { className: 'ed-asset-grid' });

  const side = el('div', { className: 'ed-project-side' }, [
    el('div', { className: 'ed-panel-title' }, [
      el('span', { text: 'Project' }),
      el('div', { className: 'ed-panel-title-actions' }, [refreshBtn]),
    ]),
    folderTree,
  ]);
  const sideSplitter = el('div', { className: 'ed-splitter ed-splitter-col' });
  container.append(side, sideSplitter, grid);

  attachColumnSplitter(sideSplitter, container, '--ed-project-side-width', {
    ...PANEL_SIZE_BOUNDS.projectSideWidth,
    storageKey: 'projectSideWidth',
  });

  function renderFolderRow(node: FolderNode, depth: number, rows: HTMLElement[]): void {
    const hasChildren = node.children.size > 0;
    const isExpanded = expanded.has(node.path);
    const row = el(
      'div',
      {
        className: `ed-folder-row${node.path === selectedFolder ? ' is-selected' : ''}`,
        attrs: { 'data-folder-path': node.path },
        on: {
          click: () => {
            selectedFolder = node.path;
            if (hasChildren) {
              if (isExpanded) expanded.delete(node.path);
              else expanded.add(node.path);
            }
            renderFolders();
            renderGrid();
          },
        },
      },
      [
        el('span', { text: hasChildren ? (isExpanded ? '▾' : '▸') : '·' }),
        el('span', { text: node.path === '' ? PROJECT_ROOT_LABEL : node.name }),
      ],
    );
    row.style.paddingLeft = `${10 + depth * 12}px`;
    rows.push(row);
    if (isExpanded) {
      for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        renderFolderRow(child, depth + 1, rows);
      }
    }
  }

  function renderFolders(): void {
    clearChildren(folderTree);
    const rows: HTMLElement[] = [];
    renderFolderRow(tree, 0, rows);
    folderTree.append(...rows);
  }

  function findFolder(node: FolderNode, path: string): FolderNode | null {
    if (node.path === path) return node;
    for (const child of node.children.values()) {
      const found = findFolder(child, path);
      if (found) return found;
    }
    return null;
  }

  function fileCard(entry: ProjectAssetEntry): HTMLElement {
    const fileName = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const url = assetUrlFor(entry.root, entry.path);
    const isModel = isModelPath(entry.path);
    const isAudio = isAudioPath(entry.path);
    const isDraggable = isDraggableAssetPath(entry.path);
    const isEmptyFile = entry.size === 0;
    const sourcePath = `${entry.root}/${entry.path}`;

    const thumb = el('div', {
      className: `ed-asset-thumb${isEmptyFile ? ' is-warning' : ''}`,
      text: isEmptyFile ? '!' : isModel ? '◇' : isAudio ? '♪' : '▦',
    });
    if (isModel && !isEmptyFile) {
      void options.getModelThumbnail(url).then((dataUrl) => {
        if (!dataUrl) return;
        clearChildren(thumb);
        thumb.textContent = '';
        thumb.append(el('img', { attrs: { src: dataUrl, alt: fileName } }));
      });
    } else if (!isEmptyFile && !isAudio) {
      clearChildren(thumb);
      thumb.textContent = '';
      thumb.append(el('img', { attrs: { src: url, alt: fileName, loading: 'lazy' } }));
    }

    const cardChildren = [
      thumb,
      el('div', { className: 'ed-asset-name', text: fileName }),
    ];
    if (isModel) {
      const loadCharacterBtn = el('button', {
        className: 'ed-asset-action',
        text: 'Character',
        title: isEmptyFile ? 'File is empty' : 'Load in character preview',
        on: {
          click: (event) => {
            event.stopPropagation();
            if (isEmptyFile) return;
            void Promise.resolve(options.onPreviewCharacter(url)).catch((error) => {
              showToast(`Character preview failed: ${(error as Error).message}`, true);
            });
          },
        },
      });
      const loadAnimationBtn = el('button', {
        className: 'ed-asset-action',
        text: 'Anims',
        title: isEmptyFile ? 'File is empty' : 'Load animation clips in character preview',
        on: {
          click: (event) => {
            event.stopPropagation();
            if (isEmptyFile) return;
            void Promise.resolve(options.onPreviewAnimationSource(url)).catch((error) => {
              showToast(`Animation preview failed: ${(error as Error).message}`, true);
            });
          },
        },
      });
      loadCharacterBtn.disabled = isEmptyFile;
      loadAnimationBtn.disabled = isEmptyFile;
      cardChildren.push(
        el('div', { className: 'ed-asset-actions' }, [loadCharacterBtn, loadAnimationBtn]),
      );
    }

    return el(
      'div',
      {
        className: `ed-asset-card${isEmptyFile ? ' is-unavailable' : ''}`,
        title: isEmptyFile
          ? `${sourcePath}\nFile is empty`
          : isModel
            ? `${sourcePath}\nDrag into the scene`
            : isAudio
              ? `${sourcePath}\nDrag to assign`
              : sourcePath,
        attrs: isDraggable && !isEmptyFile ? { draggable: 'true' } : {},
        on: isDraggable && !isEmptyFile
          ? {
              dragstart: (event) => {
                (event as DragEvent).dataTransfer?.setData(ASSET_DND_TYPE, url);
                (event as DragEvent).dataTransfer?.setData('text/plain', url);
              },
            }
          : {},
      },
      cardChildren,
    );
  }

  function renderGrid(): void {
    clearChildren(grid);
    const folder = findFolder(tree, selectedFolder) ?? tree;
    const files = [...folder.files].sort(
      (a, b) => a.path.localeCompare(b.path) || a.root.localeCompare(b.root),
    );
    if (files.length === 0) {
      grid.append(
        el('div', {
          className: 'ed-empty-note',
          text: emptyNoteForFolder(selectedFolder),
        }),
      );
      return;
    }
    for (const file of files) grid.append(fileCard(file));
  }

  async function load(): Promise<void> {
    try {
      const entries = await fetchProjectAssetEntries();
      tree = buildFolderTree(entries);
    } catch (error) {
      showToast(`Asset listing failed: ${(error as Error).message}`, true);
      tree = { name: '', path: '', children: new Map(), files: [] };
    }
    if (!findFolder(tree, selectedFolder)) selectedFolder = '';
    renderFolders();
    renderGrid();
  }

  void load();
}
