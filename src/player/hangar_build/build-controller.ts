import {
  createBuildPlacement,
  deleteBuildPlacement,
  purchaseBuildProp,
  updateBuildPlacement,
  type HangarBuildState,
} from '../../net/api';
import {
  applyHangarBuildResponse,
  createHangarBuildContext,
  findDefinition,
  findPlacement,
  inventoryQuantity,
  type BuildToolMode,
  type HangarBuildContext,
} from './types';
import {
  pickNearestPlacement,
  validateClientPlacement,
  type PlacementTransform,
} from './validation';

type FloorPoint = { right: number; up: number; forward: number };

interface BuildActionDeps {
  applyResponse: (response: HangarBuildState & { arcBalance: number }) => void;
  context: HangarBuildContext;
  notify: () => void;
}

function placementPickTargets(context: HangarBuildContext) {
  return context.state.placements.map((entry) => ({
    id: entry.id,
    right: entry.right,
    up: entry.up,
    forward: entry.forward,
    rotationY: entry.rotationY,
  }));
}
function placementTransforms(
  context: HangarBuildContext,
  excludePlacementId?: string,
): PlacementTransform[] {
  return context.state.placements
    .filter((entry) => entry.id !== excludePlacementId)
    .map((entry) => ({
      right: entry.right,
      up: entry.up,
      forward: entry.forward,
      rotationY: entry.rotationY,
    }));
}

async function handlePlacePrimaryAction(
  deps: BuildActionDeps,
  floorPoint: FloorPoint,
): Promise<void> {
  const { context, notify, applyResponse } = deps;
  const definitionId = context.selectedDefinitionId;
  const definition = definitionId ? findDefinition(context, definitionId) : null;
  if (!definitionId || !definition) return;
  if (inventoryQuantity(context, definitionId) <= 0) {
    context.statusMessage = 'Purchase this prop before placing it.';
    notify();
    return;
  }
  const ghost = context.ghost ?? {
    right: floorPoint.right,
    up: floorPoint.up,
    forward: floorPoint.forward,
    rotationY: 0,
  };
  const validation = validateClientPlacement({
    area: context.state.area,
    transform: ghost,
    hangarIndex: context.state.assignedHangar,
    allowRotateY: definition.allowRotateY,
    snapGridM: definition.snapGridM,
    existingPlacements: placementTransforms(context),
  });
  if (!validation.ok) {
    context.statusMessage = validation.message;
    notify();
    return;
  }
  context.busy = true;
  notify();
  try {
    const response = await createBuildPlacement(
      context.state.area,
      definitionId,
      validation.transform,
    );
    applyResponse(response);
    context.ghost = validation.transform;
    context.statusMessage = 'Prop placed.';
  } catch (error) {
    context.busy = false;
    context.statusMessage = error instanceof Error ? error.message : 'Place failed.';
    notify();
  }
}

async function handleMovePrimaryAction(
  deps: BuildActionDeps,
  floorPoint: FloorPoint,
): Promise<void> {
  const { context, notify, applyResponse } = deps;

  if (!context.selectedPlacementId) {
    const picked = pickNearestPlacement(floorPoint, placementPickTargets(context));
    if (!picked) return;
    const placement = findPlacement(context, picked);
    if (!placement) return;
    context.selectedPlacementId = picked;
    context.ghost = {
      right: placement.right,
      up: placement.up,
      forward: placement.forward,
      rotationY: placement.rotationY,
    };
    context.statusMessage = 'Move the prop and click to confirm.';
    notify();
    return;
  }

  const placement = findPlacement(context, context.selectedPlacementId);
  const definition = placement ? findDefinition(context, placement.propDefinitionId) : null;
  if (!placement || !definition || !context.ghost) return;

  const validation = validateClientPlacement({
    area: context.state.area,
    transform: context.ghost,
    hangarIndex: context.state.assignedHangar,
    allowRotateY: definition.allowRotateY,
    snapGridM: definition.snapGridM,
    existingPlacements: placementTransforms(context, placement.id),
  });
  if (!validation.ok) {
    context.statusMessage = validation.message;
    notify();
    return;
  }

  context.busy = true;
  notify();
  try {
    const response = await updateBuildPlacement(
      context.state.area,
      placement.id,
      validation.transform,
    );
    applyResponse(response);
    context.selectedPlacementId = null;
    context.ghost = null;
    context.statusMessage = 'Prop moved.';
  } catch (error) {
    context.busy = false;
    context.statusMessage = error instanceof Error ? error.message : 'Move failed.';
    notify();
  }
}

async function handleDeletePrimaryAction(
  deps: BuildActionDeps,
  floorPoint: FloorPoint,
): Promise<void> {
  const { context, notify, applyResponse } = deps;
  const picked = pickNearestPlacement(floorPoint, placementPickTargets(context));
  if (!picked) return;
  context.busy = true;
  notify();
  try {
    const response = await deleteBuildPlacement(context.state.area, picked);
    applyResponse(response);
    context.statusMessage = 'Prop removed.';
  } catch (error) {
    context.busy = false;
    context.statusMessage = error instanceof Error ? error.message : 'Delete failed.';
    notify();
  }
}

export interface HangarBuildControllerOptions {
  initialState: HangarBuildState;
  arcBalance: number;
  onStateChange?: (context: HangarBuildContext) => void;
  onPlacementsChange?: (state: HangarBuildState) => void;
}

interface ControllerRuntime {
  context: HangarBuildContext;
  options: HangarBuildControllerOptions;
  catalogOpen: boolean;
  pointerNdc: { x: number; y: number };
}

function notify(rt: ControllerRuntime): void {
  rt.options.onStateChange?.(rt.context);
}

function notifyPlacements(rt: ControllerRuntime): void {
  rt.options.onPlacementsChange?.(rt.context.state);
}

function applyResponse(rt: ControllerRuntime, response: HangarBuildState & { arcBalance: number }): void {
  applyHangarBuildResponse(rt.context, response);
  notify(rt);
  notifyPlacements(rt);
}

function buildDeps(rt: ControllerRuntime): BuildActionDeps {
  return {
    context: rt.context,
    notify: () => notify(rt),
    applyResponse: (response) => applyResponse(rt, response),
  };
}

function openCatalog(rt: ControllerRuntime): void {
  rt.catalogOpen = true;
  rt.context.toolMode = 'catalog';
  rt.context.ghost = null;
  notify(rt);
}

function closeCatalog(rt: ControllerRuntime): void {
  rt.catalogOpen = false;
  notify(rt);
}

function setToolMode(rt: ControllerRuntime, mode: BuildToolMode): void {
  rt.context.toolMode = mode;
  rt.context.selectedPlacementId = null;
  rt.context.ghost = null;
  rt.context.statusMessage =
    mode === 'place'
      ? 'Move the ghost and click to place. R rotates. Esc exits.'
      : mode === 'move'
        ? 'Click a prop to move it. Click again to confirm.'
        : mode === 'delete'
          ? 'Click a prop to pick it up.'
          : '';
  if (mode !== 'catalog') rt.catalogOpen = false;
  notify(rt);
}

function updateGhostFromFloor(
  rt: ControllerRuntime,
  floorPoint: { right: number; up: number; forward: number } | null,
): void {
  const { context } = rt;
  if (!floorPoint) return;
  if (context.toolMode === 'place') {
    const definition = context.selectedDefinitionId
      ? findDefinition(context, context.selectedDefinitionId)
      : null;
    if (!definition) return;
    const ghost: PlacementTransform = {
      right: floorPoint.right,
      up: floorPoint.up,
      forward: floorPoint.forward,
      rotationY: context.ghost?.rotationY ?? 0,
    };
    const validation = validateClientPlacement({
      area: context.state.area,
      transform: ghost,
      hangarIndex: context.state.assignedHangar,
      allowRotateY: definition.allowRotateY,
      snapGridM: definition.snapGridM,
      existingPlacements: context.state.placements.map((entry) => ({
        right: entry.right,
        up: entry.up,
        forward: entry.forward,
        rotationY: entry.rotationY,
      })),
    });
    context.ghost = validation.ok ? validation.transform : ghost;
    notify(rt);
    return;
  }

  if (context.toolMode === 'move' && context.selectedPlacementId && context.ghost) {
    context.ghost = {
      ...context.ghost,
      right: floorPoint.right,
      up: floorPoint.up,
      forward: floorPoint.forward,
    };
    notify(rt);
  }
}

function rotateGhost(rt: ControllerRuntime, deltaRadians: number): void {
  if (!rt.context.ghost) return;
  rt.context.ghost = {
    ...rt.context.ghost,
    rotationY: rt.context.ghost.rotationY + deltaRadians,
  };
  notify(rt);
}

async function purchaseSelected(rt: ControllerRuntime): Promise<void> {
  const { context } = rt;
  const definitionId = context.selectedDefinitionId;
  if (!definitionId || context.busy) return;
  context.busy = true;
  context.statusMessage = 'Purchasing…';
  notify(rt);
  try {
    const response = await purchaseBuildProp(context.state.area, definitionId);
    applyResponse(rt, response);
    context.statusMessage = 'Purchase complete.';
  } catch (error) {
    context.busy = false;
    context.statusMessage =
      error instanceof Error ? error.message : 'Purchase failed.';
    notify(rt);
  }
}

async function handlePrimaryAction(rt: ControllerRuntime, floorPoint: FloorPoint | null): Promise<void> {
  const { context } = rt;
  if (context.busy || !floorPoint) return;
  const deps = buildDeps(rt);
  if (context.toolMode === 'place') {
    await handlePlacePrimaryAction(deps, floorPoint);
    return;
  }
  if (context.toolMode === 'move') {
    await handleMovePrimaryAction(deps, floorPoint);
    return;
  }
  if (context.toolMode === 'delete') {
    await handleDeletePrimaryAction(deps, floorPoint);
  }
}

function cancelTool(rt: ControllerRuntime): void {
  rt.context.toolMode = 'catalog';
  rt.context.selectedPlacementId = null;
  rt.context.ghost = null;
  rt.context.statusMessage = '';
  notify(rt);
}

function syncBootstrap(rt: ControllerRuntime, state: HangarBuildState, arcBalance: number): void {
  rt.context.state = state;
  rt.context.arcBalance = arcBalance;
  notifyPlacements(rt);
  notify(rt);
}

export function createHangarBuildController(options: HangarBuildControllerOptions) {
  const rt: ControllerRuntime = {
    context: createHangarBuildContext(options.initialState, options.arcBalance),
    options,
    catalogOpen: false,
    pointerNdc: { x: 0, y: 0 },
  };

  return {
    getContext: (): HangarBuildContext => rt.context,
    isCatalogOpen: (): boolean => rt.catalogOpen,
    isBuildToolActive: (): boolean => rt.context.toolMode !== 'catalog',
    isPaused: (): boolean => rt.catalogOpen,
    openCatalog: (): void => openCatalog(rt),
    closeCatalog: (): void => closeCatalog(rt),
    toggleCatalog(): void {
      if (rt.catalogOpen) closeCatalog(rt);
      else openCatalog(rt);
    },
    setToolMode: (mode: BuildToolMode): void => setToolMode(rt, mode),
    selectDefinition(propDefinitionId: string): void {
      rt.context.selectedDefinitionId = propDefinitionId;
      notify(rt);
    },
    setPointerNdc(x: number, y: number): void {
      rt.pointerNdc = { x, y };
    },
    getPointerNdc: (): { x: number; y: number } => rt.pointerNdc,
    updateGhostFromFloor: (
      floorPoint: { right: number; up: number; forward: number } | null,
    ): void => updateGhostFromFloor(rt, floorPoint),
    rotateGhost: (deltaRadians: number): void => rotateGhost(rt, deltaRadians),
    purchaseSelected: (): Promise<void> => purchaseSelected(rt),
    handlePrimaryAction: (floorPoint: FloorPoint | null): Promise<void> =>
      handlePrimaryAction(rt, floorPoint),
    cancelTool: (): void => cancelTool(rt),
    syncBootstrap: (state: HangarBuildState, arcBalance: number): void =>
      syncBootstrap(rt, state, arcBalance),
  };
}

export type HangarBuildController = ReturnType<typeof createHangarBuildController>;
