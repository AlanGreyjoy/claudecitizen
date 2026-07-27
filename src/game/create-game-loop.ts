import { createLoopContext } from "./loop-context";
import { createSceneSounds } from "./audio/scene-sounds";
import { createPrompts } from "./station/prompts";
import { createDeckPhysics } from "./ship/deck-physics";
import { createStationAnimations } from "./station/animations";
import { createCameraOcclusion } from "./camera/occlusion";
import { createScreens } from "./screens/css3d-screens";
import { createEquippedInventory } from "./inventory/equipped";
import { createWeaponCombat } from "./combat/weapon-combat";
import { createShipSystems } from "./ship/systems";
import { createPadInterest } from "./station/pad-interest";
import { createBuildTool } from "./station/build-tool";
import { createWorldLifecycle } from "./lifecycle/world-reset";
import { renderFrame } from "./hud/render-frame";
import { runSimulationTick } from "./lifecycle/sim-tick";
import { createTransitions } from "./modes/transitions";
import { createOnFootMode } from "./modes/on-foot";
import { createInShipMode } from "./modes/in-ship";
import { createInBedMode } from "./modes/in-bed";
import { createOnShipDeckMode } from "./modes/on-ship-deck";
import { createInStationMode } from "./modes/in-station";
import type { GameLoopHandle, GameLoopOptions } from "./types";

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

  const prompts = createPrompts(ctx);
  const deckPhysics = createDeckPhysics(ctx);
  const animations = createStationAnimations(ctx);
  const sceneSounds = createSceneSounds(ctx);
  const occlusion = createCameraOcclusion(ctx);
  const screens = createScreens(ctx);
  const inventory = createEquippedInventory(ctx);

  const combat = createWeaponCombat(ctx, { inventory });
  const shipSystems = createShipSystems(ctx, { prompts });
  const padInterest = createPadInterest(ctx, { deckPhysics });
  const buildTool = createBuildTool(ctx);
  const lifecycle = createWorldLifecycle(ctx, { deckPhysics });

  const transitions = createTransitions(ctx, { deckPhysics, padInterest });
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
  const modes = {
    onFoot,
    inShip,
    inBed,
    onShipDeck,
    inStation,
    transitions,
  };
  const renderDeps = { occlusion, sceneSounds, screens, combat, buildTool };
  const simDeps = { combat, shipSystems, animations, buildTool, modes };

  if (ctx.content.ship) void deckPhysics.warmShipDeckPhysics();
  animations.updateStationAnimations(0);
  ctx.controls.setOrbitFacing(
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );

  function frame(nowMs: number): void {
    if (!ctx.running) return;

    const paused = ctx.isPaused?.() ?? false;
    const frameDt = Math.min((nowMs - ctx.lastMs) / 1000, 1 / 30);
    const dt = paused ? 0 : frameDt;
    ctx.lastMs = nowMs;

    if (paused) {
      ctx.boostSfx.stop();
      ctx.thrustSfx.stop();
      ctx.controls.setCombatInputActive(false);
    }

    let camera = ctx.controls.sampleCameraState(0);
    let weaponPoseAiming = false;

    if (!paused) {
      const tick = runSimulationTick(ctx, simDeps, dt);
      camera = tick.camera;
      weaponPoseAiming = tick.weaponPoseAiming;
      if (tick.abortFrame) return;
    }

    renderFrame(ctx, renderDeps, {
      nowMs,
      camera,
      weaponPoseAiming,
      frameDt,
      dt,
      paused,
    });

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
