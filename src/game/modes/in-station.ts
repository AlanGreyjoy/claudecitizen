import {
  updateCharacterClimbingInStation,
  updateCharacterInStation,
  type StationCharacterState,
} from "../../player/station-walk";
import { findLadderById } from "../../world/ladders";
import { getStationLayoutOverride } from "../../world/station";
import type { LoopContext } from "../loop-context";
import type { WeaponCombat } from "../combat/weapon-combat";
import type { PadInterest } from "../station/pad-interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";
import type { StationAnimations } from "../station/animations";
import type { BuildTool } from "../station/build-tool";
import { handleStationVendors } from "../station/vendors";
import { handleStationInteraction } from "../station/interactions";
import type { BuildAreaRuntime, WalkModeInput } from "../types";

export interface InStationMode {
  updateInStationMode: (input: WalkModeInput) => void;
}

interface InStationDeps {
  combat: WeaponCombat;
  padInterest: PadInterest;
  shipSystems: ShipSystems;
  prompts: Prompts;
  animations: StationAnimations;
  buildTool: BuildTool;
}

function walkInStation(
  ctx: LoopContext,
  combat: WeaponCombat,
  input: WalkModeInput,
): void {
  ctx.world.character = updateCharacterInStation(
    ctx.world.character as StationCharacterState,
    ctx.stationFrame,
    { ...input.characterInput, jumpPressed: input.actions.jumpPressed },
    input.dt,
    ctx.planet.gravityMetersPerSecond2 ?? 9.8,
    ctx.physics,
    combat.currentAnimStance(),
    combat.currentWeaponPoseAiming(input.characterInput),
  );
}

/**
 * Ladder climbing replaces station locomotion while attached. Returns false
 * when the player is not on a ladder so the caller falls through to walking.
 */
function climbStationLadder(
  ctx: LoopContext,
  deps: InStationDeps,
  input: WalkModeInput,
): boolean {
  const climb = ctx.world.ladderClimb;
  if (!climb || climb.surface !== "station") return false;
  const ladder = findLadderById(
    getStationLayoutOverride()?.ladders ?? [],
    climb.ladderId,
  );
  if (!ladder) {
    ctx.world.ladderClimb = null;
    return false;
  }
  // Jump lets go anywhere on the rail — the fall is the dismount.
  if (input.actions.jumpPressed) {
    ctx.world.ladderClimb = null;
    return false;
  }

  const result = updateCharacterClimbingInStation(
    ctx.world.character as StationCharacterState,
    ctx.stationFrame,
    ladder,
    input.characterInput,
    input.dt,
    ctx.physics,
  );
  ctx.world.character = result.state;
  if (result.exit === "none") {
    climb.along = result.along;
    ctx.world.prompt = `Forward / back to climb · ${deps.prompts.keyLabel("jump")} to let go`;
    return true;
  }
  ctx.world.ladderClimb = null;
  ctx.world.prompt = "";
  return true;
}

function handleActiveBuildTool(
  ctx: LoopContext,
  deps: InStationDeps,
  activeRuntime: BuildAreaRuntime,
  input: WalkModeInput,
): void {
  const { keyLabel } = deps.prompts;
  const { actions } = input;
  walkInStation(ctx, deps.combat, input);
  deps.buildTool.updateBuildTool(activeRuntime);
  const tool = activeRuntime.controller.getContext().toolMode;
  ctx.world.prompt =
    tool === "place"
      ? `Click to place · ${keyLabel("hangarRotate")} rotate · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
      : tool === "move"
        ? `Click prop, move, click confirm · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
        : `Click prop to pick up · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`;
  if (actions.hangarBuildPressed) ctx.build?.terminal.open(activeRuntime.controller);
  if (actions.hangarRotatePressed) {
    activeRuntime.controller.rotateGhost(Math.PI / 12);
    const ghost = activeRuntime.controller.getContext().ghost;
    if (ghost) activeRuntime.propRenderer.updateGhostTransform(ghost);
  }
  if (actions.hangarCancelPressed) {
    activeRuntime.controller.cancelTool();
    void deps.buildTool.syncBuildPropsVisuals(activeRuntime);
  }
}

/** Station walking: build tool, vendor screens, terminals, and scene exits. */
export function createInStationMode(
  ctx: LoopContext,
  deps: InStationDeps,
): InStationMode {
  function updateInStationMode(input: WalkModeInput): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();

    const activeRuntime = deps.buildTool.activeBuildRuntime();
    if (activeRuntime) {
      handleActiveBuildTool(ctx, deps, activeRuntime, input);
      return;
    }

    if (climbStationLadder(ctx, deps, input)) return;

    walkInStation(ctx, deps.combat, input);

    if (deps.padInterest.tryEnterShipPadInterest()) return;

    const boardPrompt = deps.shipSystems.handleBoardExterior(
      input.actions.interactPressed,
    );
    if (boardPrompt !== null) {
      ctx.world.prompt = boardPrompt;
      return;
    }

    const rampPrompt = deps.shipSystems.handleRampOutside(input.actions.interactPressed);
    if (rampPrompt !== null) {
      ctx.world.prompt = rampPrompt;
      return;
    }

    if (handleStationVendors(ctx, input.actions, deps.prompts.pressInteractPrompt)) {
      return;
    }

    handleStationInteraction(ctx, input.actions, {
      buildTool: deps.buildTool,
      animations: deps.animations,
      pressInteractPrompt: deps.prompts.pressInteractPrompt,
    });
  }

  return { updateInStationMode };
}
