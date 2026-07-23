import type { JumpPhase } from "../../types";
import {
  animationLayersFromState,
  type WalkGait,
} from "../../player/character_locomotion";
import {
  stanceIdForWeaponSlot,
  type WeaponSelectSlotId,
} from "../../player/inventory/weapon_select";
import type { AnimationLocomotionKind } from "../../player/animation/schema";
import type { SidekickAnimationRuntime } from "../characters/sidekick/animation_runtime";

export function resolvePlayTestPreviewLocomotion(args: {
  stanceId: ReturnType<typeof stanceIdForWeaponSlot>;
  playTestHardAim: boolean;
  locomotion?: { isMoving?: boolean; gait?: WalkGait; jumpPhase?: JumpPhase };
}): AnimationLocomotionKind {
  const { stanceId, playTestHardAim, locomotion } = args;
  if (locomotion?.jumpPhase && locomotion.jumpPhase !== "grounded") {
    return locomotion.jumpPhase.replace("-", "_") as AnimationLocomotionKind;
  }
  if (stanceId === "rifle" && playTestHardAim && !locomotion?.isMoving) {
    return "idle_aiming";
  }
  if (locomotion?.isMoving) {
    if (locomotion.gait === "sprint") return "sprint";
    if (locomotion.gait === "walk") return "walk";
    return "run";
  }
  return "idle";
}

export function buildPlayTestAnimationStateKey(args: {
  playTestWeaponSlotId: WeaponSelectSlotId | null;
  playTestHardAim: boolean;
  locomotion?: { isMoving?: boolean; gait?: WalkGait; jumpPhase?: JumpPhase };
}): {
  stanceId: ReturnType<typeof stanceIdForWeaponSlot>;
  stateKey: string;
  previewLocomotion: AnimationLocomotionKind;
} {
  const stanceId = stanceIdForWeaponSlot(args.playTestWeaponSlotId);
  const layers = animationLayersFromState({
    stanceId,
    aiming: args.playTestHardAim,
    isMoving: args.locomotion?.isMoving,
    gait: args.locomotion?.gait,
    jumpPhase: args.locomotion?.jumpPhase,
  });
  return {
    stanceId,
    stateKey: `${stanceId}:${layers.baseClip}:${layers.upperClip ?? ""}`,
    previewLocomotion: resolvePlayTestPreviewLocomotion({
      stanceId,
      playTestHardAim: args.playTestHardAim,
      locomotion: args.locomotion,
    }),
  };
}

export async function applyPlayTestAnimationLayers(args: {
  animation: SidekickAnimationRuntime;
  stanceId: ReturnType<typeof stanceIdForWeaponSlot>;
  playTestHardAim: boolean;
  locomotion?: { isMoving?: boolean; gait?: WalkGait; jumpPhase?: JumpPhase };
  generation: number;
  playTestAnimationGeneration: number;
  isPlayTestActive: () => boolean;
  ensureControllerClipLoaded: (clip: string) => Promise<string | null>;
  ensureAnimatedPose: () => Promise<void>;
  setStageStatus: (message: string, isWarning?: boolean) => void;
}): Promise<boolean> {
  const layers = animationLayersFromState({
    stanceId: args.stanceId,
    aiming: args.playTestHardAim,
    isMoving: args.locomotion?.isMoving,
    gait: args.locomotion?.gait,
    jumpPhase: args.locomotion?.jumpPhase,
  });
  const loadedClip = await args.ensureControllerClipLoaded(layers.baseClip);
  if (!args.isPlayTestActive() || args.generation !== args.playTestAnimationGeneration) {
    return false;
  }
  if (!loadedClip) {
    args.setStageStatus(
      `Play test has no loadable ${args.stanceId} clip "${layers.baseClip}".`,
      true,
    );
    return false;
  }
  let loadedUpper: string | null = null;
  if (layers.upperClip) {
    loadedUpper = await args.ensureControllerClipLoaded(layers.upperClip);
    if (!args.isPlayTestActive() || args.generation !== args.playTestAnimationGeneration) {
      return false;
    }
    if (!loadedUpper) {
      args.setStageStatus(
        `Play test has no loadable upper clip "${layers.upperClip}".`,
        true,
      );
      return false;
    }
  }
  await args.ensureAnimatedPose();
  if (!args.isPlayTestActive() || args.generation !== args.playTestAnimationGeneration) {
    return false;
  }
  args.animation.setUpperBodyAnimation(loadedUpper, 0.16);
  args.animation.setAnimation(loadedClip, 0.16);
  args.animation.setPlaying(true);
  return true;
}
