import { MODE_IN_STATION } from "../../player/modes";
import type { StationCharacterState } from "../../player/station_walk";
import type { BuildArea } from "../../net/api";
import type { BuildAreaRuntime } from "../types";
import type { LoopContext } from "../loop_context";
import {
  syncBuildPropsVisuals,
  updateBuildTool as runUpdateBuildTool,
} from "./build_ghost_sync";

export interface BuildTool {
  buildRuntimes: () => BuildAreaRuntime[];
  buildRuntimeForArea: (area: BuildArea) => BuildAreaRuntime | null;
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

/** Hangar/apartment build tool: prop ghost placement + HUD build button. */
export function createBuildTool(ctx: LoopContext): BuildTool {
  function buildRuntimes(): BuildAreaRuntime[] {
    return [ctx.build?.areas.hangar, ctx.build?.areas.apartment].filter(
      (runtime): runtime is BuildAreaRuntime => Boolean(runtime),
    );
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
    activeBuildRuntime,
    syncBuildPropsVisuals: (runtime) => syncBuildPropsVisuals(ctx, runtime),
    updateBuildTool: (runtime) => runUpdateBuildTool(ctx, runtime),
    updateBuildBtnVisibility,
    detachBuildButton,
  };
}
