import { backendRequestUrl, runtimeConfig } from './runtime-config';
import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player-character-appearance';
import type { PlayerSurvivalVitals } from '../player/vitals';
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
    vitals: PlayerSurvivalVitals;
  };
  economy: {
    arcBalance: number;
    /** AsteronCredits — the hard currency the Item Mall spends. */
    creditBalance: number;
  };
  /** Item Mall storefront, so the HUD can render without a second round trip. */
  mall: { listings: unknown[] };
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

export function apiBaseUrl(): string {
  return runtimeConfig().backendUrl;
}

/**
 * Resolves a backend path for fetch. Inside the editor this is the main-process
 * proxy route; in the shipped web build it is the configured backend directly.
 */
export function apiUrl(path: string): string {
  return backendRequestUrl(path);
}

/**
 * Auth endpoints where 401 / unreachable is expected UX (bad password, probe,
 * logout) and must not kick the player. `/auth/me` is included because callers
 * already treat null as signed-out (title login / play gate).
 */
const NO_SESSION_LOST_KICK = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/me',
]);

/** Backend unreachable (bad gateway / overloaded) — treat like a dead session. */
const UNAVAILABLE_STATUS = new Set([502, 503, 504]);

export type SessionLostReason = 'unauthorized' | 'unavailable';

type SessionLostHandler = (reason: SessionLostReason) => void;

let sessionLostHandler: SessionLostHandler | null = null;
/** Coalesce bursts into one kick; cleared on any successful API call. */
let sessionLostNotified = false;

/**
 * Scene host registers this so unrecovered player-API auth/network failures
 * return to the boot (title) scene. `net/` must not import `app/`.
 */
export function setUnauthorizedHandler(handler: SessionLostHandler | null): void {
  sessionLostHandler = handler;
  sessionLostNotified = false;
}

function notifySessionLost(reason: SessionLostReason): void {
  if (sessionLostNotified) return;
  sessionLostNotified = true;
  sessionLostHandler?.(reason);
}

/** World transport / other net layers call this when the backend is gone. */
export function reportBackendUnavailable(): void {
  notifySessionLost('unavailable');
}

function shouldKickOnFailure(path: string): boolean {
  return !NO_SESSION_LOST_KICK.has(path);
}

async function requestJson<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (shouldKickOnFailure(path)) notifySessionLost('unavailable');
    throw error;
  }

  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed) return requestJson<T>(path, init, false);
  }

  if (response.status === 401 && shouldKickOnFailure(path)) {
    notifySessionLost('unauthorized');
  } else if (UNAVAILABLE_STATUS.has(response.status) && shouldKickOnFailure(path)) {
    notifySessionLost('unavailable');
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

  sessionLostNotified = false;
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

/**
 * Real browser navigation, not a fetch, so this always points at the backend
 * directly — the main-process proxy cannot carry an OAuth redirect.
 */
export function discordStartUrl(): string {
  return `${apiBaseUrl()}/auth/discord/start`;
}

export function fetchGameBootstrap(): Promise<GameBootstrap> {
  return requestJson<GameBootstrap>('/game/bootstrap', { method: 'GET' });
}

export interface PlayerVitalsSessionResponse {
  sessionId: string;
  acceptedSequence: number;
  vitals: PlayerSurvivalVitals;
}

export function startPlayerVitalsSession(): Promise<PlayerVitalsSessionResponse> {
  return requestJson<PlayerVitalsSessionResponse>('/game/vitals/session', {
    method: 'POST',
  });
}

export function pulsePlayerVitalsSession(
  sessionId: string,
  sequence: number,
  sprintingSeconds: number,
): Promise<PlayerVitalsSessionResponse> {
  return requestJson<PlayerVitalsSessionResponse>(
    `/game/vitals/session/${encodeURIComponent(sessionId)}/pulse`,
    {
      method: 'POST',
      body: JSON.stringify({ sequence, sprintingSeconds }),
    },
  );
}

export function resumePlayerVitalsSession(
  sessionId: string,
): Promise<PlayerVitalsSessionResponse> {
  return requestJson<PlayerVitalsSessionResponse>(
    `/game/vitals/session/${encodeURIComponent(sessionId)}/resume`,
    { method: 'POST' },
  );
}

export function stopPlayerVitalsSession(
  sessionId: string,
  sequence: number,
  sprintingSeconds: number,
): Promise<PlayerVitalsSessionResponse> {
  return requestJson<PlayerVitalsSessionResponse>(
    `/game/vitals/session/${encodeURIComponent(sessionId)}/stop`,
    {
      method: 'POST',
      body: JSON.stringify({ sequence, sprintingSeconds }),
      keepalive: true,
    },
    false,
  );
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

/** Buy a shop item into personal inventory (weapons, gear, consumables). */
export function purchaseInventoryItem(
  itemDefinitionId: string,
): Promise<InventoryPurchaseResponse> {
  return requestJson<InventoryPurchaseResponse>('/game/inventory/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemDefinitionId }),
  });
}

export interface InventoryConsumeResponse {
  inventory: InventoryState;
  vitals: PlayerSurvivalVitals;
}

/** Use a consumable to restore hunger/thirst/health reserves. */
export function consumeInventoryItem(
  itemDefinitionId: string,
): Promise<InventoryConsumeResponse> {
  return requestJson<InventoryConsumeResponse>('/game/inventory/consume', {
    method: 'POST',
    body: JSON.stringify({ itemDefinitionId }),
  });
}

export interface InventoryAmmoConsumeResponse {
  inventory: InventoryState;
}

/** Consume a precise ammunition quantity after a completed local reload timer. */
export function consumeInventoryAmmo(
  itemDefinitionId: string,
  quantity: number,
): Promise<InventoryAmmoConsumeResponse> {
  return requestJson<InventoryAmmoConsumeResponse>('/game/inventory/consume-ammo', {
    method: 'POST',
    body: JSON.stringify({ itemDefinitionId, quantity }),
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

// --- Item Mall and AsteronCredits -----------------------------------------

export interface CreditPacksResponse {
  packs: unknown[];
  /** False when the operator has not finished configuring Stripe; hide the buy flow. */
  checkoutEnabled: boolean;
}

/** Real-money credit bundles a player can buy. */
export function fetchCreditPacks(): Promise<CreditPacksResponse> {
  return requestJson<CreditPacksResponse>('/payments/packs', { method: 'GET' });
}

export interface CheckoutSessionResponse {
  purchaseId: string;
  sessionId: string;
  /** Hosted Stripe Checkout URL. Open it externally; never embed it. */
  url: string;
}

/**
 * Starts a Stripe Checkout session.
 *
 * Credits are granted by the Stripe webhook, not by this call and not by the success redirect,
 * so the client must treat the returned URL as the whole of its responsibility.
 */
export function createCheckoutSession(packId: string): Promise<CheckoutSessionResponse> {
  return requestJson<CheckoutSessionResponse>('/payments/checkout', {
    method: 'POST',
    body: JSON.stringify({ packId }),
  });
}

export interface CreditPurchaseSummary {
  id: string;
  packId: string;
  packName: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';
  priceCents: number;
  currency: string;
  creditsGranted: number;
  createdAt: string;
}

export interface CreditPurchasesResponse {
  purchases: CreditPurchaseSummary[];
  creditBalance: number;
}

/** Recent purchase attempts, polled after checkout to pick up webhook fulfillment. */
export function fetchCreditPurchases(): Promise<CreditPurchasesResponse> {
  return requestJson<CreditPurchasesResponse>('/payments/purchases', { method: 'GET' });
}

export interface MallStateResponse {
  listings: unknown[];
  creditBalance: number;
}

export function fetchMall(): Promise<MallStateResponse> {
  return requestJson<MallStateResponse>('/game/mall', { method: 'GET' });
}

export interface MallPurchaseResponse {
  creditBalance: number;
  inventory: InventoryState;
}

/** Spends AsteronCredits on a mall listing and adds the item to the player's inventory. */
export function purchaseMallItem(
  listingId: string,
  quantity = 1,
): Promise<MallPurchaseResponse> {
  return requestJson<MallPurchaseResponse>('/game/mall/purchase', {
    method: 'POST',
    body: JSON.stringify({ listingId, quantity }),
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
