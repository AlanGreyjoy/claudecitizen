import { parsePrefabDocument, type PrefabDocument, type PrefabKind } from '../world/prefabs/schema';
import {
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
} from '../player/equipment/base_character_equipment';

export interface PrefabListEntry {
  id: string;
  kind: PrefabKind;
  name: string;
}

/** Client for the dev-only /__editor API provided by the Vite plugin. */

/** Drag-and-drop MIME type for Project panel asset cards. */
export const ASSET_DND_TYPE = 'application/x-claudecitizen-asset';

export const EDITOR_ASSET_ROOT = 'editor/assets' as const;
export const SOURCE_ASSET_ROOT = 'src/assets' as const;
export type AssetRoot = typeof EDITOR_ASSET_ROOT | typeof SOURCE_ASSET_ROOT;

export interface AssetEntry {
  /** Path relative to the root, forward slashes. */
  path: string;
  kind: 'dir' | 'file';
  size?: number;
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

export async function savePrefab(doc: PrefabDocument): Promise<string> {
  const payload = await requestJson<{ path: string }>('/__editor/prefab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: doc }),
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

/** Maps an asset-browser entry to the url the dev server serves it from. */
export function assetUrlFor(root: AssetRoot, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/${root}/${encoded}`;
}
