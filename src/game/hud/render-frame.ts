import {
  MODE_IN_BED,
  MODE_IN_CHAIR,
  MODE_IN_SHIP,
} from "../../player/modes";
import { getActiveShipBody } from "../../player/world-state";
import { sampleRenderablePlanetSurface } from "../../world/planet-surface";
import { atmosphere01FromAltitude } from "../../player/environment-status";
import { updatePlayerVitals } from "../../player/vitals";
import { annotateNpcHeadLookTowardPlayer } from "../../npc/player-gaze";
import { STATION_SOUND_MODES } from "../audio/scene-sounds";
import { buildFrameHud } from "./frame-hud";
import { renderEntertainmentCameraFeel } from "./entertainment-camera-frame";
import {
  buildRendererFrameArgs,
  isWeaponWalkMode,
} from "./renderer-frame-args";
import type { LoopContext } from "../loop-context";
import type { CameraState } from "../types";
import type { SceneSounds } from "../audio/scene-sounds";
import type { Css3dScreens } from "../screens/css3d-screens";
import type { BuildTool } from "../station/build-tool";
import type { WeaponCombat } from "../combat/weapon-combat";
import type { CameraOcclusion } from "../camera/occlusion";
import type { StationLocalPoint } from "../../world/station";

/** Shared empty list so the out-of-station capsule sync allocates nothing. */
const EMPTY_NPC_POSITIONS: readonly StationLocalPoint[] = [];

export interface RenderFrameInput {
  nowMs: number;
  camera: CameraState;
  weaponPoseAiming: boolean;
  frameDt: number;
  dt: number;
  paused: boolean;
}

export interface RenderFrameDeps {
  occlusion: CameraOcclusion;
  sceneSounds: SceneSounds;
  screens: Css3dScreens;
  combat: WeaponCombat;
  buildTool: BuildTool;
}

function updateSurvivalAndVitals(
  ctx: LoopContext,
  input: RenderFrameInput,
  focusSurface: ReturnType<typeof sampleRenderablePlanetSurface>,
): void {
  const sprinting =
    !input.paused &&
    Boolean(ctx.controls.sampleCharacterInput().sprint) &&
    isWeaponWalkMode(ctx.world.mode);
  const survivalVitals = ctx.vitalsSession?.update(input.nowMs, sprinting);
  if (survivalVitals) {
    ctx.world.vitals.hungerReserve01 = survivalVitals.hungerReserve01;
    ctx.world.vitals.thirstReserve01 = survivalVitals.thirstReserve01;
    ctx.world.vitals.healthReserve01 = survivalVitals.healthReserve01;
  }

  if (input.dt <= 0) return;
  const atmosphere01 = atmosphere01FromAltitude(
    focusSurface.altitudeMeters,
    ctx.planet.atmosphereHeightMeters,
  );
  ctx.world.vitals = updatePlayerVitals(ctx.world.vitals, input.dt, {
    grounded: ctx.world.character.grounded,
    sprinting,
    altitudeMeters: focusSurface.altitudeMeters,
    atmosphere01,
    timeSeconds: input.nowMs / 1000,
  });
}

function resolveFocus(
  ctx: LoopContext,
  activeShip: ReturnType<typeof getActiveShipBody>,
) {
  const focusUsesShip =
    ctx.world.mode === MODE_IN_SHIP ||
    ctx.world.mode === MODE_IN_BED ||
    (ctx.world.mode === MODE_IN_CHAIR &&
      ctx.world.chairOccupancy?.surface === "ship");
  const shipSurface = sampleRenderablePlanetSurface(
    ctx.planet,
    ctx.seed,
    activeShip.position,
  );
  return {
    shipSurface,
    focusPosition: focusUsesShip
      ? activeShip.position
      : ctx.world.character.position,
    focusVelocity: focusUsesShip
      ? activeShip.velocity
      : ctx.world.character.velocity,
    focusSurface: focusUsesShip
      ? shipSurface
      : sampleRenderablePlanetSurface(
          ctx.planet,
          ctx.seed,
          ctx.world.character.position,
        ),
  };
}

/** NPC/station update, WebGL render, CSS3D screens, HUD, and vitals for one frame. */
export function renderFrame(
  ctx: LoopContext,
  deps: RenderFrameDeps,
  input: RenderFrameInput,
): void {
  const { nowMs, camera, weaponPoseAiming, frameDt, dt, paused } = input;
  const inStation = STATION_SOUND_MODES.has(ctx.world.mode);
  ctx.stationNpcPopulation.update(inStation ? dt : 0);
  const stationNpcRenderStates = inStation
    ? ctx.stationNpcPopulation.getRenderStates()
    : [];
  // Park the kinematic capsules on the actors so the player's controller can
  // slide along them. Outside the station the pool goes inert instead: the
  // Rapier world is station-local, so stale capsules would sit in the walkable
  // volume the player returns to.
  ctx.physics?.npcBodies.sync(
    inStation ? ctx.stationNpcPopulation.getLocalPositions() : EMPTY_NPC_POSITIONS,
  );
  annotateNpcHeadLookTowardPlayer(
    stationNpcRenderStates,
    ctx.world.character.position,
    ctx.world.character.up,
  );
  const remoteEntities = ctx.network?.getRemoteEntities(nowMs) ?? [];
  const activeShip = getActiveShipBody(ctx.world);
  const focus = resolveFocus(ctx, activeShip);
  const entertainmentCameraFeelFrame = renderEntertainmentCameraFeel(
    ctx,
    frameDt,
    activeShip,
  );
  const { args } = buildRendererFrameArgs(ctx, {
    occlusion: deps.occlusion,
    camera,
    weaponPoseAiming,
    entertainmentCameraFeel: entertainmentCameraFeelFrame,
    nowMs,
    remoteEntities,
    stationNpcRenderStates,
  });

  let renderStats = null;
  try {
    renderStats = ctx.renderer?.render(args) ?? null;
  } catch (error) {
    console.error("ClaudeCitizen render frame failed.", error);
    ctx.frameRendererError = error;
  }
  window.__claudecitizenRenderStats = renderStats;
  window.__claudecitizenWorld = ctx.world;
  deps.sceneSounds.updateSceneSounds(
    focus.focusPosition,
    stationNpcRenderStates,
    remoteEntities,
    dt,
  );
  deps.screens.renderAfterWebGl();

  const { flightDual, cockpitGaze, cockpitSpeed } = buildFrameHud(ctx, {
    camera,
    activeShip,
  });
  updateSurvivalAndVitals(ctx, input, focus.focusSurface);

  ctx.onHudUpdate({
    world: ctx.world,
    focusSurface: focus.focusSurface,
    focusVelocity: focus.focusVelocity,
    shipSurface: focus.shipSurface,
    renderStats: renderStats ?? null,
    rendererError: ctx.frameRendererError,
    rendererMode: ctx.renderer?.rendererMode,
    planet: ctx.planet,
    isPointerLocked: ctx.controls.isPointerLocked(),
    nowMs,
    weaponCrosshairVisible:
      !paused &&
      ctx.activeWeaponSlotId !== null &&
      isWeaponWalkMode(ctx.world.mode),
    weaponCrosshair: paused ? undefined : deps.combat.currentCrosshairState(),
    combatAmmo: paused ? null : deps.combat.currentCombatAmmoHud(),
    flightDual,
    cockpitGaze,
    cockpitSpeed,
  });
  deps.buildTool.updateBuildBtnVisibility();
}
