import {
  PROJECT_ASSET_ROOT,
  fetchAssetListing,
  type AssetEntry,
  type FolderOrderMap,
} from '../api';

export type { FolderOrderMap } from '../api';

/** Keep in sync with PREFAB_FILE_SUFFIX in editor-desktop/repository.mjs. */
export const PREFAB_FILE_SUFFIX = '.prefab.json';
export const MODEL_EXTENSIONS = ['.glb', '.gltf'] as const;
export const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a'] as const;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.ktx'] as const;
export const DEFAULT_EXPANDED_FOLDERS = [''] as const;
export const PROJECT_ROOT_LABEL = 'Assets';

export interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: AssetEntry[];
}

export function emptyFolderNode(): FolderNode {
  return { name: '', path: '', children: new Map(), files: [] };
}

export function isModelPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MODEL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isAudioPath(path: string): boolean {
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isPrefabPath(path: string): boolean {
  return path.toLowerCase().endsWith(PREFAB_FILE_SUFFIX);
}

/**
 * Prefab id from a file path. `savePrefab` always names the file after the id,
 * which is what lets a card open the right document without reading it.
 */
export function prefabIdFromPath(path: string): string {
  return fileNameFromPath(path).slice(0, -PREFAB_FILE_SUFFIX.length);
}

export function isDraggableAssetPath(path: string): boolean {
  return isModelPath(path) || isAudioPath(path) || isImagePath(path) || isPrefabPath(path);
}

/** Which card treatment an entry gets in the asset grid. */
export type AssetCardKind = 'empty' | 'model' | 'audio' | 'prefab' | 'other';

export function assetCardKind(entry: AssetEntry): AssetCardKind {
  if (entry.size === 0) return 'empty';
  if (isModelPath(entry.path)) return 'model';
  if (isAudioPath(entry.path)) return 'audio';
  if (isPrefabPath(entry.path)) return 'prefab';
  return 'other';
}

export function assetCardTitle(sourcePath: string, kind: AssetCardKind): string {
  if (kind === 'empty') return `${sourcePath}\nFile is empty`;
  if (kind === 'model') return `${sourcePath}\nDrag into the scene`;
  if (kind === 'audio') return `${sourcePath}\nDrag into the scene or onto an audio field`;
  if (kind === 'prefab') {
    return `${sourcePath}\nDouble-click to open. Drag into the scene to place an instance.`;
  }
  return sourcePath;
}

/** Version key used to invalidate the cached model thumbnail for an entry. */
export function assetVersionOf(entry: AssetEntry): string | undefined {
  return entry.size !== undefined && entry.modifiedAtMs !== undefined
    ? `${entry.size}:${Math.trunc(entry.modifiedAtMs)}`
    : undefined;
}

export function canCreateItemPrefabFromPath(path: string): boolean {
  return isModelPath(path) && /(?:^|\/)protected\/props\/weapons\//i.test(path);
}

export function emptyNoteForFolder(folderPath: string): string {
  const fullPath = folderPath ? `${PROJECT_ROOT_LABEL}/${folderPath}` : PROJECT_ROOT_LABEL;
  return `Nothing in ${fullPath}. Drop assets here, or drag a GameObject from the Hierarchy to save a prefab.`;
}

export async function fetchProjectAssetEntries(): Promise<AssetEntry[]> {
  return fetchAssetListing(PROJECT_ASSET_ROOT);
}

export function buildFolderTree(entries: AssetEntry[]): FolderNode {
  const root = emptyFolderNode();
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

export function findFolder(node: FolderNode, path: string): FolderNode | null {
  if (node.path === path) return node;
  for (const child of node.children.values()) {
    const found = findFolder(child, path);
    if (found) return found;
  }
  return null;
}

export function expandAncestorsInto(expanded: Set<string>, folderPath: string): void {
  expanded.add('');
  const parts = folderPath.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    expanded.add(acc);
  }
}

/**
 * Children of `node`, ordered by `orderMap[node.path]` then alphabetical for
 * any names not listed.
 */
export function sortedFolderChildren(
  node: FolderNode,
  orderMap: FolderOrderMap = {},
): FolderNode[] {
  const children = [...node.children.values()];
  const ordered = orderMap[node.path];
  if (!ordered || ordered.length === 0) {
    return children.sort((a, b) => a.name.localeCompare(b.name));
  }
  const rank = new Map(ordered.map((name, index) => [name, index]));
  return children.sort((a, b) => {
    const aRank = rank.has(a.name) ? rank.get(a.name)! : Number.POSITIVE_INFINITY;
    const bRank = rank.has(b.name) ? rank.get(b.name)! : Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

export function sortedFolderFiles(node: FolderNode): AssetEntry[] {
  return [...node.files].sort((a, b) => a.path.localeCompare(b.path));
}

/** Breadcrumb segments for a selected folder path (`''` = Assets root). */
export function folderBreadcrumbs(
  folderPath: string,
): ReadonlyArray<{ path: string; label: string }> {
  const crumbs: Array<{ path: string; label: string }> = [
    { path: '', label: PROJECT_ROOT_LABEL },
  ];
  const parts = folderPath.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ path: acc, label: part });
  }
  return crumbs;
}

/** Files in `folderPath`, optionally including all nested folders. */
export function collectFolderFiles(
  tree: FolderNode,
  folderPath: string,
  includeSubfolders: boolean,
  orderMap: FolderOrderMap = {},
): AssetEntry[] {
  const folder = findFolder(tree, folderPath) ?? tree;
  if (!includeSubfolders) return sortedFolderFiles(folder);

  const files: AssetEntry[] = [];
  const visit = (node: FolderNode): void => {
    files.push(...node.files);
    for (const child of sortedFolderChildren(node, orderMap)) visit(child);
  };
  visit(folder);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Immediate child folders of `folderPath`, ordered by the persisted sibling
 * order map (then alphabetical). Used by the asset grid so folders appear
 * alongside files like a file explorer.
 */
export function collectImmediateChildFolders(
  tree: FolderNode,
  folderPath: string,
  orderMap: FolderOrderMap = {},
): FolderNode[] {
  const folder = findFolder(tree, folderPath) ?? tree;
  return sortedFolderChildren(folder, orderMap);
}

/** Case-insensitive, whitespace-tolerant asset search terms. */
export function assetSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function filterAssetEntriesByQuery(
  files: readonly AssetEntry[],
  query: string,
): AssetEntry[] {
  const terms = assetSearchTerms(query);
  if (terms.length === 0) return [...files];
  return files.filter((entry) => {
    const haystack = entry.path.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function filterFoldersByQuery(
  folders: readonly FolderNode[],
  query: string,
): FolderNode[] {
  const terms = assetSearchTerms(query);
  if (terms.length === 0) return [...folders];
  return folders.filter((folder) => {
    const haystack = folder.name.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function fileNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function parentFolderOfPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function joinFolderPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** Names accepted by Project panel create/rename operations. */
export function isValidAssetEntryName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0
    && trimmed !== '.'
    && trimmed !== '..'
    && !trimmed.startsWith('.')
    && !/[\\/\0]/.test(trimmed)
  );
}

/** Rewrites a folder path, including descendants, after a folder rename. */
export function remapFolderPath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) return toPath;
  if (path.startsWith(`${fromPath}/`)) return `${toPath}${path.slice(fromPath.length)}`;
  return path;
}

export function removeChildFromOrder(
  order: FolderOrderMap,
  parentPath: string,
  name: string,
): FolderOrderMap {
  const list = order[parentPath];
  if (!list) return order;
  const nextNames = list.filter((entry) => entry !== name);
  const next = { ...order };
  if (nextNames.length === 0) delete next[parentPath];
  else next[parentPath] = nextNames;
  return next;
}

export function insertChildInOrder(
  order: FolderOrderMap,
  parentPath: string,
  name: string,
  index: number,
): FolderOrderMap {
  const existing = (order[parentPath] ?? []).filter((entry) => entry !== name);
  const clamped = Math.max(0, Math.min(index, existing.length));
  const nextNames = [...existing.slice(0, clamped), name, ...existing.slice(clamped)];
  return { ...order, [parentPath]: nextNames };
}

export function setParentOrder(
  order: FolderOrderMap,
  parentPath: string,
  names: string[],
): FolderOrderMap {
  const next = { ...order };
  if (names.length === 0) delete next[parentPath];
  else next[parentPath] = [...names];
  return next;
}

/** Remap order keys when a folder path changes; does not touch parent name lists. */
export function remapOrderKeys(
  order: FolderOrderMap,
  fromPath: string,
  toPath: string,
): FolderOrderMap {
  if (fromPath === toPath) return order;
  const next: FolderOrderMap = {};
  for (const [parent, names] of Object.entries(order)) {
    const newKey = remapFolderPath(parent, fromPath, toPath);
    const prev = next[newKey];
    next[newKey] = prev ? [...prev, ...names.filter((n) => !prev.includes(n))] : [...names];
  }
  return next;
}

/**
 * Update order after a folder moves or renames. Removes the old name from the
 * source parent, remaps descendant keys, then inserts the new name into the
 * destination parent at `insertIndex` (default: end).
 */
export function applyFolderMoveToOrder(
  order: FolderOrderMap,
  fromPath: string,
  toPath: string,
  insertIndex?: number,
): FolderOrderMap {
  if (fromPath === toPath) return order;
  const fromParent = parentFolderOfPath(fromPath);
  const toParent = parentFolderOfPath(toPath);
  const fromName = fileNameFromPath(fromPath);
  const toName = fileNameFromPath(toPath);
  const original = order[fromParent] ?? [];
  const oldIndex = original.indexOf(fromName);

  let next = removeChildFromOrder(order, fromParent, fromName);
  next = remapOrderKeys(next, fromPath, toPath);

  const index =
    insertIndex
    ?? (fromParent === toParent && oldIndex >= 0 ? oldIndex : (next[toParent]?.length ?? 0));
  return insertChildInOrder(next, toParent, toName, index);
}

/**
 * Sibling name list after dropping `draggedName` before/after `targetName`.
 * `currentSiblings` is the visual order including the dragged folder.
 */
export function siblingOrderAfterDrop(
  currentSiblings: readonly string[],
  draggedName: string,
  targetName: string,
  zone: 'before' | 'after',
): string[] {
  const without = currentSiblings.filter((name) => name !== draggedName);
  const targetIdx = without.indexOf(targetName);
  if (targetIdx === -1) return [...without, draggedName];
  const insertAt = zone === 'before' ? targetIdx : targetIdx + 1;
  return [...without.slice(0, insertAt), draggedName, ...without.slice(insertAt)];
}

export type FolderDropZone = 'before' | 'into' | 'after';

export function folderDropZoneFromOffset(
  offsetY: number,
  height: number,
  isRoot: boolean,
): FolderDropZone {
  if (isRoot || height <= 0) return 'into';
  const t = offsetY / height;
  if (t < 1 / 3) return 'before';
  if (t > 2 / 3) return 'after';
  return 'into';
}

/** Payload carried when dragging a Project entry to another folder. */
export interface AssetMoveDragPayload {
  path: string;
  /** Folder drags reorder and reparent; file drags only move. */
  kind: 'dir' | 'file';
}

export function parseAssetMovePayload(data: string): AssetMoveDragPayload | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Partial<AssetMoveDragPayload>;
    if (typeof parsed.path !== 'string' || !parsed.path) return null;
    if (parsed.kind !== 'dir' && parsed.kind !== 'file') return null;
    return { path: parsed.path, kind: parsed.kind };
  } catch {
    return null;
  }
}

/**
 * Whether an entry may be nested into `folder`. Rejects no-op moves and
 * dropping a folder inside itself.
 */
export function canMoveInto(payload: AssetMoveDragPayload, folder: string): boolean {
  if (parentFolderOfPath(payload.path) === folder) return false;
  return folder !== payload.path && !folder.startsWith(`${payload.path}/`);
}

/**
 * Whether a folder may be dropped before/after `targetPath` (reparent to
 * target's parent or reorder among siblings).
 */
export function canDropRelativeTo(payload: AssetMoveDragPayload, targetPath: string): boolean {
  if (!targetPath) return false;
  if (payload.path === targetPath) return false;
  if (targetPath.startsWith(`${payload.path}/`)) return false;
  return true;
}
