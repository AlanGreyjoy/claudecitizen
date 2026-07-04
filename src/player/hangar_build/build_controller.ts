import {
  createHangarPlacement,
  deleteHangarPlacement,
  purchaseHangarProp,
  updateHangarPlacement,
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

export interface HangarBuildControllerOptions {
  initialState: HangarBuildState;
  arcBalance: number;
  onStateChange?: (context: HangarBuildContext) => void;
  onPlacementsChange?: (state: HangarBuildState) => void;
}

export function createHangarBuildController(options: HangarBuildControllerOptions) {
  let context = createHangarBuildContext(options.initialState, options.arcBalance);
  let catalogOpen = false;
  let pointerNdc = { x: 0, y: 0 };

  function notify(): void {
    options.onStateChange?.(context);
  }

  function notifyPlacements(): void {
    options.onPlacementsChange?.(context.state);
  }

  function applyResponse(response: HangarBuildState & { arcBalance: number }): void {
    applyHangarBuildResponse(context, response);
    notify();
    notifyPlacements();
  }

  return {
    getContext(): HangarBuildContext {
      return context;
    },
    isCatalogOpen(): boolean {
      return catalogOpen;
    },
    isBuildToolActive(): boolean {
      return context.toolMode !== 'catalog';
    },
    isPaused(): boolean {
      return catalogOpen;
    },
    openCatalog(): void {
      catalogOpen = true;
      context.toolMode = 'catalog';
      context.ghost = null;
      notify();
    },
    closeCatalog(): void {
      catalogOpen = false;
      notify();
    },
    toggleCatalog(): void {
      if (catalogOpen) this.closeCatalog();
      else this.openCatalog();
    },
    setToolMode(mode: BuildToolMode): void {
      context.toolMode = mode;
      context.selectedPlacementId = null;
      context.ghost = null;
      context.statusMessage =
        mode === 'place'
          ? 'Move the ghost and click to place. R rotates. Esc exits.'
          : mode === 'move'
            ? 'Click a prop to move it. Click again to confirm.'
            : mode === 'delete'
              ? 'Click a prop to pick it up.'
              : '';
      if (mode !== 'catalog') catalogOpen = false;
      notify();
    },
    selectDefinition(propDefinitionId: string): void {
      context.selectedDefinitionId = propDefinitionId;
      notify();
    },
    setPointerNdc(x: number, y: number): void {
      pointerNdc = { x, y };
    },
    getPointerNdc(): { x: number; y: number } {
      return pointerNdc;
    },
    updateGhostFromFloor(floorPoint: { right: number; up: number; forward: number } | null): void {
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
        notify();
        return;
      }

      if (context.toolMode === 'move' && context.selectedPlacementId && context.ghost) {
        context.ghost = {
          ...context.ghost,
          right: floorPoint.right,
          up: floorPoint.up,
          forward: floorPoint.forward,
        };
        notify();
      }
    },
    rotateGhost(deltaRadians: number): void {
      if (!context.ghost) return;
      context.ghost = {
        ...context.ghost,
        rotationY: context.ghost.rotationY + deltaRadians,
      };
      notify();
    },
    async purchaseSelected(): Promise<void> {
      const definitionId = context.selectedDefinitionId;
      if (!definitionId || context.busy) return;
      context.busy = true;
      context.statusMessage = 'Purchasing…';
      notify();
      try {
        const response = await purchaseHangarProp(definitionId);
        applyResponse(response);
        context.statusMessage = 'Purchase complete.';
      } catch (error) {
        context.busy = false;
        context.statusMessage =
          error instanceof Error ? error.message : 'Purchase failed.';
        notify();
      }
    },
    async handlePrimaryAction(
      floorPoint: { right: number; up: number; forward: number } | null,
    ): Promise<void> {
      if (context.busy || !floorPoint) return;

      if (context.toolMode === 'place') {
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
        if (!validation.ok) {
          context.statusMessage = validation.message;
          notify();
          return;
        }
        context.busy = true;
        notify();
        try {
          const response = await createHangarPlacement(definitionId, validation.transform);
          applyResponse(response);
          context.ghost = validation.transform;
          context.statusMessage = 'Prop placed.';
        } catch (error) {
          context.busy = false;
          context.statusMessage = error instanceof Error ? error.message : 'Place failed.';
          notify();
        }
        return;
      }

      if (context.toolMode === 'move') {
        if (!context.selectedPlacementId) {
          const picked = pickNearestPlacement(
            floorPoint,
            context.state.placements.map((entry) => ({
              id: entry.id,
              right: entry.right,
              up: entry.up,
              forward: entry.forward,
              rotationY: entry.rotationY,
            })),
          );
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
        const definition = placement
          ? findDefinition(context, placement.propDefinitionId)
          : null;
        if (!placement || !definition || !context.ghost) return;

        const validation = validateClientPlacement({
          transform: context.ghost,
          hangarIndex: context.state.assignedHangar,
          allowRotateY: definition.allowRotateY,
          snapGridM: definition.snapGridM,
          existingPlacements: context.state.placements
            .filter((entry) => entry.id !== placement.id)
            .map((entry) => ({
              right: entry.right,
              up: entry.up,
              forward: entry.forward,
              rotationY: entry.rotationY,
            })),
        });
        if (!validation.ok) {
          context.statusMessage = validation.message;
          notify();
          return;
        }

        context.busy = true;
        notify();
        try {
          const response = await updateHangarPlacement(placement.id, validation.transform);
          applyResponse(response);
          context.selectedPlacementId = null;
          context.ghost = null;
          context.statusMessage = 'Prop moved.';
        } catch (error) {
          context.busy = false;
          context.statusMessage = error instanceof Error ? error.message : 'Move failed.';
          notify();
        }
        return;
      }

      if (context.toolMode === 'delete') {
        const picked = pickNearestPlacement(
          floorPoint,
          context.state.placements.map((entry) => ({
            id: entry.id,
            right: entry.right,
            up: entry.up,
            forward: entry.forward,
            rotationY: entry.rotationY,
          })),
        );
        if (!picked) return;
        context.busy = true;
        notify();
        try {
          const response = await deleteHangarPlacement(picked);
          applyResponse(response);
          context.statusMessage = 'Prop removed.';
        } catch (error) {
          context.busy = false;
          context.statusMessage = error instanceof Error ? error.message : 'Delete failed.';
          notify();
        }
      }
    },
    cancelTool(): void {
      context.toolMode = 'catalog';
      context.selectedPlacementId = null;
      context.ghost = null;
      context.statusMessage = '';
      notify();
    },
    syncBootstrap(state: HangarBuildState, arcBalance: number): void {
      context.state = state;
      context.arcBalance = arcBalance;
      notifyPlacements();
      notify();
    },
  };
}

export type HangarBuildController = ReturnType<typeof createHangarBuildController>;
