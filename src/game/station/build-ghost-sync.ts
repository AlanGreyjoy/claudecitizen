import { syncDynamicColliders } from "../../physics/station_physics";
import { buildRoomForArea } from "../../player/hangar_build/validation";
import { pickStationFloorPoint } from "../../render/hangar/prop_instances";
import type { BuildAreaRuntime } from "../types";
import type { LoopContext } from "../loop_context";

export async function syncBuildPropsVisuals(
  ctx: LoopContext,
  runtime: BuildAreaRuntime,
): Promise<void> {
  const context = runtime.controller.getContext();
  const propColliders = runtime.propColliders.getColliders();
  if (ctx.physics) {
    await syncDynamicColliders(ctx.physics, propColliders);
  }
  await runtime.propRenderer.setPlacements(context.state.placements);
  await runtime.propColliders.setPlacements(context.state.placements);
  const ghost = context.ghost;
  const definition = context.selectedDefinitionId
    ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
    : null;
  if (ghost && definition && context.toolMode === "place") {
    await runtime.propRenderer.setGhost({
      prefabId: definition.prefabId,
      transform: ghost,
    });
    return;
  }
  if (context.toolMode === "move" && ghost && context.selectedPlacementId) {
    const placement = context.state.placements.find(
      (entry) => entry.id === context.selectedPlacementId,
    );
    if (placement) {
      await runtime.propRenderer.setGhost({
        prefabId: placement.prefabId,
        transform: ghost,
      });
      return;
    }
  }
  await runtime.propRenderer.setGhost(null);
}

function pickBuildFloorFromPointer(
  ctx: LoopContext,
  runtime: BuildAreaRuntime,
): { right: number; up: number; forward: number } | null {
  if (!ctx.renderer) return null;
  const context = runtime.controller.getContext();
  const room = buildRoomForArea(context.state.area, context.state.assignedHangar);
  return pickStationFloorPoint(
    ctx.renderer.getCamera(),
    runtime.controller.getPointerNdc(),
    ctx.renderer.getStationRoot(),
    room.floorUp,
  );
}

function ensurePlaceGhost(runtime: BuildAreaRuntime): boolean {
  const context = runtime.controller.getContext();
  const rendererGhost = runtime.propRenderer.getGhost();
  const definition = context.selectedDefinitionId
    ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
    : null;
  if (!definition || !context.ghost) return false;
  if (!rendererGhost || rendererGhost.prefabId !== definition.prefabId) {
    void runtime.propRenderer.setGhost({
      prefabId: definition.prefabId,
      transform: context.ghost,
    });
    return false;
  }
  return true;
}

function ensureMoveGhost(runtime: BuildAreaRuntime): boolean {
  const context = runtime.controller.getContext();
  const rendererGhost = runtime.propRenderer.getGhost();
  if (!context.selectedPlacementId || !context.ghost) return false;
  const placement = context.state.placements.find(
    (entry) => entry.id === context.selectedPlacementId,
  );
  if (!placement) return false;
  if (!rendererGhost || rendererGhost.prefabId !== placement.prefabId) {
    void runtime.propRenderer.setGhost({
      prefabId: placement.prefabId,
      transform: context.ghost,
    });
    return false;
  }
  return true;
}

export function updateBuildTool(
  ctx: LoopContext,
  runtime: BuildAreaRuntime,
): void {
  if (!runtime.controller.isBuildToolActive()) return;
  const floorPoint = pickBuildFloorFromPointer(ctx, runtime);
  runtime.controller.updateGhostFromFloor(floorPoint);
  const context = runtime.controller.getContext();
  if (!context.ghost) {
    if (runtime.propRenderer.getGhost()) {
      void runtime.propRenderer.setGhost(null);
    }
    return;
  }

  if (context.toolMode === "place") {
    if (!ensurePlaceGhost(runtime)) return;
  } else if (context.toolMode === "move" && context.selectedPlacementId) {
    if (!ensureMoveGhost(runtime)) return;
  } else {
    if (runtime.propRenderer.getGhost()) void runtime.propRenderer.setGhost(null);
    return;
  }

  runtime.propRenderer.updateGhostTransform(context.ghost);
}
