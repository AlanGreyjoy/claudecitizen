import { createWorldState } from "../../player/world_state";
import {
  findSurfaceDestination,
  type SurfaceDestination,
} from "../../world/biome_teleport";
import { cartesianFromLatLonAlt, surfacePointFromPosition } from "../../world/coordinates";
import { warmRenderableHeightRing } from "../../world/spawn_warm";
import { sampleFootPlanetSurface } from "../../world/planet_surface";
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
} from "../../player/character_controller";
import { initialCameraYaw } from "../../player/spawn";
import { createQuantumTravelState } from "../../flight/quantum_travel";
import { createStationCharacterAt } from "../../player/station_walk";
import { callShipToHangar } from "../../player/station_interaction";
import {
  getStationHangars,
  sampleHangarRest,
  STATION_SPAWN,
} from "../../world/station";
import { getShipRestHeightMeters } from "../../player/ship_layout";
import { listShipInstances, removeShipInstance } from "../../flight/ship_world";
import { teleportStationPlayer } from "../../physics/station_physics";
import { MODE_IN_STATION, MODE_ON_FOOT } from "../../player/modes";
import type { ColorCorrectionSettings, SsaoSettings } from "../../types";
import type { LoopContext } from "../loop_context";
import type { DeckPhysics } from "../ship/deck_physics";

export interface WorldLifecycle {
  teleportToSurface: (destination: SurfaceDestination) => boolean;
  resetWorld: () => void;
  setVitalsSyncLocked: (locked: boolean) => void;
  syncApartmentInstanceForVitalsRecovery: () => void;
  returnToApartmentForVitalsFailure: () => void;
  cleanupForTitleReturn: () => void;
}

/** World reset, vitals-lock apartment recovery, dev shortcuts, and teardown. */
export function createWorldLifecycle(
  ctx: LoopContext,
  deps: { deckPhysics: DeckPhysics },
): WorldLifecycle {
  function teleportToSurface(destination: SurfaceDestination): boolean {
    const location = findSurfaceDestination(ctx.planet, ctx.seed, destination);
    if (!location) return false;

    const probe = cartesianFromLatLonAlt(
      location.latRadians,
      location.lonRadians,
      0,
      ctx.planet.radiusMeters,
    );
    if (![probe.x, probe.y, probe.z].every(Number.isFinite)) return false;
    warmRenderableHeightRing(ctx.planet, ctx.seed, probe, 450, 18);
    const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, probe);
    if (
      !Number.isFinite(surface.surfaceRadiusMeters) ||
      !Number.isFinite(surface.heightMeters)
    ) {
      return false;
    }
    const groundPosition = surfacePointFromPosition(
      probe,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    if (![groundPosition.x, groundPosition.y, groundPosition.z].every(Number.isFinite)) {
      return false;
    }
    const character = createCharacterState(groundPosition);
    ctx.world.character = character;
    ctx.world.mode = MODE_ON_FOOT;
    ctx.world.shipExteriorWalk = false;
    ctx.world.activeBedId = null;
    ctx.world.transition = null;
    ctx.world.stationElevator = null;
    ctx.world.screenFade = 0;
    ctx.world.flightMode = 'traverse';
    ctx.world.quantum = createQuantumTravelState();
    ctx.world.cameraOrbit = {
      pitchRadians: -0.12,
      yawRadians: initialCameraYaw(character),
      zoomDistance: 5.2,
    };
    ctx.controls.setMode(MODE_ON_FOOT);
    ctx.controls.setOrbitFacing(
      ctx.world.cameraOrbit.yawRadians,
      ctx.world.cameraOrbit.pitchRadians,
    );
    ctx.planetPhysics?.dispose();
    ctx.planetPhysics = null;
    return true;
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

  function setVitalsSyncLocked(locked: boolean): void {
    ctx.world.vitalsSyncLocked = locked;
    if (!locked && ctx.world.prompt.includes("Vitals sync")) ctx.world.prompt = "";
  }

  function syncApartmentInstanceForVitalsRecovery(): void {
    if (!ctx.bootstrap) return;
    ctx.network?.transition(ctx.bootstrap.spawn.apartmentInstanceId, STATION_SPAWN.roomId);
  }

  function returnToApartmentForVitalsFailure(): void {
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
    deps.deckPhysics.disposeShipDeckPhysics();
    ctx.planetPhysics?.dispose();
    ctx.planetPhysics = null;
    if (ctx.physics) {
      teleportStationPlayer(ctx.physics, ctx.stationFrame, ctx.world.character.position);
    }
    syncApartmentInstanceForVitalsRecovery();
    ctx.stationNpcPopulation.reset(ctx.seed);
    ctx.footsteps.reset();
  }

  function cleanupForTitleReturn(): void {
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    ctx.footsteps.reset();
    deps.deckPhysics.disposeShipDeckPhysics();
    let clearedHangar = false;
    for (const instance of listShipInstances()) {
      const inPrivateHangar =
        ctx.bootstrap !== null && instance.instanceId === ctx.bootstrap.spawn.hangarInstanceId;
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

  // Console-only dev shortcuts (mirrors the __spikeScene diagnostic).
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
    setSsaoSettings: (settings: Partial<SsaoSettings>) => ctx.renderer?.setSsaoSettings(settings),
    setSsaoIntensity: (intensity: number) => ctx.renderer?.setSsaoSettings({ intensity }),
    setSsaoColor: (color: string | null) => ctx.renderer?.setSsaoColor(color),
    getSurfaceSpawnDebug: () => {
      const focus = ctx.world.character.position;
      const layers = ctx.renderer?.getSurfaceSpawnLayers() ?? [];
      const nearby = ctx.renderer?.getNearbySurfaceSpawns(focus, 120) ?? [];
      const wide = ctx.renderer?.getNearbySurfaceSpawns(focus, 5_000) ?? [];
      let minDist = Infinity;
      for (const inst of wide) {
        const dx = inst.position.x - focus.x;
        const dy = inst.position.y - focus.y;
        const dz = inst.position.z - focus.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < minDist) minDist = d;
      }
      return {
        layerCount: layers.length,
        layers: layers.map((layer) => ({
          id: layer.id,
          enabled: layer.enabled,
          assetUrl: layer.assetUrl,
          biomes: layer.biomes,
          minH: layer.minNormalizedHeight,
          maxH: layer.maxNormalizedHeight,
          density: layer.density,
          weight: layer.weight,
          collider: layer.collider,
        })),
        nearbyCount: nearby.length,
        activeColliders: ctx.planetPhysics?.getActiveColliderCount() ?? 0,
        meshCollisionAssets: ctx.renderer?.getSurfaceSpawnMeshCollisions()?.size ?? 0,
        within5km: wide.length,
        minDistMeters: Number.isFinite(minDist) ? Math.round(minDist) : null,
        sample: nearby.slice(0, 3),
        stats: ctx.renderer?.getSurfaceSpawnDebugStats() ?? null,
      };
    },
    teleportToSurface,
  };

  return {
    teleportToSurface,
    resetWorld,
    setVitalsSyncLocked,
    syncApartmentInstanceForVitalsRecovery,
    returnToApartmentForVitalsFailure,
    cleanupForTitleReturn,
  };
}
