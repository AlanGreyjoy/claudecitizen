import { createStationCharacterAt } from "../../player/station_walk";
import { createQuantumTravelState } from "../../flight/quantum_travel";
import { STATION_SPAWN } from "../../world/station";
import { teleportStationPlayer } from "../../physics/station_physics";
import { MODE_IN_STATION, MODE_ON_FOOT } from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { DeckPhysics } from "../ship/deck_physics";

export function setVitalsSyncLocked(ctx: LoopContext, locked: boolean): void {
  ctx.world.vitalsSyncLocked = locked;
  if (!locked && ctx.world.prompt.includes("Vitals sync")) ctx.world.prompt = "";
}

export function syncApartmentInstanceForVitalsRecovery(ctx: LoopContext): void {
  if (!ctx.bootstrap) return;
  ctx.network?.transition(ctx.bootstrap.spawn.apartmentInstanceId, STATION_SPAWN.roomId);
}

export function returnToApartmentForVitalsFailure(
  ctx: LoopContext,
  deckPhysics: DeckPhysics,
): void {
  ctx.world.vitalsSyncLocked = true;
  ctx.world.character = createStationCharacterAt(
    ctx.stationFrame,
    STATION_SPAWN.roomId,
    { right: STATION_SPAWN.right, forward: STATION_SPAWN.forward },
    STATION_SPAWN.face,
    STATION_SPAWN.up,
  );
  ctx.world.mode = MODE_IN_STATION;
  ctx.world.shipExteriorWalk = false;
  ctx.world.prompt = "";
  ctx.world.activeBedId = null;
  ctx.world.transition = null;
  ctx.world.stationElevator = null;
  ctx.world.screenFade = 0;
  ctx.world.quantum = createQuantumTravelState();
  ctx.controls.setMode(MODE_ON_FOOT);
  ctx.controls.setOrbitFacing(
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );
  deckPhysics.disposeShipDeckPhysics();
  ctx.planetPhysics?.dispose();
  ctx.planetPhysics = null;
  if (ctx.physics) {
    teleportStationPlayer(ctx.physics, ctx.stationFrame, ctx.world.character.position);
  }
  syncApartmentInstanceForVitalsRecovery(ctx);
  ctx.stationNpcPopulation.reset(ctx.seed);
  ctx.footsteps.reset();
}
