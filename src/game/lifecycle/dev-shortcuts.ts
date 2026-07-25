import { createStationCharacterAt } from "../../player/station_walk";
import { callShipToHangar } from "../../player/station_interaction";
import { getStationHangars } from "../../world/station";
import { MODE_IN_STATION } from "../../player/modes";
import type { ColorCorrectionSettings, SsaoSettings } from "../../types";
import type { SurfaceDestination } from "../../world/biome_teleport";
import type { LoopContext } from "../loop_context";
import { getSurfaceSpawnDebug } from "./surface_spawn_debug";

/** Console-only dev shortcuts (mirrors the __spikeScene diagnostic). */
export function attachDevShortcuts(
  ctx: LoopContext,
  teleportToSurface: (destination: SurfaceDestination) => boolean,
): void {
  window.__claudecitizenDev = {
    callShip: async () => {
      const hangar = await callShipToHangar(ctx.world, ctx.planet, ctx.seed, {
        ownedShip: ctx.bootstrap?.ships[0],
        playerId: ctx.bootstrap?.player.id,
        hangarInstanceId: ctx.bootstrap?.spawn.hangarInstanceId,
      });
      return hangar?.index ?? 0;
    },
    teleportToHangar: (index: number) => {
      const hangars = getStationHangars();
      const hangar =
        hangars.find((entry) => entry.index === index) ?? hangars[0];
      if (!hangar) return;
      ctx.world.character = createStationCharacterAt(
        ctx.stationFrame,
        hangar.roomId,
        { right: hangar.centerRight, forward: -12 },
        { right: 0, forward: 1 },
      );
      ctx.world.mode = MODE_IN_STATION;
      ctx.world.stationElevator = null;
      ctx.world.screenFade = 0;
    },
    face: (yawRadians: number, pitchRadians?: number) =>
      ctx.controls.setOrbitFacing(yawRadians, pitchRadians),
    setColorCorrection: (settings: Partial<ColorCorrectionSettings>) =>
      ctx.renderer?.setColorCorrectionSettings(settings),
    setSsaoSettings: (settings: Partial<SsaoSettings>) =>
      ctx.renderer?.setSsaoSettings(settings),
    setSsaoIntensity: (intensity: number) =>
      ctx.renderer?.setSsaoSettings({ intensity }),
    setSsaoColor: (color: string | null) => ctx.renderer?.setSsaoColor(color),
    getSurfaceSpawnDebug: () => getSurfaceSpawnDebug(ctx),
    teleportToSurface,
  };
}
