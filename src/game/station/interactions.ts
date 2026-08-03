import {
  resolveStationDoorInteractAim,
  resolveStationInteraction,
  type StationInteraction,
} from "../../player/station-interaction";
import type { StationCharacterState } from "../../player/station-walk";
import { beginChairSitTransition } from "../../player/chair-sit";
import { playSfx } from "../../audio/sfx";
import { sceneExitTarget } from "./scene-exit";
import { openAvmsTerminal } from "./avms-actions";
import type { LoopContext } from "../loop-context";
import type { BuildTool } from "./build-tool";
import type { StationAnimations } from "./animations";
import type { FrameActions } from "../types";

export function isVitalsLockedApartmentExit(
  ctx: LoopContext,
  interaction: StationInteraction,
): boolean {
  if (!ctx.world.vitalsSyncLocked) return false;
  return interaction.kind === "scene-exit";
}

function prefabInfoPrompt(ctx: LoopContext, interaction: Extract<StationInteraction, { kind: "prefab-info" }>): string {
  let promptText = interaction.prompt;
  if (interaction.interactionType === "animation" && interaction.targetAnimationId) {
    const animState = ctx.stationAnimationStates[interaction.targetAnimationId];
    const isOpen = animState ? animState.target === 1 : false;
    if (isOpen) {
      promptText = promptText.replace(/\bopen\b/gi, (m) =>
        m === "open" ? "close" : "Close",
      );
    }
  }
  const key = interaction.keyLabel ?? "F";
  if (key !== "F") {
    promptText = promptText.replace(/Press F\b/i, `Press ${key}`);
  }
  return promptText;
}

export function stationInteractionPrompt(
  ctx: LoopContext,
  interaction: StationInteraction | null,
  pressInteractPrompt: (label: string) => string,
): string {
  if (!interaction) return "";
  if (isVitalsLockedApartmentExit(ctx, interaction)) {
    return "Vitals sync unavailable — apartment exit locked";
  }
  switch (interaction.kind) {
    case "terminal":
      return pressInteractPrompt("AVMS terminal");
    case "scene-exit":
      return interaction.marker.prompt.includes("Press ")
        ? interaction.marker.prompt
        : pressInteractPrompt(interaction.marker.prompt.replace(/^Press F\s*[—-]\s*/i, "") || "exit");
    case "ladder":
      return pressInteractPrompt(interaction.ladder.label || "ladder");
    case "chair": {
      const label = interaction.chair.label.trim() || "chair";
      return label.toLowerCase() === "chair"
        ? pressInteractPrompt("sit")
        : pressInteractPrompt(`sit (${label})`);
    }
    case "prefab-info":
      return prefabInfoPrompt(ctx, interaction);
    case "door": {
      const animState = ctx.stationAnimationStates[interaction.door.id];
      const isOpen = animState ? animState.target === 1 : false;
      return pressInteractPrompt(
        `${isOpen ? "close" : "open"} ${interaction.door.label}`,
      );
    }
    case "chest-storage":
      return pressInteractPrompt(
        interaction.marker.label.replace(/^Press F\s*[—-]\s*/i, "") || "Open chest",
      );
  }
}

function trackPrefabProximitySound(
  ctx: LoopContext,
  interaction: StationInteraction | null,
): void {
  if (interaction?.kind === "prefab-info" && interaction.id) {
    if (interaction.id !== ctx.lastNearbyPrefabInfoId) {
      ctx.lastNearbyPrefabInfoId = interaction.id;
      if (interaction.proximitySoundUrl) playSfx(interaction.proximitySoundUrl);
    }
    return;
  }
  ctx.lastNearbyPrefabInfoId = null;
}

function handlePrefabInfoInteraction(
  actions: FrameActions,
  interaction: Extract<StationInteraction, { kind: "prefab-info" }>,
  animations: StationAnimations,
): void {
  const key = interaction.keyLabel ?? "F";
  const keyCode = `Key${key.toUpperCase()}`;
  const pressed = actions.wasKeyPressed
    ? actions.wasKeyPressed(keyCode)
    : key === "F"
      ? actions.interactPressed
      : false;
  if (!pressed) return;
  if (interaction.interactionType === "animation" && interaction.targetAnimationId) {
    animations.toggleStationAnimation(interaction.targetAnimationId);
  }
  if (interaction.interactSoundUrl) playSfx(interaction.interactSoundUrl);
}

function handleDoorInteraction(
  ctx: LoopContext,
  actions: FrameActions,
  interaction: Extract<StationInteraction, { kind: "door" }>,
  animations: StationAnimations,
): void {
  if (!actions.interactPressed) return;
  const animState = ctx.stationAnimationStates[interaction.door.id];
  const opening = !(animState && animState.target === 1);
  animations.toggleStationAnimation(interaction.door.id);
  const sfx = opening
    ? interaction.door.openSoundUrl
    : interaction.door.closeSoundUrl;
  if (sfx) playSfx(sfx);
}

function handleSceneExitInteraction(
  ctx: LoopContext,
  actions: FrameActions,
  interaction: Extract<StationInteraction, { kind: "scene-exit" }>,
): void {
  if (!actions.interactPressed) return;
  // The cell move rides the scene swap rather than being sent on the outgoing
  // connection. A scene swap tears the world session down and dials a fresh
  // one, so a Transition sent here would be racing its own reconnect for the
  // Postgres write that decides the new session's cell.
  // An on-foot `exit-hangar` still leaves for open space, so it needs the same
  // hangar ownership hint a fly-through does — that is what finds the owning
  // station body's bay mouth to arrive at.
  ctx.onRequestScene?.(
    sceneExitTarget(interaction.marker, ctx.bootstrap, ctx.systemId, {
      fromHangarSceneId: ctx.sceneId,
    }),
  );
}

function activateStationInteraction(
  ctx: LoopContext,
  actions: FrameActions,
  interaction: StationInteraction,
  deps: {
    buildTool: BuildTool;
    animations: StationAnimations;
  },
): void {
  if (interaction.kind === "terminal") {
    if (actions.interactPressed) openAvmsTerminal(ctx, deps.buildTool);
    return;
  }
  if (interaction.kind === "prefab-info") {
    handlePrefabInfoInteraction(actions, interaction, deps.animations);
    return;
  }
  if (interaction.kind === "door") {
    handleDoorInteraction(ctx, actions, interaction, deps.animations);
    return;
  }
  if (interaction.kind === "chest-storage") {
    if (actions.interactPressed) {
      ctx.chestStorage?.open({
        chestId: interaction.marker.id,
        label: interaction.marker.label,
        slotCount: interaction.marker.slotCount,
      });
      ctx.world.prompt = "";
    }
    return;
  }
  if (interaction.kind === "ladder") {
    if (actions.interactPressed) {
      ctx.world.ladderClimb = {
        surface: "station",
        ladderId: interaction.ladder.id,
        along: interaction.along,
      };
    }
    return;
  }
  if (interaction.kind === "chair") {
    if (actions.interactPressed) {
      beginChairSitTransition(
        ctx.world,
        "station",
        interaction.chair.id,
        ctx.stationFrame,
      );
    }
    return;
  }
  if (interaction.kind === "scene-exit") {
    handleSceneExitInteraction(ctx, actions, interaction);
  }
}

/** Resolve nearby station markers, prompts, AVMS, and prefab F-key toggles. */
export function handleStationInteraction(
  ctx: LoopContext,
  actions: FrameActions,
  deps: {
    buildTool: BuildTool;
    animations: StationAnimations;
    pressInteractPrompt: (label: string) => string;
  },
): void {
  const character = ctx.world.character as StationCharacterState;
  const doorAim = resolveStationDoorInteractAim(
    character.position,
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
    ctx.world.cameraOrbit.zoomDistance,
  );
  const interaction = resolveStationInteraction(
    character,
    ctx.stationFrame,
    doorAim,
  );
  trackPrefabProximitySound(ctx, interaction);
  ctx.world.prompt = stationInteractionPrompt(
    ctx,
    interaction,
    deps.pressInteractPrompt,
  );
  if (!interaction) return;
  if (isVitalsLockedApartmentExit(ctx, interaction)) return;
  activateStationInteraction(ctx, actions, interaction, deps);
}
