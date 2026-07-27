import type { WorldState } from '../../../player/world-state';
import type { InventoryState } from '../../../player/inventory/types';
import type { CreditPack, MallListing } from '../../../player/mall/types';
import type { Planet, PlanetSurfaceSample } from '../../../types';

export interface HaloBandUpdateParams {
  world: WorldState;
  shipSurface: PlanetSurfaceSample;
  focusSurface: PlanetSurfaceSample;
  planet: Planet;
}

export interface HaloBandCallbacks {
  onSendMessage: (text: string) => void;
  playerControls: { setInputSuppressed: (value: boolean) => void };
  /** Returns the player's current ARC balance, or null when offline / unavailable. */
  getArcBalance: () => number | null;
  /** Returns portable inventory state, or null when offline / unavailable. */
  getInventory: () => InventoryState | null;
  /** Item Mall wiring. Omit to hide the Mall tab entirely (editor preview, offline play). */
  mall?: HaloBandMallCallbacks;
}

/** Storefront and credit-pack data the Mall tab renders. */
export interface HaloBandMallSnapshot {
  listings: MallListing[];
  packs: CreditPack[];
  creditBalance: number;
  /** False when the operator has not configured Stripe; the buy-credits flow stays hidden. */
  checkoutEnabled: boolean;
}

export interface HaloBandMallCallbacks {
  /** Loads listings, packs, and the current AsteronCredit balance. */
  fetchMall: () => Promise<HaloBandMallSnapshot>;
  /** Spends credits on a listing and resolves with the new balance. */
  purchaseListing: (listingId: string, quantity: number) => Promise<number>;
  /**
   * Opens hosted Stripe Checkout outside the game. Resolves false when no browser could be
   * opened, so the panel can tell the player instead of appearing to hang.
   */
  startCheckout: (packId: string) => Promise<boolean>;
  /** Polls purchase state after checkout; credits are granted by the webhook. */
  fetchPurchases: () => Promise<{ creditBalance: number }>;
  /** Quantity of an item the player already holds, for stack and hold-limit checks. */
  getOwnedQuantity: (itemDefinitionId: string) => number;
}

export interface HaloBandMallElements {
  balanceEl: HTMLElement;
  storeEl: HTMLElement;
  packsEl: HTMLElement;
  noticeEl: HTMLElement;
}

export interface HaloBandOptions {
  /**
   * Editor Menu Manager preview: embedded layout, no F2/Esc listeners,
   * opens immediately on create.
   */
  preview?: boolean;
}

export type HaloBandTab =
  | 'home'
  | 'comms'
  | 'missions'
  | 'map'
  | 'inventory'
  | 'mall'
  | 'ship';
