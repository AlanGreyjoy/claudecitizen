import {
  MODE_IN_BED,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from "../player/modes";
import {
  getActiveShipBody,
  getActiveShipRig,
} from "../player/world_state";
import { listShipInstances } from "../flight/ship_world";
import { doorBlends } from "../player/ship_rig";
import { getShipLayout } from "../player/ship_layout";
import { getBedEyeLocal, localOffsetToWorld } from "../player/ship_interaction";
import { resolveSeatLookForward } from "../flight/flight_aim";
import { resolveEntertainmentGazeTarget } from "../player/entertainment_gaze";
import {
  updateEntertainmentCameraFeel,
  type EntertainmentCameraFeel,
} from "../player/entertainment_camera";
import { sampleRenderablePlanetSurface } from "../world/planet_surface";
import { atmosphere01FromAltitude } from "../player/environment_status";
import { updatePlayerVitals } from "../player/vitals";
import { annotateNpcHeadLookTowardPlayer } from "../npc/player_gaze";
import { createLoopContext } from "./loop_context";
import { STATION_SOUND_MODES, createSceneSounds } from "./audio/scene_sounds";
import { createPrompts } from "./station/prompts";
import { createDeckPhysics } from "./ship/deck_physics";
import { createStationAnimations } from "./station/animations";
import { createCameraOcclusion } from "./camera/occlusion";
import { createScreens } from "./screens/css3d_screens";
import { createEquippedInventory } from "./inventory/equipped";
import { createWeaponCombat } from "./combat/weapon_combat";
import { createShipSystems } from "./ship/systems";
import { createPadInterest } from "./station/pad_interest";
import { createBuildTool } from "./station/build_tool";
import { createWorldLifecycle } from "./lifecycle/world_reset";
import { buildFrameHud } from "./hud/frame_hud";
import { createTransitions } from "./modes/transitions";
import { createOnFootMode } from "./modes/on_foot";
import { createInShipMode } from "./modes/in_ship";
import { createInBedMode } from "./modes/in_bed";
import { createOnShipDeckMode } from "./modes/on_ship_deck";
import { createInStationMode } from "./modes/in_station";
import { createElevatorMode } from "./modes/elevator";
import type {
  CameraState,
  CharacterInput,
  FrameActions,
  GameLoopHandle,
  GameLoopOptions,
} from "./types";

export type {
  BuildAreaRuntime,
  BuildRuntime,
  GameLoopOptions,
  WeaponCombatRuntimeEvent,
} from "./types";

/**
 * Assembles the play-session game loop from colocated feature modules. The
 * mutable {@link LoopContext} is the shared state bag; each feature factory
 * returns the methods the monolithic loop once nested. `frame()` stays a thin
 * dispatcher that runs the active mode, then render / HUD / vitals / presence.
 */
export function createGameLoop(options: GameLoopOptions): GameLoopHandle {
  const ctx = createLoopContext(options);

  // Leaf features (state only).
  const prompts = createPrompts(ctx);
  const deckPhysics = createDeckPhysics(ctx);
  const animations = createStationAnimations(ctx);
  const sceneSounds = createSceneSounds(ctx);
  const occlusion = createCameraOcclusion(ctx);
  const screens = createScreens(ctx);
  const inventory = createEquippedInventory(ctx);

  // Mid features.
  const combat = createWeaponCombat(ctx, { inventory });
  const shipSystems = createShipSystems(ctx, { prompts });
  const padInterest = createPadInterest(ctx, { deckPhysics });
  const buildTool = createBuildTool(ctx);
  const lifecycle = createWorldLifecycle(ctx, { deckPhysics });

  // Modes.
  const transitions = createTransitions(ctx, { deckPhysics });
  const onFoot = createOnFootMode(ctx, { combat, padInterest, shipSystems });
  const inShip = createInShipMode(ctx, { prompts });
  const inBed = createInBedMode(ctx, { prompts });
  const onShipDeck = createOnShipDeckMode(ctx, {
    combat,
    padInterest,
    shipSystems,
    prompts,
  });
  const inStation = createInStationMode(ctx, {
    combat,
    padInterest,
    shipSystems,
    prompts,
    animations,
    buildTool,
  });
  const elevator = createElevatorMode(ctx);

  // Construction side-effects (match the monolith's init order).
  void deckPhysics.warmShipDeckPhysics();
  animations.updateStationAnimations(0);
  ctx.controls.setOrbitFacing(
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );

  function dispatchMode(
    characterInput: CharacterInput,
    actions: FrameActions,
    camera: CameraState,
    weaponPoseAiming: boolean,
    dt: number,
  ): boolean {
    if (ctx.world.mode === MODE_ON_FOOT) {
      onFoot.updateOnFootMode({ characterInput, actions, dt }, weaponPoseAiming);
    } else if (ctx.world.mode === MODE_IN_SHIP) {
      if (inShip.updateInShipMode({ actions, camera, dt })) return true;
    } else if (ctx.world.mode === MODE_IN_BED) {
      inBed.updateInBedMode(actions);
    } else if (ctx.world.mode === MODE_ON_SHIP_DECK) {
      onShipDeck.updateOnShipDeckMode({ characterInput, actions, dt });
    } else if (ctx.world.mode === MODE_IN_STATION) {
      inStation.updateInStationMode({ characterInput, actions, dt });
    } else if (ctx.world.mode === MODE_RIDING_ELEVATOR) {
      elevator.updateElevatorMode(dt);
    } else {
      transitions.updateTransitionMode(dt);
    }
    return false;
  }

  function renderEntertainmentCameraFeel(
    frameDt: number,
    activeShip: ReturnType<typeof getActiveShipBody>,
  ): EntertainmentCameraFeel | null {
    // SC-style bunk screen zoom — ease even while ES UI pauses the sim.
    if (ctx.world.mode === MODE_IN_BED || ctx.entertainmentSystem?.isOpen()) {
      const layout = getShipLayout();
      const systems = layout.entertainmentSystems;
      if (systems.length > 0) {
        const eyeLocal = getBedEyeLocal(ctx.world.activeBedId) ?? layout.pilotEye;
        const eye = localOffsetToWorld(activeShip, eyeLocal);
        const seat = ctx.controls.getSeatLook();
        const view = resolveSeatLookForward(
          activeShip.forward,
          activeShip.up,
          seat.yawRadians,
          seat.pitchRadians,
        );
        const esHit = resolveEntertainmentGazeTarget(
          systems,
          activeShip,
          eye,
          view.forward,
        );
        const screenSpec = esHit?.system ?? systems[0]!;
        const screen = localOffsetToWorld(activeShip, screenSpec.position);
        return updateEntertainmentCameraFeel(ctx.esCameraState, {
          dt: frameDt,
          open: ctx.entertainmentSystem?.isOpen() ?? false,
          gazing: Boolean(esHit),
          eye,
          screen,
          viewForward: view.forward,
        });
      }
    } else if (ctx.esCameraState.focus01 > 0) {
      ctx.esCameraState.focus01 = 0;
    }
    return null;
  }

  function renderFrame(frame: {
    nowMs: number;
    camera: CameraState;
    weaponPoseAiming: boolean;
    frameDt: number;
    dt: number;
    paused: boolean;
  }): void {
    const { nowMs, camera, weaponPoseAiming, frameDt, dt, paused } = frame;
    ctx.stationNpcPopulation.update(STATION_SOUND_MODES.has(ctx.world.mode) ? dt : 0);
    const stationNpcRenderStates = STATION_SOUND_MODES.has(ctx.world.mode)
      ? annotateNpcHeadLookTowardPlayer(
          ctx.stationNpcPopulation.getRenderStates(),
          ctx.world.character.position,
          ctx.world.character.up,
        )
      : [];
    const remoteEntities = ctx.network?.getRemoteEntities(nowMs) ?? [];

    const activeShip = getActiveShipBody(ctx.world);
    const focusUsesShip =
      ctx.world.mode === MODE_IN_SHIP || ctx.world.mode === MODE_IN_BED;
    const shipSurface = sampleRenderablePlanetSurface(
      ctx.planet,
      ctx.seed,
      activeShip.position,
    );
    const focusPosition = focusUsesShip
      ? activeShip.position
      : ctx.world.character.position;
    const focusVelocity = focusUsesShip
      ? activeShip.velocity
      : ctx.world.character.velocity;
    const focusSurface = focusUsesShip
      ? shipSurface
      : sampleRenderablePlanetSurface(ctx.planet, ctx.seed, focusPosition);

    const entertainmentCameraFeelFrame = renderEntertainmentCameraFeel(
      frameDt,
      activeShip,
    );

    let renderStats = null;
    try {
      renderStats =
        ctx.renderer?.render({
          cameraOrbit: ctx.world.cameraOrbit,
          shipCameraView: ctx.world.shipCameraView,
          shipCameraZoom: ctx.world.shipCameraZoom,
          seatLook: camera.seatLook,
          flightCameraFeel: ctx.flightCameraFeelFrame ?? undefined,
          entertainmentCameraFeel: entertainmentCameraFeelFrame ?? undefined,
          activeBedId: ctx.world.activeBedId,
          character:
            ctx.world.mode === MODE_IN_SHIP || ctx.world.mode === MODE_IN_BED
              ? null
              : {
                  animation: ctx.world.character.animation,
                  upperBodyAnimation: ctx.world.character.upperBodyAnimation ?? null,
                  forward: ctx.world.character.forward,
                  position: ctx.world.character.position,
                  up: ctx.world.character.up,
                },
          weaponAimActive:
            weaponPoseAiming &&
            (ctx.world.mode === MODE_ON_FOOT ||
              ctx.world.mode === MODE_ON_SHIP_DECK ||
              ctx.world.mode === MODE_IN_STATION),
          characterHeadLook: ctx.stationScreenHeadLook,
          mode: ctx.world.mode,
          shipExteriorWalk: ctx.world.shipExteriorWalk,
          prompt: ctx.world.prompt,
          ship: activeShip,
          activeShipId: ctx.world.activeShipId,
          ships: listShipInstances().map((instance) => ({
            id: instance.id,
            prefabId: instance.prefabId,
            body: instance.body,
            rig: {
              gear01: instance.rig.gear01,
              ramp01: instance.rig.ramp01,
              doors: doorBlends(instance.rig),
            },
            vitals: { ...instance.vitals },
            spec: {
              maxHp: instance.spec.maxHp,
              maxShields: instance.spec.maxShields,
            },
          })),
          shipRig: {
            gear01: getActiveShipRig(ctx.world).gear01,
            ramp01: getActiveShipRig(ctx.world).ramp01,
            doors: doorBlends(getActiveShipRig(ctx.world)),
          },
          networkEntities: remoteEntities,
          stationNpcs: stationNpcRenderStates,
          shipZoneId: ctx.world.character.deckZone ?? null,
          stationRoomId: ctx.world.character.stationRoomId ?? null,
          cameraOcclusion: occlusion.resolveCameraOcclusion,
          timeSeconds: nowMs / 1000,
          flightMode: ctx.world.flightMode,
          quantum: ctx.world.quantum,
        }) ?? null;
    } catch (error) {
      console.error("ClaudeCitizen render frame failed.", error);
      ctx.frameRendererError = error;
    }
    window.__claudecitizenRenderStats = renderStats;
    window.__claudecitizenWorld = ctx.world;
    sceneSounds.updateSceneSounds(focusPosition, stationNpcRenderStates, remoteEntities, dt);

    screens.renderAfterWebGl();

    const { flightDual, cockpitGaze, cockpitSpeed } = buildFrameHud(ctx, {
      camera,
      activeShip,
    });

    const sprinting =
      !paused &&
      Boolean(ctx.controls.sampleCharacterInput().sprint) &&
      (ctx.world.mode === MODE_ON_FOOT ||
        ctx.world.mode === MODE_ON_SHIP_DECK ||
        ctx.world.mode === MODE_IN_STATION);
    const survivalVitals = ctx.vitalsSession?.update(nowMs, sprinting);
    if (survivalVitals) {
      ctx.world.vitals.hungerReserve01 = survivalVitals.hungerReserve01;
      ctx.world.vitals.thirstReserve01 = survivalVitals.thirstReserve01;
    }

    if (dt > 0) {
      const atmosphere01 = atmosphere01FromAltitude(
        focusSurface.altitudeMeters,
        ctx.planet.atmosphereHeightMeters,
      );
      ctx.world.vitals = updatePlayerVitals(ctx.world.vitals, dt, {
        grounded: ctx.world.character.grounded,
        sprinting,
        altitudeMeters: focusSurface.altitudeMeters,
        atmosphere01,
        timeSeconds: nowMs / 1000,
      });
    }

    ctx.onHudUpdate({
      world: ctx.world,
      focusSurface,
      focusVelocity,
      shipSurface,
      renderStats: renderStats ?? null,
      rendererError: ctx.frameRendererError,
      rendererMode: ctx.renderer?.rendererMode,
      planet: ctx.planet,
      isPointerLocked: ctx.controls.isPointerLocked(),
      nowMs,
      weaponCrosshairVisible:
        !paused &&
        ctx.activeWeaponSlotId !== null &&
        (ctx.world.mode === MODE_ON_FOOT ||
          ctx.world.mode === MODE_ON_SHIP_DECK ||
          ctx.world.mode === MODE_IN_STATION),
      combatAmmo: paused ? null : combat.currentCombatAmmoHud(),
      flightDual,
      cockpitGaze,
      cockpitSpeed,
    });
    buildTool.updateBuildBtnVisibility();
  }

  function frame(nowMs: number): void {
    if (!ctx.running) return;

    const paused = ctx.isPaused?.() ?? false;
    const frameDt = Math.min((nowMs - ctx.lastMs) / 1000, 1 / 30);
    const dt = paused ? 0 : frameDt;
    let weaponPoseAiming = false;
    ctx.lastMs = nowMs;

    if (paused) {
      ctx.boostSfx.stop();
      ctx.thrustSfx.stop();
      ctx.controls.setCombatInputActive(false);
    }

    let camera = ctx.controls.sampleCameraState(0);

    if (!paused) {
      ctx.controls.setMode(
        ctx.world.mode === MODE_IN_SHIP
          ? MODE_IN_SHIP
          : ctx.world.mode === MODE_IN_BED
            ? MODE_IN_BED
            : MODE_ON_FOOT,
      );
      ctx.controls.setCombatInputActive(combat.activeFirearm() !== null);
      const actions = ctx.controls.consumeActions();
      combat.applyWeaponSlotPress(actions.weaponSlotPress);
      ctx.controls.setCombatInputActive(combat.activeFirearm() !== null);
      camera = ctx.controls.sampleCameraState(dt);
      ctx.world.cameraOrbit = {
        pitchRadians: camera.pitchRadians,
        yawRadians: camera.yawRadians,
        zoomDistance: camera.zoomDistance,
      };
      ctx.world.shipCameraView = camera.shipCameraView;
      ctx.world.shipCameraZoom = camera.shipZoomDistance;

      const characterInput = ctx.controls.sampleCharacterInput();
      weaponPoseAiming = combat.currentWeaponPoseAiming(characterInput);

      shipSystems.updateShipSystems(dt);
      ctx.stationScreenHeadLook = null;

      if (dispatchMode(characterInput, actions, camera, weaponPoseAiming, dt)) {
        return;
      }

      combat.updateWeaponCombat(actions, dt);

      if (ctx.world.quantum.phase !== "traveling") {
        animations.updateStationAnimations(dt);
        ctx.renderer?.getStationRoot()?.userData.updateParticles?.(dt);
        ctx.renderer?.getStationRoot()?.userData.updateObjectAnimations?.(dt);
        for (const runtime of buildTool.buildRuntimes()) {
          runtime.propRenderer.update(dt);
        }
      }
      ctx.network?.publishPresence(ctx.world);
    }

    renderFrame({ nowMs, camera, weaponPoseAiming, frameDt, dt, paused });

    requestAnimationFrame(frame);
  }

  function start(): void {
    if (ctx.running) return;
    ctx.running = true;
    inventory.syncEquippedInventory();
    requestAnimationFrame((now) => {
      ctx.lastMs = now;
      requestAnimationFrame(frame);
    });
  }

  function stop(): void {
    ctx.running = false;
    ctx.entertainmentSystem?.close();
    ctx.weaponShop?.close();
    ctx.outfitters?.close();
    ctx.foodShop?.close();
    ctx.personalInventory?.close();
    buildTool.detachBuildButton();
    screens.dispose();
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    deckPhysics.disposeShipDeckPhysics();
    ctx.planetPhysics?.dispose();
    ctx.planetPhysics = null;
    ctx.soundScene.dispose();
    ctx.footsteps.dispose();
    ctx.renderer?.getStationRoot()?.userData.disposeParticleSystems?.();
  }

  return {
    cleanupForTitleReturn: lifecycle.cleanupForTitleReturn,
    resetWorld: lifecycle.resetWorld,
    returnToApartmentForVitalsFailure: lifecycle.returnToApartmentForVitalsFailure,
    setEquippedLoadout: inventory.setEquippedLoadout,
    setVitalsSyncLocked: lifecycle.setVitalsSyncLocked,
    syncApartmentInstanceForVitalsRecovery: lifecycle.syncApartmentInstanceForVitalsRecovery,
    start,
    stop,
    teleportToSurface: lifecycle.teleportToSurface,
  };
}
