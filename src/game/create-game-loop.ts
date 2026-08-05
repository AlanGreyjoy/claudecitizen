import { createLoopContext } from "./loop-context";
import { stopAllGunshotVoices } from "../audio/gunshots";
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
import { createInChairMode } from "./modes/in-chair";
import { createOnShipDeckMode } from "./modes/on-ship-deck";
import { createInStationMode } from "./modes/in-station";
import type { GameLoopHandle, GameLoopOptions } from "./types";
import type { LoopContext } from "./loop-context";
import {
  recordFrameStart,
  recordRenderMs,
  recordSimMs,
} from "../render/main/frame-timing";
import { reportHandledError } from "../telemetry";

/** Console spam guard; the telemetry sink dedups by error signature already. */
const MAX_LOGGED_FRAME_ERRORS = 3;
let loggedFrameErrors = 0;

export type {
  BuildAreaRuntime,
  BuildRuntime,
  GameLoopOptions,
  WeaponCombatRuntimeEvent,
} from "./types";

/**
 * Records a frame that threw, so the loop can survive it.
 *
 * Re-arming `requestAnimationFrame` is the only thing keeping the game alive,
 * and it used to sit downstream of every piece of per-frame work: an exception
 * in the sim tick or the render frame escaped before the next frame was
 * scheduled and the loop stopped for good — a window that draws its last frame
 * forever and answers no input, which reads as a hard lock-up and clears only
 * by force-quitting the app.
 *
 * A cold arrival (quantum drop-out over a surface site, a scene swap) is both
 * where a one-off throw is most likely and where losing the loop is least
 * recoverable. Report it and keep drawing: a visibly broken frame can be
 * diagnosed, a dead process cannot.
 */
function reportFrameFailure(ctx: LoopContext, error: unknown): void {
  loggedFrameErrors += 1;
  if (loggedFrameErrors <= MAX_LOGGED_FRAME_ERRORS) {
    console.error(
      `ClaudeCitizen game frame failed (mode=${ctx.world.mode},`
      + ` quantum=${ctx.world.quantum.phase}):`,
      error,
    );
  }
  reportHandledError("game-loop.frame", error);
}

/** Engine audio and combat input do not carry across a paused frame. */
function quietPausedFrame(ctx: LoopContext): void {
  ctx.boostSfx.stop();
  ctx.thrustSfx.stop();
  ctx.controls.setCombatInputActive(false);
}

function closeGameLoopOverlays(ctx: LoopContext): void {
  ctx.entertainmentSystem?.close();
  ctx.weaponShop?.close();
  ctx.outfitters?.close();
  ctx.foodShop?.close();
  ctx.personalInventory?.close();
  ctx.chestStorage?.close();
}

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
  const modeShared = { combat, padInterest, shipSystems };
  const modes = {
    onFoot: createOnFootMode(ctx, modeShared),
    inShip: createInShipMode(ctx, { prompts }),
    inBed: createInBedMode(ctx, { prompts }),
    inChair: createInChairMode(ctx, { prompts }),
    onShipDeck: createOnShipDeckMode(ctx, { ...modeShared, prompts }),
    inStation: createInStationMode(ctx, {
      ...modeShared,
      prompts,
      animations,
      buildTool,
    }),
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

  let lastWeaponPoseAiming = false;
  let lastUnpausedNowMs = 0;

  /** True when the frame ends the loop on purpose: planet handoff or scene swap. */
  function runFrame(nowMs: number): boolean {
    recordFrameStart(performance.now());
    const paused = ctx.isPaused?.() ?? false;
    const frameDt = Math.min((nowMs - ctx.lastMs) / 1000, 1 / 30);
    const dt = paused ? 0 : frameDt;
    ctx.lastMs = nowMs;

    if (paused) quietPausedFrame(ctx);
    else lastUnpausedNowMs = nowMs;

    let camera = ctx.controls.sampleCameraState(0);
    // Keep last ADS state while paused so orbit zoom does not ease out on Esc.
    let weaponPoseAiming = lastWeaponPoseAiming;

    if (!paused) {
      const simStart = performance.now();
      const tick = runSimulationTick(ctx, simDeps, dt);
      recordSimMs(performance.now() - simStart);
      camera = tick.camera;
      weaponPoseAiming = tick.weaponPoseAiming;
      lastWeaponPoseAiming = weaponPoseAiming;
      if (tick.abortFrame) return true;
    }

    // Freeze render clock while paused so camera smooth / ADS zoom stay put.
    const renderNowMs = paused && lastUnpausedNowMs > 0 ? lastUnpausedNowMs : nowMs;
    const renderStart = performance.now();
    renderFrame(ctx, renderDeps, {
      nowMs: renderNowMs,
      camera,
      weaponPoseAiming,
      frameDt: dt,
      dt,
      paused,
    });
    recordRenderMs(performance.now() - renderStart);
    return false;
  }

  function frame(nowMs: number): void {
    if (!ctx.running) return;
    let ended = false;
    // See `reportFrameFailure`: never let a throw take the rAF chain with it.
    try {
      ended = runFrame(nowMs);
    } catch (error) {
      reportFrameFailure(ctx, error);
    }
    if (!ended) requestAnimationFrame(frame);
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
    closeGameLoopOverlays(ctx);
    buildTool.detachBuildButton();
    screens.dispose();
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    deckPhysics.disposeShipDeckPhysics();
    ctx.planetPhysics?.dispose();
    ctx.planetPhysics = null;
    ctx.soundScene.dispose();
    ctx.footsteps.dispose();
    stopAllGunshotVoices();
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
