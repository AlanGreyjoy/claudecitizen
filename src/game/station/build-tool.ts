import { MODE_IN_STATION } from "../../player/modes";
import type { StationCharacterState } from "../../player/station-walk";
import type { BuildArea } from "../../net/api";
import { stationPlacementBlocked } from "../../physics/station-placement";
import type { BuildAreaRuntime } from "../types";
import type { LoopContext } from "../loop-context";
import {
  syncBuildPropsVisuals,
  updateBuildTool as runUpdateBuildTool,
} from "./build-ghost-sync";

export interface BuildTool {
  buildRuntimes: () => BuildAreaRuntime[];
  buildRuntimeForArea: (area: BuildArea) => BuildAreaRuntime | null;
  buildRuntimeForCurrentRoom: () => BuildAreaRuntime | null;
  activeBuildRuntime: () => BuildAreaRuntime | null;
  syncBuildPropsVisuals: (runtime: BuildAreaRuntime) => Promise<void>;
  updateBuildTool: (runtime: BuildAreaRuntime) => void;
  updateBuildBtnVisibility: () => void;
  detachBuildButton: () => void;
}

function buildAreaForCurrentRoom(ctx: LoopContext): BuildArea | null {
  if (!ctx.bootstrap || ctx.world.mode !== MODE_IN_STATION) return null;
  const roomId = (ctx.world.character as StationCharacterState).stationRoomId;
  if (roomId === "hab" || roomId === "hab-room") return "apartment";
  if (roomId === "hangar" || roomId.startsWith("hangar-")) return "hangar";
  return null;
}

function wireEnvironmentProbe(
  ctx: LoopContext,
  runtime: BuildAreaRuntime,
): void {
  runtime.controller.setEnvironmentProbe(async ({ prefabId, transform, excludePlacementId }) => {
    if (!ctx.physics) return false;
    await runtime.propColliders.ensurePrefabColliders(prefabId);
    const runtimeTransform = runtime.placementFrame.toRuntime(transform);
    const colliders = runtime.propColliders.collidersAtRuntimeTransform(
      prefabId,
      runtimeTransform,
    );
    if (!colliders || colliders.length === 0) {
      // Placeable props always author a collider — refuse until bake is ready
      // rather than silently accepting a clip.
      return true;
    }
    return stationPlacementBlocked(ctx.physics, colliders, { excludePlacementId });
  });
}

/** Hangar/apartment build tool: prop ghost placement + HUD build button. */
export function createBuildTool(ctx: LoopContext): BuildTool {
  function buildRuntimes(): BuildAreaRuntime[] {
    return [ctx.build?.areas.hangar, ctx.build?.areas.apartment].filter(
      (runtime): runtime is BuildAreaRuntime => Boolean(runtime),
    );
  }

  for (const runtime of buildRuntimes()) {
    wireEnvironmentProbe(ctx, runtime);
  }

  function buildRuntimeForArea(area: BuildArea): BuildAreaRuntime | null {
    return ctx.build?.areas[area] ?? null;
  }

  function buildRuntimeForCurrentRoom(): BuildAreaRuntime | null {
    const area = buildAreaForCurrentRoom(ctx);
    return area ? buildRuntimeForArea(area) : null;
  }

  const onBuildBtnClick = () => {
    const runtime = buildRuntimeForCurrentRoom();
    if (!runtime || !ctx.build) return;
    ctx.build.terminal.open(runtime.controller);
  };
  ctx.buildBtnEl?.addEventListener("click", onBuildBtnClick);

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

  function detachBuildButton(): void {
    ctx.buildBtnEl?.removeEventListener("click", onBuildBtnClick);
    ctx.buildBtnEl?.classList.add("is-hidden");
  }

  return {
    buildRuntimes,
    buildRuntimeForArea,
    buildRuntimeForCurrentRoom,
    activeBuildRuntime,
    syncBuildPropsVisuals: (runtime) => syncBuildPropsVisuals(ctx, runtime),
    updateBuildTool: (runtime) => runUpdateBuildTool(ctx, runtime),
    updateBuildBtnVisibility,
    detachBuildButton,
  };
}
