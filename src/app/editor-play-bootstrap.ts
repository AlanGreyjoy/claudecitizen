import type {
  BuildArea,
  GameBootstrap,
  HangarBuildState,
  PropDefinitionEntry,
} from '../net/api';
import type { BuildPersistMode } from '../player/hangar_build/types';

export type { BuildPersistMode };

/** Stable id so offline editor bootstrap is never treated as a live citizen. */
export const EDITOR_OFFLINE_PLAYER_ID = 'editor-offline-player';

export function isEditorOfflineBootstrap(bootstrap: GameBootstrap | null | undefined): boolean {
  return bootstrap?.player.id === EDITOR_OFFLINE_PLAYER_ID;
}

/**
 * Starter catalog mirrored from `backend/migrations/0004_hangar_building.sql`.
 * Prefab ids must exist in the open project for ghosts to render.
 */
const EDITOR_STARTER_CATALOG: PropDefinitionEntry[] = [
  {
    id: 'starter-hangar-crate',
    name: 'Hangar Crate',
    description: 'Standard cargo crate for hangar storage and workshop staging.',
    prefabId: 'hangar-crate-01',
    costArc: 250,
    category: 'utility',
    maxPerHangar: 8,
    allowRotateY: true,
    snapGridM: 0.5,
  },
  {
    id: 'starter-hangar-lamp',
    name: 'Hangar Lamp',
    description: 'Overhead-style work lamp for hangar bays.',
    prefabId: 'hangar-lamp-01',
    costArc: 180,
    category: 'utility',
    maxPerHangar: 6,
    allowRotateY: true,
    snapGridM: 0.5,
  },
  {
    id: 'starter-hangar-bench',
    name: 'Hangar Bench',
    description: 'Crew seating bench for maintenance breaks.',
    // Project placeable — seed id hangar-bench-01 never shipped as a prefab.
    prefabId: 'seat-with-back',
    costArc: 320,
    category: 'furniture',
    maxPerHangar: 4,
    allowRotateY: true,
    snapGridM: 0.5,
  },
  {
    id: 'starter-hangar-panel',
    name: 'Wall Panel',
    description: 'Modular wall panel for bay customization.',
    prefabId: 'hangar-panel-01',
    costArc: 420,
    category: 'decoration',
    maxPerHangar: 6,
    allowRotateY: true,
    snapGridM: 0.5,
  },
  {
    id: 'starter-hangar-tool-rack',
    name: 'Tool Rack',
    description: 'Vertical tool rack for hangar maintenance gear.',
    prefabId: 'hangar-tool-rack-01',
    costArc: 540,
    category: 'utility',
    maxPerHangar: 3,
    allowRotateY: true,
    snapGridM: 0.5,
  },
];

const EDITOR_STARTER_INVENTORY_QTY = 8;

function offlineBuildState(area: BuildArea): HangarBuildState {
  return {
    area,
    assignedHangar: area === 'hangar' ? 2 : null,
    catalog: EDITOR_STARTER_CATALOG,
    inventory: EDITOR_STARTER_CATALOG.map((entry) => ({
      propDefinitionId: entry.id,
      quantity: EDITOR_STARTER_INVENTORY_QTY,
    })),
    placements: [],
  };
}

/**
 * Minimal citizen record so editor F6 can wire hangar/apartment Build Mode
 * without a signed-in session. Placements stay in-memory only.
 */
export function createEditorOfflineBootstrap(): GameBootstrap {
  return {
    player: {
      id: EDITOR_OFFLINE_PLAYER_ID,
      handle: 'editor',
      displayName: 'Editor',
      characterAppearance: null,
      vitals: {
        hungerReserve01: 1,
        thirstReserve01: 1,
        healthReserve01: 1,
      },
    },
    economy: {
      arcBalance: 100_000,
      creditBalance: 0,
    },
    mall: { listings: [] },
    spawn: {
      instanceId: 'editor-offline',
      apartmentInstanceId: 'apartment:editor-offline',
      hangarInstanceId: 'hangar:editor-offline',
      stationRoomId: 'hab-room',
    },
    ships: [],
    hangar: offlineBuildState('hangar'),
    apartment: offlineBuildState('apartment'),
    inventory: { catalog: [], items: [], loadout: {} },
    featureFlags: {
      webTransportPresence: false,
      serverAuthoritativePhysics: false,
    },
  };
}
