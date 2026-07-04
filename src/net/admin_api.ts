import { apiUrl } from './api';

export interface AdminSession {
  email: string;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  player: {
    id: string;
    handle: string;
    displayName: string;
    currentInstanceId: string;
    currentRoomId: string;
    arcBalance: number;
    starterLoadoutGrantedAt: string | null;
    createdAt: string;
    updatedAt: string;
    shipCount: number;
  } | null;
}

export interface AdminUserDetail {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  player: {
    id: string;
    handle: string;
    displayName: string;
    currentInstanceId: string;
    currentRoomId: string;
    arcBalance: number;
    starterLoadoutGrantedAt: string | null;
    createdAt: string;
    updatedAt: string;
    ships: AdminOwnedShip[];
  } | null;
}

export interface AdminOwnedShip {
  id: string;
  shipDefinitionId: string | null;
  prefabId: string;
  displayName: string;
  currentInstanceId: string | null;
  hp: number;
  shields: number;
  maxHp: number;
  maxShields: number;
  createdAt: string;
  updatedAt: string;
  shipDefinition: {
    id: string;
    name: string;
    prefabId: string;
    costArc: number;
  } | null;
}

export interface ShipDefinition {
  id: string;
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  maxSpeedMps: number;
  throttleAccelMps2: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShipDefinitionInput {
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  maxSpeedMps: number;
  throttleAccelMps2: number;
}

export interface GameSettings {
  id: string;
  startingArcBalance: number;
  starterShipDefinitionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export class AdminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

async function requestAdminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) {
    throw new AdminAuthError('Admin session expired or missing.');
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // Keep status text when body is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    return await requestAdminJson<AdminSession>('/admin/session', { method: 'GET' });
  } catch (error) {
    if (error instanceof AdminAuthError) return null;
    throw error;
  }
}

export function adminLogin(email: string, password: string): Promise<AdminSession> {
  return fetch(apiUrl('/admin/session'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async (response) => {
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch {
        // Keep status text when body is not JSON.
      }
      throw new Error(message);
    }
    return (await response.json()) as AdminSession;
  });
}

export async function adminLogout(): Promise<void> {
  await requestAdminJson<void>('/admin/session', { method: 'DELETE' });
}

export function listAdminUsers(): Promise<AdminUserSummary[]> {
  return requestAdminJson<AdminUserSummary[]>('/admin/users', { method: 'GET' });
}

export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return requestAdminJson<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

export function listShipDefinitions(): Promise<ShipDefinition[]> {
  return requestAdminJson<ShipDefinition[]>('/admin/ships', { method: 'GET' });
}

export function createShipDefinition(body: ShipDefinitionInput): Promise<ShipDefinition> {
  return requestAdminJson<ShipDefinition>('/admin/ships', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateShipDefinition(
  id: string,
  body: Partial<ShipDefinitionInput>,
): Promise<ShipDefinition> {
  return requestAdminJson<ShipDefinition>(`/admin/ships/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getGameSettings(): Promise<GameSettings> {
  return requestAdminJson<GameSettings>('/admin/settings', { method: 'GET' });
}

export function updateGameSettings(body: {
  startingArcBalance: number;
  starterShipDefinitionIds: string[];
}): Promise<GameSettings> {
  return requestAdminJson<GameSettings>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
