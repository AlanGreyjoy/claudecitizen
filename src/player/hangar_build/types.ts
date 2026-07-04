import type {
  HangarBuildState,
  HangarPlacementEntry,
  PropDefinitionEntry,
} from '../../net/api';

export type BuildToolMode = 'catalog' | 'place' | 'move' | 'delete';

export interface BuildGhostTransform {
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

export interface HangarBuildContext {
  state: HangarBuildState;
  arcBalance: number;
  selectedDefinitionId: string | null;
  selectedPlacementId: string | null;
  toolMode: BuildToolMode;
  ghost: BuildGhostTransform | null;
  statusMessage: string;
  busy: boolean;
}

export function createHangarBuildContext(
  state: HangarBuildState,
  arcBalance: number,
): HangarBuildContext {
  return {
    state,
    arcBalance,
    selectedDefinitionId: state.catalog[0]?.id ?? null,
    selectedPlacementId: null,
    toolMode: 'catalog',
    ghost: null,
    statusMessage: '',
    busy: false,
  };
}

export function inventoryQuantity(
  context: HangarBuildContext,
  propDefinitionId: string,
): number {
  return (
    context.state.inventory.find((entry) => entry.propDefinitionId === propDefinitionId)
      ?.quantity ?? 0
  );
}

export function findDefinition(
  context: HangarBuildContext,
  propDefinitionId: string,
): PropDefinitionEntry | null {
  return context.state.catalog.find((entry) => entry.id === propDefinitionId) ?? null;
}

export function findPlacement(
  context: HangarBuildContext,
  placementId: string,
): HangarPlacementEntry | null {
  return context.state.placements.find((entry) => entry.id === placementId) ?? null;
}

export function applyHangarBuildResponse(
  context: HangarBuildContext,
  response: HangarBuildState & { arcBalance: number },
): void {
  context.state = {
    assignedHangar: response.assignedHangar,
    catalog: response.catalog,
    inventory: response.inventory,
    placements: response.placements,
  };
  context.arcBalance = response.arcBalance;
  context.busy = false;
}
