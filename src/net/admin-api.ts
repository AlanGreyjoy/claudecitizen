import { apiUrl } from './api';
import type { WeaponSlotType } from '../types/equipment';
import type { WeaponFireMode, WearableSlotType } from '../player/inventory/types';

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
  iconUrl: string | null;
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
  iconUrl?: string | null;
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
  starterPropDefinitionIds: string[];
  starterItemDefinitionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  itemType: string;
  subType: string;
  prefabId: string | null;
  iconUrl: string | null;
  stackMax: number;
  costArc: number;
  rarity: string;
  wearableSlotType?: WearableSlotType;
  occupiedSlotTypes?: WearableSlotType[];
  sidekickPartPresetId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemDefinitionInput {
  name: string;
  description: string;
  itemType: string;
  subType: string;
  prefabId: string | null;
  iconUrl: string | null;
  stackMax: number;
  costArc: number;
  rarity: string;
}

export interface WeaponDefinition extends ItemDefinition {
  weaponSlotType: WeaponSlotType;
  ammoItemDefinitionId: string | null;
  magazineSize: number;
  fireModes: WeaponFireMode[];
  roundsPerMinute: number;
  muzzleVelocityMps: number;
  bulletGravityMps2: number;
  maxRangeMeters: number;
  damage: number;
}

export interface WeaponDefinitionInput {
  name: string;
  description: string;
  subType: string;
  prefabId: string;
  iconUrl: string | null;
  costArc: number;
  rarity: string;
  weaponSlotType: WeaponSlotType;
  ammoItemDefinitionId: string | null;
  magazineSize: number;
  fireModes: WeaponFireMode[];
  roundsPerMinute: number;
  muzzleVelocityMps: number;
  bulletGravityMps2: number;
  maxRangeMeters: number;
  damage: number;
}

export interface BackpackDefinition extends ItemDefinition {
  capacityLiters: number;
  emptyMassKg: number;
}

export interface BackpackDefinitionInput {
  name: string;
  description: string;
  subType: string;
  prefabId: string;
  iconUrl: string | null;
  costArc: number;
  rarity: string;
  capacityLiters: number;
  emptyMassKg: number;
}

export interface WearableDefinition extends ItemDefinition {
  wearableSlotType: WearableSlotType;
  occupiedSlotTypes: WearableSlotType[];
  sidekickPartPresetId: number;
}

export interface WearableDefinitionInput {
  name: string;
  description: string;
  itemType: 'armor' | 'clothing';
  subType: string;
  prefabId: string | null;
  iconUrl: string | null;
  costArc: number;
  rarity: string;
  wearableSlotType: WearableSlotType;
  occupiedSlotTypes: WearableSlotType[];
  sidekickPartPresetId: number;
}

export interface PropDefinition {
  id: string;
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  category: string;
  maxPerHangar: number | null;
  allowRotateY: boolean;
  snapGridM: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropDefinitionInput {
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  category: string;
  maxPerHangar: number | null;
  allowRotateY: boolean;
  snapGridM: number | null;
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

export function assignShipToUser(
  userId: string,
  body: { shipDefinitionId: string },
): Promise<AdminOwnedShip> {
  return requestAdminJson<AdminOwnedShip>(
    `/admin/users/${encodeURIComponent(userId)}/ships`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
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
  starterPropDefinitionIds: string[];
  starterItemDefinitionIds: string[];
}): Promise<GameSettings> {
  return requestAdminJson<GameSettings>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listPropDefinitions(): Promise<PropDefinition[]> {
  return requestAdminJson<PropDefinition[]>('/admin/props', { method: 'GET' });
}

export function createPropDefinition(body: PropDefinitionInput): Promise<PropDefinition> {
  return requestAdminJson<PropDefinition>('/admin/props', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updatePropDefinition(
  id: string,
  body: Partial<PropDefinitionInput>,
): Promise<PropDefinition> {
  return requestAdminJson<PropDefinition>(`/admin/props/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function listItemDefinitions(): Promise<ItemDefinition[]> {
  return requestAdminJson<ItemDefinition[]>('/admin/items', { method: 'GET' });
}

export function createItemDefinition(body: ItemDefinitionInput): Promise<ItemDefinition> {
  return requestAdminJson<ItemDefinition>('/admin/items', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateItemDefinition(
  id: string,
  body: Partial<ItemDefinitionInput>,
): Promise<ItemDefinition> {
  return requestAdminJson<ItemDefinition>(`/admin/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteItemDefinition(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listWeaponDefinitions(): Promise<WeaponDefinition[]> {
  return requestAdminJson<WeaponDefinition[]>('/admin/weapons', { method: 'GET' });
}

export function createWeaponDefinition(
  body: WeaponDefinitionInput,
): Promise<WeaponDefinition> {
  return requestAdminJson<WeaponDefinition>('/admin/weapons', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateWeaponDefinition(
  id: string,
  body: Partial<WeaponDefinitionInput>,
): Promise<WeaponDefinition> {
  return requestAdminJson<WeaponDefinition>(`/admin/weapons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteWeaponDefinition(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/weapons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listBackpackDefinitions(): Promise<BackpackDefinition[]> {
  return requestAdminJson<BackpackDefinition[]>('/admin/backpacks', { method: 'GET' });
}

export function createBackpackDefinition(
  body: BackpackDefinitionInput,
): Promise<BackpackDefinition> {
  return requestAdminJson<BackpackDefinition>('/admin/backpacks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateBackpackDefinition(
  id: string,
  body: Partial<BackpackDefinitionInput>,
): Promise<BackpackDefinition> {
  return requestAdminJson<BackpackDefinition>(`/admin/backpacks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteBackpackDefinition(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/backpacks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listWearableDefinitions(): Promise<WearableDefinition[]> {
  return requestAdminJson<WearableDefinition[]>('/admin/wearables', { method: 'GET' });
}

export function createWearableDefinition(
  body: WearableDefinitionInput,
): Promise<WearableDefinition> {
  return requestAdminJson<WearableDefinition>('/admin/wearables', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateWearableDefinition(
  id: string,
  body: Partial<WearableDefinitionInput>,
): Promise<WearableDefinition> {
  return requestAdminJson<WearableDefinition>(`/admin/wearables/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteWearableDefinition(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/wearables/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// --- Commerce: payments, credit packs, and the Item Mall -------------------

/** Where a resolved Stripe secret came from. Environment always wins over the console. */
export type PaymentSecretSource = 'environment' | 'console' | 'unset';

/**
 * Provider status. Secrets are never returned — only whether one exists and a masked preview,
 * so the console can render a form without ever holding a live key.
 */
export interface PaymentConfig {
  provider: string;
  mode: 'test' | 'live';
  secretKeyConfigured: boolean;
  secretKeySource: PaymentSecretSource;
  secretKeyPreview: string | null;
  webhookSecretConfigured: boolean;
  webhookSecretSource: PaymentSecretSource;
  successUrl: string;
  cancelUrl: string;
  /** Paste this into the Stripe dashboard's webhook endpoint settings. */
  webhookUrl: string;
  checkoutEnabled: boolean;
  /** False when PAYMENTS_ENCRYPTION_KEY is unset, which blocks storing secrets. */
  encryptionConfigured: boolean;
}

export interface PaymentConfigInput {
  mode?: 'test' | 'live';
  /** Omit or send empty to leave the stored secret untouched. */
  secretKey?: string;
  webhookSecret?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreditPack {
  id: string;
  name: string;
  description: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  priceCents: number;
  currency: string;
  stripePriceId: string | null;
  iconUrl: string | null;
  sortOrder: number;
  active: boolean;
}

export interface CreditPackInput {
  name?: string;
  description?: string;
  credits?: number;
  bonusCredits?: number;
  priceCents?: number;
  currency?: string;
  stripePriceId?: string | null;
  iconUrl?: string | null;
  sortOrder?: number;
  active?: boolean;
}

export interface AdminMallListing {
  id: string;
  itemDefinitionId: string;
  itemName: string;
  itemType: string;
  subType: string;
  iconUrl: string | null;
  costArc: number;
  priceCredits: number;
  category: string;
  sortOrder: number;
  featured: boolean;
  active: boolean;
  limitPerPlayer: number | null;
}

export interface MallListingInput {
  itemDefinitionId?: string;
  priceCredits?: number;
  category?: string;
  sortOrder?: number;
  featured?: boolean;
  active?: boolean;
  limitPerPlayer?: number | null;
}

export interface AdminCreditPurchase {
  id: string;
  playerId: string;
  playerHandle: string | null;
  packId: string;
  packName: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';
  priceCents: number;
  currency: string;
  creditsGranted: number;
  providerSessionId: string | null;
  providerPaymentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: 'purchase' | 'grant' | 'refund' | 'chargeback' | 'spend' | 'award';
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface PlayerCreditLedger {
  creditBalance: number;
  entries: CreditLedgerEntry[];
}

export function getPaymentConfig(): Promise<PaymentConfig> {
  return requestAdminJson<PaymentConfig>('/admin/payments/config', { method: 'GET' });
}

export function updatePaymentConfig(body: PaymentConfigInput): Promise<PaymentConfig> {
  return requestAdminJson<PaymentConfig>('/admin/payments/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listCreditPacks(): Promise<CreditPack[]> {
  return requestAdminJson<CreditPack[]>('/admin/credit-packs', { method: 'GET' });
}

export function createCreditPack(body: CreditPackInput): Promise<CreditPack> {
  return requestAdminJson<CreditPack>('/admin/credit-packs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCreditPack(id: string, body: CreditPackInput): Promise<CreditPack> {
  return requestAdminJson<CreditPack>(`/admin/credit-packs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteCreditPack(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/credit-packs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listAdminMallListings(): Promise<AdminMallListing[]> {
  return requestAdminJson<AdminMallListing[]>('/admin/mall', { method: 'GET' });
}

export function createMallListing(body: MallListingInput): Promise<AdminMallListing> {
  return requestAdminJson<AdminMallListing>('/admin/mall', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateMallListing(
  id: string,
  body: MallListingInput,
): Promise<AdminMallListing> {
  return requestAdminJson<AdminMallListing>(`/admin/mall/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteMallListing(id: string): Promise<void> {
  return requestAdminJson<void>(`/admin/mall/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listAdminCreditPurchases(status?: string): Promise<AdminCreditPurchase[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return requestAdminJson<AdminCreditPurchase[]>(`/admin/payments/purchases${query}`, {
    method: 'GET',
  });
}

/** `playerId` here is the player record id, not the user id. */
export function getPlayerCreditLedger(playerId: string): Promise<PlayerCreditLedger> {
  return requestAdminJson<PlayerCreditLedger>(
    `/admin/users/${encodeURIComponent(playerId)}/credits`,
    { method: 'GET' },
  );
}

export function grantPlayerCredits(
  playerId: string,
  body: { delta: number; reason?: string; reasonCode?: 'grant' | 'award' },
): Promise<{ creditBalance: number }> {
  return requestAdminJson<{ creditBalance: number }>(
    `/admin/users/${encodeURIComponent(playerId)}/credits`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
