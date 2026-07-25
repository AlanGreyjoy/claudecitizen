import {
  EDITOR_ASSET_ROOT,
  SOURCE_ASSET_ROOT,
  fetchAssetListing,
  type AssetEntry,
  type AssetRoot,
} from '../api';

export const MODEL_EXTENSIONS = ['.glb', '.gltf'] as const;
export const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a'] as const;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.ktx'] as const;
export const DEFAULT_EXPANDED_FOLDERS = ['', 'protected'] as const;
export const PROJECT_ROOT_LABEL = 'assets';
export const PROJECT_ASSET_ROOTS: readonly AssetRoot[] = [EDITOR_ASSET_ROOT, SOURCE_ASSET_ROOT];

export type ProjectAssetEntry = AssetEntry & { root: AssetRoot };

export interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: ProjectAssetEntry[];
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

export function isDraggableAssetPath(path: string): boolean {
  return isModelPath(path) || isAudioPath(path) || isImagePath(path);
}

export function canCreateItemPrefabFromPath(path: string): boolean {
  return isModelPath(path) && /(?:^|\/)protected\/props\/weapons\//i.test(path);
}

export function emptyNoteForFolder(folderPath: string): string {
  const fullPath = folderPath ? `${PROJECT_ROOT_LABEL}/${folderPath}` : PROJECT_ROOT_LABEL;
  return `No GLB / GLTF / image / audio files in ${fullPath}.`;
}

export async function fetchProjectAssetEntries(): Promise<ProjectAssetEntry[]> {
  const listings = await Promise.all(
    PROJECT_ASSET_ROOTS.map(async (root) => {
      const entries = await fetchAssetListing(root);
      return entries.map((entry): ProjectAssetEntry => ({ ...entry, root }));
    }),
  );
  return listings.flat();
}

export function buildFolderTree(entries: ProjectAssetEntry[]): FolderNode {
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

export function sortedFolderChildren(node: FolderNode): FolderNode[] {
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function sortedFolderFiles(node: FolderNode): ProjectAssetEntry[] {
  return [...node.files].sort(
    (a, b) => a.path.localeCompare(b.path) || a.root.localeCompare(b.root),
  );
}

export function fileNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
