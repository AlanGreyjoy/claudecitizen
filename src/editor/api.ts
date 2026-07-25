import { parsePrefabDocument, type PrefabDocument, type PrefabKind } from '../world/prefabs/schema';
import {
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
} from '../player/equipment/base-character-equipment';
import {
  parseAnimationController,
  type AnimationControllerV1,
} from '../player/animation/schema';
import {
  parseCharacterSettings,
  type CharacterSettingsV1,
} from '../player/character-settings';
import { parsePlanetDocument, type PlanetDocument } from '../world/planets/schema';
import { parseSystemDocument, type SystemDocument } from '../world/systems/schema';
import { parseSceneDocument, type SceneDocument } from '../world/scenes/schema';

export interface PrefabListEntry {
  id: string;
  kind: PrefabKind;
  name: string;
  /** Asset root the prefab file lives under. */
  root?: AssetRoot;
  /** Root-relative file path, forward slashes. */
  path?: string;
}

export interface SceneListEntry {
  id: string;
  name: string;
}

/** Client for the local /__editor API provided by Vite or the Electron shell. */

/** Drag-and-drop MIME type for Project panel asset cards. */
export const ASSET_DND_TYPE = 'application/x-claudecitizen-asset';

/** Drag-and-drop MIME type for Hierarchy panel entity rows. */
export const ENTITY_DND_TYPE = 'application/x-claudecitizen-entity';

/** Drag-and-drop MIME type for prefab cards; payload is the prefab id. */
export const PREFAB_DND_TYPE = 'application/x-claudecitizen-prefab';

/** Drag-and-drop MIME type for moving a Project entry; payload is JSON. */
export const ASSET_MOVE_DND_TYPE = 'application/x-claudecitizen-asset-move';

/** Project-local authoring library (`<project>/assets/…`). */
export const PROJECT_ASSET_ROOT = 'assets' as const;
/** Runtime / source assets under the open project (`<project>/src/assets/…`). */
export const SOURCE_ASSET_ROOT = 'src/assets' as const;
export type AssetRoot = typeof PROJECT_ASSET_ROOT | typeof SOURCE_ASSET_ROOT;

export interface AssetEntry {
  /** Path relative to the root, forward slashes. */
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  /** Filesystem modification time used only for local editor cache invalidation. */
  modifiedAtMs?: number;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || payload === null) {
    throw new Error(payload?.error ?? `${init?.method ?? 'GET'} ${url} failed (${response.status})`);
  }
  return payload;
}

export async function fetchAssetListing(root: AssetRoot): Promise<AssetEntry[]> {
  const payload = await requestJson<{ entries: AssetEntry[] }>(
    `/__editor/assets?root=${encodeURIComponent(root)}`,
  );
  return payload.entries;
}

/** Create a folder under the project asset library (`assets/` by default). */
export async function createAssetFolder(
  parentPath: string,
  name: string,
  root: AssetRoot = PROJECT_ASSET_ROOT,
): Promise<{ path: string }> {
  const payload = await requestJson<{ path: string }>('/__editor/assets/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, parentPath, name }),
  });
  return { path: payload.path };
}

export interface AssetMoveResult {
  root: AssetRoot;
  path: string;
  kind: 'dir' | 'file';
  /** How many authoring documents had asset urls rewritten to follow the move. */
  updatedReferences: number;
}

/**
 * Moves or renames a file or folder inside an asset root, rewriting asset urls
 * in project documents so prefabs keep pointing at the model that moved.
 */
export async function moveAssetEntry(
  root: AssetRoot,
  fromPath: string,
  toPath: string,
): Promise<AssetMoveResult> {
  return requestJson<AssetMoveResult>('/__editor/assets/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, fromPath, toPath }),
  });
}

export async function deleteAssetEntry(
  root: AssetRoot,
  path: string,
): Promise<{ path: string }> {
  const payload = await requestJson<{ path: string }>('/__editor/assets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, path }),
  });
  return { path: payload.path };
}

export async function fetchPrefabList(): Promise<PrefabListEntry[]> {
  const payload = await requestJson<{ prefabs: PrefabListEntry[] }>('/__editor/prefabs');
  return payload.prefabs;
}

export async function fetchPrefab(id: string): Promise<PrefabDocument> {
  const payload = await requestJson<{ document: unknown }>(
    `/__editor/prefab?id=${encodeURIComponent(id)}`,
  );
  return parsePrefabDocument(payload.document);
}

/**
 * Saves a prefab document. An existing prefab is written back over its current
 * file wherever that is; a new one lands in `target` (or the default prefab
 * folder when no target is given).
 */
export async function savePrefab(
  doc: PrefabDocument,
  target?: { root: AssetRoot; folder: string },
): Promise<string> {
  const payload = await requestJson<{ path: string }>('/__editor/prefab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: doc,
      ...(target ? { root: target.root, folder: target.folder } : {}),
    }),
  });
  return payload.path;
}

export interface ProjectSettingsDocument {
  schemaVersion: 1;
  name: string;
  backendUrl: string;
  defaultScene: string;
  build: { outDir: string };
  contentPacks: {
    /** Project-relative folder containing Sidekick manifest.json + parts. Empty = unset. */
    syntySidekick: string;
  };
}

export async function fetchProjectSettings(): Promise<ProjectSettingsDocument> {
  const payload = await requestJson<{ document: ProjectSettingsDocument }>(
    '/__editor/project-settings',
  );
  return payload.document;
}

export async function saveProjectSettings(
  document: ProjectSettingsDocument,
): Promise<ProjectSettingsDocument> {
  const payload = await requestJson<{ document: ProjectSettingsDocument }>(
    '/__editor/project-settings',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    },
  );
  return payload.document;
}

/** Parent-path → ordered child folder names for the Project tree. */
export type FolderOrderMap = Record<string, string[]>;

export interface FolderOrderDocument {
  schemaVersion: 1;
  order: FolderOrderMap;
}

export async function fetchFolderOrder(): Promise<FolderOrderDocument> {
  const payload = await requestJson<{ document: FolderOrderDocument }>(
    '/__editor/folder-order',
  );
  return payload.document;
}

export async function saveFolderOrder(
  document: FolderOrderDocument,
): Promise<FolderOrderDocument> {
  const payload = await requestJson<{ document: FolderOrderDocument }>(
    '/__editor/folder-order',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    },
  );
  return payload.document;
}

export async function fetchSceneList(): Promise<SceneListEntry[]> {
  const payload = await requestJson<{ scenes: SceneListEntry[] }>('/__editor/scenes');
  return payload.scenes;
}

export async function fetchScene(id: string): Promise<SceneDocument> {
  const payload = await requestJson<{ document: unknown }>(
    `/__editor/scene?id=${encodeURIComponent(id)}`,
  );
  const document = parseSceneDocument(payload.document);
  if (!document) throw new Error(`invalid scene document for "${id}"`);
  return document;
}

export async function saveScene(document: SceneDocument): Promise<string> {
  const parsed = parseSceneDocument(document);
  if (!parsed) throw new Error(`invalid scene document for "${document.id}"`);
  const payload = await requestJson<{ path: string }>('/__editor/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: parsed }),
  });
  return payload.path;
}

export async function fetchBaseCharacterEquipment(): Promise<BaseCharacterEquipmentV1> {
  const payload = await requestJson<{ document: unknown }>('/__editor/base-characters');
  return parseBaseCharacterEquipment(payload.document);
}

export async function saveBaseCharacterEquipment(
  document: BaseCharacterEquipmentV1,
): Promise<string> {
  const parsed = parseBaseCharacterEquipment(document);
  const payload = await requestJson<{ path: string }>('/__editor/base-characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: parsed }),
  });
  return payload.path;
}

export async function fetchCharacterSettings(): Promise<CharacterSettingsV1> {
  const payload = await requestJson<{ document: unknown }>('/__editor/character-settings');
  return parseCharacterSettings(payload.document);
}

export async function saveCharacterSettings(
  document: CharacterSettingsV1,
): Promise<string> {
  const parsed = parseCharacterSettings(document);
  const payload = await requestJson<{ path: string }>('/__editor/character-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: parsed }),
  });
  return payload.path;
}

export interface AnimationControllerListEntry {
  id: string;
  label: string;
}

export async function fetchAnimationControllerList(): Promise<AnimationControllerListEntry[]> {
  const payload = await requestJson<{ controllers: AnimationControllerListEntry[] }>(
    '/__editor/animation-controllers',
  );
  return payload.controllers;
}

export async function fetchAnimationController(id: string): Promise<AnimationControllerV1> {
  const payload = await requestJson<{ document: unknown }>(
    `/__editor/animation-controllers?id=${encodeURIComponent(id)}`,
  );
  return parseAnimationController(payload.document);
}

export async function saveAnimationController(document: AnimationControllerV1): Promise<string> {
  const parsed = parseAnimationController(document);
  const payload = await requestJson<{ path: string }>('/__editor/animation-controllers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: parsed }),
  });
  return payload.path;
}

export interface PlanetListEntry {
  id: string;
  name: string;
}

export async function fetchPlanetList(): Promise<PlanetListEntry[]> {
  const payload = await requestJson<{ planets: PlanetListEntry[] }>('/__editor/planets');
  return payload.planets;
}

export async function fetchPlanet(id: string): Promise<PlanetDocument> {
  const payload = await requestJson<{ document: unknown }>(
    `/__editor/planet?id=${encodeURIComponent(id)}`,
  );
  const document = parsePlanetDocument(payload.document);
  if (!document) throw new Error(`invalid planet document for "${id}"`);
  return document;
}

export async function savePlanet(document: PlanetDocument): Promise<string> {
  const payload = await requestJson<{ path: string }>('/__editor/planet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document }),
  });
  return payload.path;
}

export interface SystemListEntry {
  id: string;
  name: string;
}

export async function fetchSystemList(): Promise<SystemListEntry[]> {
  const payload = await requestJson<{ systems: SystemListEntry[] }>('/__editor/systems');
  return payload.systems;
}

export async function fetchSystem(id: string): Promise<SystemDocument> {
  const payload = await requestJson<{ document: unknown }>(
    `/__editor/system?id=${encodeURIComponent(id)}`,
  );
  const document = parseSystemDocument(payload.document);
  if (!document) throw new Error(`invalid system document for "${id}"`);
  return document;
}

export async function saveSystem(document: SystemDocument): Promise<string> {
  const payload = await requestJson<{ path: string }>('/__editor/system', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document }),
  });
  return payload.path;
}

export interface SidekickPackStatus {
  ok: boolean;
  present: boolean;
  configured: boolean;
  path: string;
  relativePath: string;
  errors: string[];
  warnings: string[];
  speciesCount: number;
  partsCount: number;
  partsWithMesh: number;
  missingMeshFiles: number;
  hasManifest: boolean;
  hasBaseModel: boolean;
  hasMaterialConfig: boolean;
  exportReportPresent: boolean;
}

export async function fetchSidekickPackStatus(): Promise<SidekickPackStatus> {
  return requestJson<SidekickPackStatus>('/__editor/sidekick-pack');
}

/** Maps an asset-browser entry to the url the dev server serves it from. */
export function assetUrlFor(root: AssetRoot, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/${root}/${encoded}`;
}
