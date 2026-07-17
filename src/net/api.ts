import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player_character_appearance';
import type {
  InventoryState as PlayerInventoryState,
  ItemDefinition,
  LoadoutState,
  PlayerItemStack,
} from '../player/inventory/types';

export interface AuthSession {
  user: {
    id: string;
    email: string | null;
    username: string;
    displayName: string;
  };
  player: {
    id: string;
    handle: string;
    displayName: string;
  };
}

export type BuildArea = 'hangar' | 'apartment';

export interface GameBootstrap {
  player: AuthSession['player'] & {
    characterAppearance: PlayerCharacterAppearanceV1 | null;
  };
  economy: {
    arcBalance: number;
  };
  spawn: {
    instanceId: string;
    apartmentInstanceId: string;
    hangarInstanceId: string;
    stationRoomId: string;
  };
  ships: {
    id: string;
    shipDefinitionId: string | null;
    prefabId: string;
    displayName: string;
    hp: number;
    shields: number;
    maxHp: number;
    maxShields: number;
    shieldRegenPerSec: number;
    maxSpeedMps: number;
    throttleAccelMps2: number;
  }[];
  hangar: HangarBuildState;
  apartment: HangarBuildState;
  inventory: InventoryState;
  featureFlags: {
    webTransportPresence: boolean;
    serverAuthoritativePhysics: boolean;
  };
}

export interface PropDefinitionEntry {
  id: string;
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  category: string;
  maxPerHangar: number | null;
  allowRotateY: boolean;
  snapGridM: number | null;
}

export interface PlayerPropInventoryEntry {
  propDefinitionId: string;
  quantity: number;
}

export interface HangarPlacementEntry {
  id: string;
  area: BuildArea;
  propDefinitionId: string;
  prefabId: string;
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

export interface HangarBuildState {
  area: BuildArea;
  assignedHangar: number | null;
  catalog: PropDefinitionEntry[];
  inventory: PlayerPropInventoryEntry[];
  placements: HangarPlacementEntry[];
}

export type ItemDefinitionEntry = ItemDefinition;
export type PlayerItemEntry = PlayerItemStack;
export type InventoryState = PlayerInventoryState;
export type { LoadoutState };

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed) return requestJson<T>(path, init, false);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the status text when the response body is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getSession(): Promise<AuthSession | null> {
  try {
    return await requestJson<AuthSession>('/auth/me', { method: 'GET' }, false);
  } catch {
    return null;
  }
}

export async function refreshSession(): Promise<AuthSession | null> {
  try {
    return await requestJson<AuthSession>('/auth/refresh', { method: 'POST' }, false);
  } catch {
    return null;
  }
}

export function login(identifier: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function register(email: string, username: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });
}

export async function logout(): Promise<void> {
  await requestJson<void>('/auth/logout', { method: 'POST' }, false);
}

export async function requestPasswordReset(email: string): Promise<void> {
  await requestJson<void>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await requestJson<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function discordStartUrl(): string {
  return apiUrl('/auth/discord/start');
}

export function fetchGameBootstrap(): Promise<GameBootstrap> {
  return requestJson<GameBootstrap>('/game/bootstrap', { method: 'GET' });
}

export interface WorldSession {
  url: string;
  ticket: string;
  certificateHashBase64: string | null;
  protocolVersion: number;
  simulationVersion: number;
  expiresInMs: number;
}

export function createWorldSession(): Promise<WorldSession> {
  return requestJson<WorldSession>('/world/session', { method: 'POST' });
}

export interface InventoryPurchaseResponse {
  arcBalance: number;
  inventory: InventoryState;
}

export interface InventoryEquipResponse {
  inventory: InventoryState;
}

/** Buy a weapon into personal inventory (weapon shop terminals). */
export function purchaseInventoryItem(
  itemDefinitionId: string,
): Promise<InventoryPurchaseResponse> {
  return requestJson<InventoryPurchaseResponse>('/game/inventory/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemDefinitionId }),
  });
}

/** Equip or unequip an owned item into a personal loadout slot. */
export function equipInventoryItem(
  slotId: string,
  itemDefinitionId: string | null,
): Promise<InventoryEquipResponse> {
  return requestJson<InventoryEquipResponse>('/game/inventory/equip', {
    method: 'POST',
    body: JSON.stringify({ slotId, itemDefinitionId }),
  });
}

export function savePlayerCharacter(
  appearance: PlayerCharacterAppearanceV1,
): Promise<PlayerCharacterAppearanceV1> {
  return requestJson<PlayerCharacterAppearanceV1>('/game/character', {
    method: 'PUT',
    body: JSON.stringify(appearance),
  });
}

export interface HangarBuildResponse extends HangarBuildState {
  arcBalance: number;
}

function buildAreaPath(area: BuildArea): string {
  return area === 'apartment' ? '/game/apartment' : '/game/hangar';
}

export function fetchBuildState(area: BuildArea): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>(`${buildAreaPath(area)}/build`, { method: 'GET' });
}

export function fetchHangarBuildState(): Promise<HangarBuildResponse> {
  return fetchBuildState('hangar');
}

export function fetchApartmentBuildState(): Promise<HangarBuildResponse> {
  return fetchBuildState('apartment');
}

export function purchaseBuildProp(
  area: BuildArea,
  propDefinitionId: string,
): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>(`${buildAreaPath(area)}/purchase`, {
    method: 'POST',
    body: JSON.stringify({ propDefinitionId }),
  });
}

export function purchaseHangarProp(propDefinitionId: string): Promise<HangarBuildResponse> {
  return purchaseBuildProp('hangar', propDefinitionId);
}

export function purchaseApartmentProp(propDefinitionId: string): Promise<HangarBuildResponse> {
  return purchaseBuildProp('apartment', propDefinitionId);
}

export function createBuildPlacement(
  area: BuildArea,
  propDefinitionId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>(`${buildAreaPath(area)}/placements`, {
    method: 'POST',
    body: JSON.stringify({ propDefinitionId, ...transform }),
  });
}

export function createHangarPlacement(
  propDefinitionId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return createBuildPlacement('hangar', propDefinitionId, transform);
}

export function createApartmentPlacement(
  propDefinitionId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return createBuildPlacement('apartment', propDefinitionId, transform);
}

export function updateBuildPlacement(
  area: BuildArea,
  placementId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>(
    `${buildAreaPath(area)}/placements/${encodeURIComponent(placementId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(transform),
    },
  );
}

export function updateHangarPlacement(
  placementId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return updateBuildPlacement('hangar', placementId, transform);
}

export function updateApartmentPlacement(
  placementId: string,
  transform: Pick<HangarPlacementEntry, 'right' | 'up' | 'forward' | 'rotationY'>,
): Promise<HangarBuildResponse> {
  return updateBuildPlacement('apartment', placementId, transform);
}

export function deleteBuildPlacement(
  area: BuildArea,
  placementId: string,
): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>(
    `${buildAreaPath(area)}/placements/${encodeURIComponent(placementId)}`,
    { method: 'DELETE' },
  );
}

export function deleteHangarPlacement(placementId: string): Promise<HangarBuildResponse> {
  return deleteBuildPlacement('hangar', placementId);
}

export function deleteApartmentPlacement(placementId: string): Promise<HangarBuildResponse> {
  return deleteBuildPlacement('apartment', placementId);
}

export function setAssignedHangarBay(hangarIndex: number): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>('/game/hangar/assigned-bay', {
    method: 'POST',
    body: JSON.stringify({ hangarIndex }),
  });
}

export function resetAssignedHangarBay(): Promise<HangarBuildResponse> {
  return requestJson<HangarBuildResponse>('/game/hangar/assigned-bay', {
    method: 'DELETE',
  });
}
