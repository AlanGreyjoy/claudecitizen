import { MODE_IN_STATION } from "../../player/modes";
import type { StationCharacterState } from "../../player/station_walk";
import { syncDynamicColliders } from "../../physics/station_physics";
import { buildRoomForArea } from "../../player/hangar_build/validation";
import { pickStationFloorPoint } from "../../render/hangar/prop_instances";
import type { BuildArea } from "../../net/api";
import type { BuildAreaRuntime } from "../types";
import type { LoopContext } from "../loop_context";

export interface BuildTool {
  buildRuntimes: () => BuildAreaRuntime[];
  buildRuntimeForArea: (area: BuildArea) => BuildAreaRuntime | null;
  activeBuildRuntime: () => BuildAreaRuntime | null;
  syncBuildPropsVisuals: (runtime: BuildAreaRuntime) => Promise<void>;
  updateBuildTool: (runtime: BuildAreaRuntime) => void;
  updateBuildBtnVisibility: () => void;
  detachBuildButton: () => void;
}

/** Hangar/apartment build tool: prop ghost placement + HUD build button. */
export function createBuildTool(ctx: LoopContext): BuildTool {
  const onBuildBtnClick = () => {
    const runtime = buildRuntimeForCurrentRoom();
    if (!runtime || !ctx.build) return;
    ctx.build.terminal.open(runtime.controller);
  };
  ctx.buildBtnEl?.addEventListener("click", onBuildBtnClick);

  function buildRuntimes(): BuildAreaRuntime[] {
    return [ctx.build?.areas.hangar, ctx.build?.areas.apartment].filter(
      (runtime): runtime is BuildAreaRuntime => Boolean(runtime),
    );
  }

  function buildRuntimeForArea(area: BuildArea): BuildAreaRuntime | null {
    return ctx.build?.areas[area] ?? null;
  }

  function buildAreaForCurrentRoom(): BuildArea | null {
    if (!ctx.bootstrap || ctx.world.mode !== MODE_IN_STATION) return null;
    const roomId = (ctx.world.character as StationCharacterState).stationRoomId;
    if (roomId === "hab" || roomId === "hab-room") return "apartment";
    if (roomId === "hangar" || roomId.startsWith("hangar-")) return "hangar";
    return null;
  }

  function buildRuntimeForCurrentRoom(): BuildAreaRuntime | null {
    const area = buildAreaForCurrentRoom();
    return area ? buildRuntimeForArea(area) : null;
  }

  function updateBuildBtnVisibility(): void {
    if (!ctx.buildBtnEl) return;
    const visible =
      Boolean(buildRuntimeForCurrentRoom()) && !(ctx.build?.terminal.isOpen() ?? false);
    ctx.buildBtnEl.classList.toggle("is-hidden", !visible);
  }

  function activeBuildRuntime(): BuildAreaRuntime | null {
    return (
      buildRuntimes().find((runtime) => runtime.controller.isBuildToolActive()) ?? null
    );
  }

  async function syncBuildPropsVisuals(runtime: BuildAreaRuntime): Promise<void> {
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
    } else if (context.toolMode === "move" && ghost && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (placement) {
        await runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: ghost,
        });
      }
    } else {
      await runtime.propRenderer.setGhost(null);
    }
  }

  function pickBuildFloorFromPointer(
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

  function updateBuildTool(runtime: BuildAreaRuntime): void {
    if (!runtime.controller.isBuildToolActive()) return;
    const floorPoint = pickBuildFloorFromPointer(runtime);
    runtime.controller.updateGhostFromFloor(floorPoint);
    const context = runtime.controller.getContext();
    if (!context.ghost) {
      if (runtime.propRenderer.getGhost()) {
        void runtime.propRenderer.setGhost(null);
      }
      return;
    }

    const rendererGhost = runtime.propRenderer.getGhost();
    if (context.toolMode === "place") {
      const definition = context.selectedDefinitionId
        ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
        : null;
      if (!definition) return;
      if (!rendererGhost || rendererGhost.prefabId !== definition.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: definition.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else if (context.toolMode === "move" && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (!placement) return;
      if (!rendererGhost || rendererGhost.prefabId !== placement.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else {
      if (rendererGhost) void runtime.propRenderer.setGhost(null);
      return;
    }

    runtime.propRenderer.updateGhostTransform(context.ghost);
  }

  function detachBuildButton(): void {
    ctx.buildBtnEl?.removeEventListener("click", onBuildBtnClick);
    ctx.buildBtnEl?.classList.add("is-hidden");
  }

  return {
    buildRuntimes,
    buildRuntimeForArea,
    activeBuildRuntime,
    syncBuildPropsVisuals,
    updateBuildTool,
    updateBuildBtnVisibility,
    detachBuildButton,
  };
}
