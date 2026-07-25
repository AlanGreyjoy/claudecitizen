import type { WorldState } from '../../../player/world-state';
import type { InventoryState } from '../../../player/inventory/types';
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
}

export interface HaloBandOptions {
  /**
   * Editor Menu Manager preview: embedded layout, no F2/Esc listeners,
   * opens immediately on create.
   */
  preview?: boolean;
}

export type HaloBandTab = 'home' | 'comms' | 'missions' | 'map' | 'inventory' | 'ship';
