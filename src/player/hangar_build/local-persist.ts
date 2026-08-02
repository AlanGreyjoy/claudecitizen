import type {
  HangarBuildState,
  HangarPlacementEntry,
  HangarBuildResponse,
} from '../../net/api';
import {
  findDefinition,
  inventoryQuantity,
  type HangarBuildContext,
} from './types';
import type { PlacementTransform } from './validation';

function cloneBuildState(state: HangarBuildState): HangarBuildState {
  return {
    area: state.area,
    assignedHangar: state.assignedHangar,
    catalog: state.catalog,
    inventory: state.inventory.map((entry) => ({ ...entry })),
    placements: state.placements.map((entry) => ({ ...entry })),
  };
}

function withArc(state: HangarBuildState, arcBalance: number): HangarBuildResponse {
  return { ...cloneBuildState(state), arcBalance };
}

function bumpInventory(
  state: HangarBuildState,
  propDefinitionId: string,
  delta: number,
): HangarBuildState {
  const next = cloneBuildState(state);
  const existing = next.inventory.find((entry) => entry.propDefinitionId === propDefinitionId);
  if (existing) {
    existing.quantity = Math.max(0, existing.quantity + delta);
    if (existing.quantity === 0) {
      next.inventory = next.inventory.filter(
        (entry) => entry.propDefinitionId !== propDefinitionId,
      );
    }
  } else if (delta > 0) {
    next.inventory.push({ propDefinitionId, quantity: delta });
  }
  return next;
}

/** In-memory purchase / place / move / delete for editor offline Build Mode. */
export function localPurchaseResponse(
  context: HangarBuildContext,
  propDefinitionId: string,
): HangarBuildResponse {
  const definition = findDefinition(context, propDefinitionId);
  if (!definition) throw new Error('Unknown prop.');
  if (context.arcBalance < definition.costArc) {
    throw new Error('Not enough ARC.');
  }
  const state = bumpInventory(context.state, propDefinitionId, 1);
  return withArc(state, context.arcBalance - definition.costArc);
}

export function localPlaceResponse(
  context: HangarBuildContext,
  propDefinitionId: string,
  transform: PlacementTransform,
): HangarBuildResponse {
  const definition = findDefinition(context, propDefinitionId);
  if (!definition) throw new Error('Unknown prop.');
  if (inventoryQuantity(context, propDefinitionId) <= 0) {
    throw new Error('Purchase this prop before placing it.');
  }
  const placement: HangarPlacementEntry = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    area: context.state.area,
    propDefinitionId,
    prefabId: definition.prefabId,
    right: transform.right,
    up: transform.up,
    forward: transform.forward,
    rotationY: transform.rotationY,
  };
  const state = bumpInventory(context.state, propDefinitionId, -1);
  state.placements = [...state.placements, placement];
  return withArc(state, context.arcBalance);
}

export function localMoveResponse(
  context: HangarBuildContext,
  placementId: string,
  transform: PlacementTransform,
): HangarBuildResponse {
  const state = cloneBuildState(context.state);
  const placement = state.placements.find((entry) => entry.id === placementId);
  if (!placement) throw new Error('Placement not found.');
  placement.right = transform.right;
  placement.up = transform.up;
  placement.forward = transform.forward;
  placement.rotationY = transform.rotationY;
  return withArc(state, context.arcBalance);
}

export function localDeleteResponse(
  context: HangarBuildContext,
  placementId: string,
): HangarBuildResponse {
  const placement = context.state.placements.find((entry) => entry.id === placementId);
  if (!placement) throw new Error('Placement not found.');
  const state = bumpInventory(context.state, placement.propDefinitionId, 1);
  state.placements = state.placements.filter((entry) => entry.id !== placementId);
  return withArc(state, context.arcBalance);
}
