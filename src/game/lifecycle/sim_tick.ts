import { MODE_IN_BED, MODE_IN_SHIP, MODE_ON_FOOT } from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { WeaponCombat } from "../combat/weapon_combat";
import type { ShipSystems } from "../ship/systems";
import type { StationAnimations } from "../station/animations";
import type { BuildTool } from "../station/build_tool";
import type { ModeHandlers } from "../modes/dispatch_mode";
import { dispatchMode } from "../modes/dispatch_mode";
import type { CameraState } from "../types";

export interface SimTickDeps {
  combat: WeaponCombat;
  shipSystems: ShipSystems;
  animations: StationAnimations;
  buildTool: BuildTool;
  modes: ModeHandlers;
}

export interface SimTickResult {
  camera: CameraState;
  weaponPoseAiming: boolean;
  /** True when quantum travel owns the frame and render should be skipped. */
  abortFrame: boolean;
}

function controlsModeForWorld(mode: string): typeof MODE_IN_SHIP | typeof MODE_IN_BED | typeof MODE_ON_FOOT {
  if (mode === MODE_IN_SHIP) return MODE_IN_SHIP;
  if (mode === MODE_IN_BED) return MODE_IN_BED;
  return MODE_ON_FOOT;
}

function updatePostModePresentation(
  ctx: LoopContext,
  deps: SimTickDeps,
  dt: number,
): void {
  if (ctx.world.quantum.phase === "traveling") return;
  deps.animations.updateStationAnimations(dt);
  ctx.renderer?.getStationRoot()?.userData.updateParticles?.(dt);
  ctx.renderer?.getStationRoot()?.userData.updateObjectAnimations?.(dt);
  for (const runtime of deps.buildTool.buildRuntimes()) {
    runtime.propRenderer.update(dt);
  }
}

/** Unpaused simulation: input, mode dispatch, combat, station FX, presence. */
export function runSimulationTick(
  ctx: LoopContext,
  deps: SimTickDeps,
  dt: number,
): SimTickResult {
  ctx.controls.setMode(controlsModeForWorld(ctx.world.mode));
  ctx.controls.setCombatInputActive(deps.combat.activeFirearm() !== null);
  const actions = ctx.controls.consumeActions();
  deps.combat.applyWeaponSlotPress(actions.weaponSlotPress);
  ctx.controls.setCombatInputActive(deps.combat.activeFirearm() !== null);
  const camera = ctx.controls.sampleCameraState(dt);
  ctx.world.cameraOrbit = {
    pitchRadians: camera.pitchRadians,
    yawRadians: camera.yawRadians,
    zoomDistance: camera.zoomDistance,
  };
  ctx.world.shipCameraView = camera.shipCameraView;
  ctx.world.shipCameraZoom = camera.shipZoomDistance;

  const characterInput = ctx.controls.sampleCharacterInput();
  const weaponPoseAiming = deps.combat.currentWeaponPoseAiming(characterInput);

  deps.shipSystems.updateShipSystems(dt);
  ctx.stationScreenHeadLook = null;

  if (
    dispatchMode(
      ctx,
      deps.modes,
      characterInput,
      actions,
      camera,
      weaponPoseAiming,
      dt,
    )
  ) {
    return { camera, weaponPoseAiming, abortFrame: true };
  }

  deps.combat.updateWeaponCombat(actions, dt);
  updatePostModePresentation(ctx, deps, dt);
  ctx.network?.publishPresence(ctx.world);
  return { camera, weaponPoseAiming, abortFrame: false };
}
