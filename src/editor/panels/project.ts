import {
  EDITOR_ASSET_ROOT,
  assetUrlFor,
  fetchAssetListing,
  type AssetEntry,
  type AssetRoot,
} from '../api';
import { attachColumnSplitter, PANEL_SIZE_BOUNDS } from '../panel_resize';
import { clearChildren, el, showToast } from '../dom';

const ASSET_DND_TYPE = 'application/x-claudecitizen-asset';
const MODEL_EXTENSIONS = ['.glb', '.gltf'];

export interface ProjectPanelOptions {
  /** Render a thumbnail data-url for a model asset (provided by render/editor). */
  getModelThumbnail: (url: string) => Promise<string>;
}

interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: AssetEntry[];
}

function isModelPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MODEL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function buildFolderTree(entries: AssetEntry[]): FolderNode {
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
  const activeRoot: AssetRoot = EDITOR_ASSET_ROOT;
  let tree: FolderNode = { name: '', path: '', children: new Map(), files: [] };
  let selectedFolder = '';
  const expanded = new Set<string>(['']);

  const rootTabs = el('div', { className: 'ed-toolbar-group' });
  const refreshBtn = el('button', {
    className: 'ed-btn',
    text: '↻',
    title: 'Refresh listing',
    on: { click: () => void load() },
  });
  const folderTree = el('div', { className: 'ed-folder-tree' });
  const grid = el('div', { className: 'ed-asset-grid' });

  const side = el('div', { className: 'ed-project-side' }, [
    el('div', { className: 'ed-panel-title' }, [
      el('span', { text: 'Project' }),
      el('div', { className: 'ed-panel-title-actions' }, [rootTabs, refreshBtn]),
    ]),
    folderTree,
  ]);
  const sideSplitter = el('div', { className: 'ed-splitter ed-splitter-col' });
  container.append(side, sideSplitter, grid);

  attachColumnSplitter(sideSplitter, container, '--ed-project-side-width', {
    ...PANEL_SIZE_BOUNDS.projectSideWidth,
    storageKey: 'projectSideWidth',
  });

  function renderRootTabs(): void {
    clearChildren(rootTabs);
    ([EDITOR_ASSET_ROOT] as AssetRoot[]).forEach((root) => {
      rootTabs.append(
        el('button', {
          className: `ed-btn${root === activeRoot ? ' is-active' : ''}`,
          text: 'assets',
          title: root,
          on: {
            click: () => {
              selectedFolder = '';
              void load();
            },
          },
        }),
      );
    });
  }

  function renderFolderRow(node: FolderNode, depth: number, rows: HTMLElement[]): void {
    const hasChildren = node.children.size > 0;
    const isExpanded = expanded.has(node.path);
    const row = el(
      'div',
      {
        className: `ed-folder-row${node.path === selectedFolder ? ' is-selected' : ''}`,
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
        el('span', { text: node.path === '' ? activeRoot : node.name }),
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

  function fileCard(entry: AssetEntry): HTMLElement {
    const fileName = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const url = assetUrlFor(activeRoot, entry.path);
    const isModel = isModelPath(entry.path);

    const thumb = el('div', { className: 'ed-asset-thumb', text: isModel ? '◇' : '▦' });
    if (isModel) {
      void options.getModelThumbnail(url).then((dataUrl) => {
        if (!dataUrl) return;
        clearChildren(thumb);
        thumb.textContent = '';
        thumb.append(el('img', { attrs: { src: dataUrl, alt: fileName } }));
      });
    } else {
      clearChildren(thumb);
      thumb.textContent = '';
      thumb.append(el('img', { attrs: { src: url, alt: fileName, loading: 'lazy' } }));
    }

    const card = el(
      'div',
      {
        className: 'ed-asset-card',
        title: isModel ? `${entry.path}\nDrag into the scene` : entry.path,
        attrs: isModel ? { draggable: 'true' } : {},
        on: isModel
          ? {
              dragstart: (event) => {
                (event as DragEvent).dataTransfer?.setData(ASSET_DND_TYPE, url);
                (event as DragEvent).dataTransfer?.setData('text/plain', url);
              },
            }
          : {},
      },
      [thumb, el('div', { className: 'ed-asset-name', text: fileName })],
    );
    return card;
  }

  function renderGrid(): void {
    clearChildren(grid);
    const folder = findFolder(tree, selectedFolder) ?? tree;
    const files = [...folder.files].sort((a, b) => a.path.localeCompare(b.path));
    if (files.length === 0) {
      grid.append(
        el('div', {
          className: 'ed-empty-note',
          text: 'No GLB / GLTF / image files in this folder. Drop assets under editor/assets/free/ or editor/assets/protected/.',
        }),
      );
      return;
    }
    for (const file of files) grid.append(fileCard(file));
  }

  async function load(): Promise<void> {
    renderRootTabs();
    try {
      const entries = await fetchAssetListing(activeRoot);
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
