import { createWorldState } from "../../player/world_state";
import type { SurfaceDestination } from "../../world/biome_teleport";
import { sampleHangarRest } from "../../world/station";
import { getShipRestHeightMeters } from "../../player/ship_layout";
import { listShipInstances, removeShipInstance } from "../../flight/ship_world";
import { MODE_ON_FOOT } from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { DeckPhysics } from "../ship/deck_physics";
import { teleportToSurface as runTeleportToSurface } from "./teleport_surface";
import {
  returnToApartmentForVitalsFailure as runReturnToApartment,
  setVitalsSyncLocked as runSetVitalsSyncLocked,
  syncApartmentInstanceForVitalsRecovery as runSyncApartment,
} from "./vitals_recovery";
import { attachDevShortcuts } from "./dev_shortcuts";

export interface WorldLifecycle {
  teleportToSurface: (destination: SurfaceDestination) => boolean;
  resetWorld: () => void;
  setVitalsSyncLocked: (locked: boolean) => void;
  syncApartmentInstanceForVitalsRecovery: () => void;
  returnToApartmentForVitalsFailure: () => void;
  cleanupForTitleReturn: () => void;
}

function cleanupForTitleReturn(
  ctx: LoopContext,
  deckPhysics: DeckPhysics,
): void {
  ctx.boostSfx.stop();
  ctx.thrustSfx.stop();
  ctx.footsteps.reset();
  deckPhysics.disposeShipDeckPhysics();
  let clearedHangar = false;
  for (const instance of listShipInstances()) {
    const inPrivateHangar =
      ctx.bootstrap !== null &&
      instance.instanceId === ctx.bootstrap.spawn.hangarInstanceId;
    const parkedInHangar =
      sampleHangarRest(
        ctx.stationFrame,
        instance.body.position,
        getShipRestHeightMeters(),
      ) !== null;
    if (!inPrivateHangar && !parkedInHangar) continue;
    removeShipInstance(instance.id);
    clearedHangar = true;
  }
  if (clearedHangar) ctx.world.assignedHangar = null;
  delete window.__claudecitizenWorld;
  delete window.__claudecitizenDev;
  window.__claudecitizenRenderStats = null;
}

/** World reset, vitals-lock apartment recovery, dev shortcuts, and teardown. */
export function createWorldLifecycle(
  ctx: LoopContext,
  deps: { deckPhysics: DeckPhysics },
): WorldLifecycle {
  const teleportToSurface = (destination: SurfaceDestination): boolean =>
    runTeleportToSurface(ctx, destination);

  function returnToApartmentForVitalsFailure(): void {
    runReturnToApartment(ctx, deps.deckPhysics);
  }

  function resetWorld(): void {
    const wasVitalsLocked = ctx.world.vitalsSyncLocked;
    ctx.world = createWorldState(ctx.planet, ctx.seed, {
      spawn: ctx.spawn,
      planetId: ctx.planetId,
      systemId: ctx.systemId,
      activeStationInstanceId: ctx.activeStationInstanceId,
      vitals: ctx.vitalsSession?.getVitals() ?? ctx.world.vitals,
    });
    ctx.world.vitalsSyncLocked = wasVitalsLocked;
    ctx.controls.setMode(MODE_ON_FOOT);
    ctx.controls.setOrbitFacing(
      ctx.world.cameraOrbit.yawRadians,
      ctx.world.cameraOrbit.pitchRadians,
    );
    if (ctx.bootstrap) {
      ctx.network?.transition(
        ctx.bootstrap.spawn.apartmentInstanceId,
        ctx.bootstrap.spawn.stationRoomId,
      );
    }
    ctx.stationNpcPopulation.reset(ctx.seed);
    ctx.footsteps.reset();
    ctx.onResetPeak();
    if (wasVitalsLocked) returnToApartmentForVitalsFailure();
  }

  attachDevShortcuts(ctx, teleportToSurface);

  return {
    teleportToSurface,
    resetWorld,
    setVitalsSyncLocked: (locked) => runSetVitalsSyncLocked(ctx, locked),
    syncApartmentInstanceForVitalsRecovery: () => runSyncApartment(ctx),
    returnToApartmentForVitalsFailure,
    cleanupForTitleReturn: () => cleanupForTitleReturn(ctx, deps.deckPhysics),
  };
}
