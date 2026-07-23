import { parsePrefabDocument, type PrefabDocument, type PrefabKind } from '../world/prefabs/schema';
import {
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
} from '../player/equipment/base_character_equipment';
import {
  parseAnimationController,
  type AnimationControllerV1,
} from '../player/animation/schema';
import {
  parseCharacterSettings,
  type CharacterSettingsV1,
} from '../player/character_settings';
import { parsePlanetDocument, type PlanetDocument } from '../world/planets/schema';
import { parseSystemDocument, type SystemDocument } from '../world/systems/schema';

export interface PrefabListEntry {
  id: string;
  kind: PrefabKind;
  name: string;
}

/** Client for the dev-only /__editor API provided by the Vite plugin. */

/** Drag-and-drop MIME type for Project panel asset cards. */
export const ASSET_DND_TYPE = 'application/x-claudecitizen-asset';

/** Drag-and-drop MIME type for Hierarchy panel entity rows. */
export const ENTITY_DND_TYPE = 'application/x-claudecitizen-entity';

export const EDITOR_ASSET_ROOT = 'editor/assets' as const;
export const SOURCE_ASSET_ROOT = 'src/assets' as const;
export type AssetRoot = typeof EDITOR_ASSET_ROOT | typeof SOURCE_ASSET_ROOT;

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

/** Maps an asset-browser entry to the url the dev server serves it from. */
export function assetUrlFor(root: AssetRoot, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/${root}/${encoded}`;
}
