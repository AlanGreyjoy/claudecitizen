/**
 * Item Mall domain types — the AsteronCredit storefront.
 *
 * Pure data only: no DOM, no Three.js, no network. The HUD in `render/` renders these and
 * `net/` fetches them; this module just describes and normalizes the shape.
 */

/** A catalog item offered for AsteronCredits. */
export interface MallListing {
  id: string;
  itemDefinitionId: string;
  name: string;
  description: string;
  itemType: string;
  subType: string;
  iconUrl: string | null;
  rarity: string;
  stackMax: number;
  priceCredits: number;
  category: string;
  featured: boolean;
  /** Maximum quantity a player may hold, or null when unlimited. */
  limitPerPlayer: number | null;
  sortOrder: number;
}

/** A real-money bundle of AsteronCredits. */
export interface CreditPack {
  id: string;
  name: string;
  description: string;
  credits: number;
  bonusCredits: number;
  /** `credits + bonusCredits` — what the player actually receives. */
  totalCredits: number;
  priceCents: number;
  currency: string;
  iconUrl: string | null;
  sortOrder: number;
}

/** Everything the Mall tab needs to render. */
export interface MallState {
  listings: MallListing[];
  creditBalance: number;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Coerces one server listing into the domain shape, dropping anything malformed. */
export function normalizeMallListing(value: unknown): MallListing | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  const itemDefinitionId = asString(raw.itemDefinitionId);
  if (!id || !itemDefinitionId) return null;
  const limit = asNumber(raw.limitPerPlayer, 0);
  return {
    id,
    itemDefinitionId,
    name: asString(raw.name, itemDefinitionId),
    description: asString(raw.description),
    itemType: asString(raw.itemType, 'consumable'),
    subType: asString(raw.subType, 'generic'),
    iconUrl: asNullableString(raw.iconUrl),
    rarity: asString(raw.rarity, 'common'),
    stackMax: Math.max(1, Math.round(asNumber(raw.stackMax, 1))),
    priceCredits: Math.max(0, Math.round(asNumber(raw.priceCredits, 0))),
    category: asString(raw.category, 'consumable'),
    featured: raw.featured === true,
    limitPerPlayer: limit > 0 ? Math.round(limit) : null,
    sortOrder: Math.round(asNumber(raw.sortOrder, 0)),
  };
}

export function normalizeCreditPack(value: unknown): CreditPack | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  if (!id) return null;
  const credits = Math.max(0, Math.round(asNumber(raw.credits, 0)));
  const bonus = Math.max(0, Math.round(asNumber(raw.bonusCredits, 0)));
  return {
    id,
    name: asString(raw.name, id),
    description: asString(raw.description),
    credits,
    bonusCredits: bonus,
    totalCredits: Math.max(0, Math.round(asNumber(raw.totalCredits, credits + bonus))),
    priceCents: Math.max(0, Math.round(asNumber(raw.priceCents, 0))),
    currency: asString(raw.currency, 'usd'),
    iconUrl: asNullableString(raw.iconUrl),
    sortOrder: Math.round(asNumber(raw.sortOrder, 0)),
  };
}

export function normalizeMallState(value: unknown): MallState {
  const raw = (value ?? {}) as Record<string, unknown>;
  const listings = Array.isArray(raw.listings) ? raw.listings : [];
  return {
    listings: listings
      .map(normalizeMallListing)
      .filter((listing): listing is MallListing => listing !== null),
    creditBalance: Math.max(0, Math.round(asNumber(raw.creditBalance, 0))),
  };
}

/** Percentage bonus a pack carries over its base credits, for a "+15%" badge. */
export function creditPackBonusPercent(pack: CreditPack): number {
  if (pack.credits <= 0) return 0;
  return Math.round((pack.bonusCredits / pack.credits) * 100);
}

/** Formats a pack price for display, falling back when the currency code is unusable. */
export function formatPackPrice(pack: CreditPack): string {
  const code = pack.currency.toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(
      pack.priceCents / 100,
    );
  } catch {
    return `${(pack.priceCents / 100).toFixed(2)} ${code}`;
  }
}

/**
 * Whether a player can buy `quantity` more of a listing, and why not when they cannot.
 *
 * Mirrors the checks in `backend/crates/server/src/mall.rs` so the HUD can disable a button
 * instead of letting the request fail — the server remains the authority either way.
 */
export function mallPurchaseBlockedReason(
  listing: MallListing,
  creditBalance: number,
  owned: number,
  quantity = 1,
): string | null {
  if (quantity < 1) return 'Choose at least one.';
  const nextOwned = owned + quantity;
  if (nextOwned > listing.stackMax) return 'Stack full';
  if (listing.limitPerPlayer !== null && nextOwned > listing.limitPerPlayer) {
    return `Limit ${listing.limitPerPlayer}`;
  }
  if (creditBalance < listing.priceCredits * quantity) return 'Not enough credits';
  return null;
}
