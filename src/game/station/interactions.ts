import type { StationCharacterState } from "../../player/station_walk";
import {
  getActiveShip,
  PLAYER_SHIP_INSTANCE_ID,
} from "../../player/world_state";
import { getShipInstance } from "../../flight/ship_world";
import {
  beginElevatorRide,
  callShipToHangar,
  elevatorDestinationFor,
  resolveStationInteraction,
  type StationInteraction,
} from "../../player/station_interaction";
import { playSfx } from "../../audio/sfx";
import {
  resetAssignedHangarBay,
  setAssignedHangarBay,
  type GameBootstrap,
} from "../../net/api";
import type { LoopContext } from "../loop_context";
import type { BuildTool } from "./build_tool";
import type { StationAnimations } from "./animations";
import type { FrameActions } from "../types";

function shipsForAvms(ctx: LoopContext): GameBootstrap["ships"] {
  if (ctx.bootstrap?.ships.length) return ctx.bootstrap.ships;
  const ship = getActiveShip(ctx.world);
  return [
    {
      id: ship.id,
      shipDefinitionId: null,
      prefabId: ship.prefabId,
      displayName: ship.prefabId,
      hp: ship.vitals.hp,
      shields: ship.vitals.shields,
      maxHp: ship.spec.maxHp,
      maxShields: ship.spec.maxShields,
      shieldRegenPerSec: ship.spec.shieldRegenPerSec,
      maxSpeedMps: ship.spec.maxSpeedMps,
      throttleAccelMps2: ship.spec.throttleAccelMps2,
    },
  ];
}

export function isVitalsLockedApartmentExit(
  ctx: LoopContext,
  interaction: StationInteraction,
): boolean {
  if (!ctx.world.vitalsSyncLocked) return false;
  if (interaction.kind === "hab-lift-down") return true;
  if (interaction.kind === "prefab-elevator") {
    return interaction.marker.targetFloor !== "hab";
  }
  return (
    interaction.kind === "hangar-bank" ||
    interaction.kind === "hangar-lift-up"
  );
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
    case "hab-lift-down":
      return pressInteractPrompt("elevator to Lobby");
    case "hab-lift-up":
      return pressInteractPrompt("elevator to Habs");
    case "terminal":
    case "avms-terminal":
      return pressInteractPrompt("AVMS terminal");
    case "hangar-bank":
      return ctx.world.assignedHangar === null
        ? pressInteractPrompt("elevator to hangars")
        : pressInteractPrompt(
            `elevator to Hangar ${ctx.world.assignedHangar} (your ship)`,
          );
    case "hangar-lift-up":
      return pressInteractPrompt("elevator to Lobby");
    case "prefab-elevator":
      return pressInteractPrompt(`elevator to ${interaction.marker.targetFloor}`);
    case "prefab-info":
      return prefabInfoPrompt(ctx, interaction);
  }
}

function networkInstanceForInteraction(
  ctx: LoopContext,
  interaction: StationInteraction,
): string | null {
  if (!ctx.bootstrap) return null;
  switch (interaction.kind) {
    case "hab-lift-down":
    case "hangar-lift-up":
      return "station:public";
    case "hab-lift-up":
      return ctx.bootstrap.spawn.apartmentInstanceId;
    case "hangar-bank":
      return ctx.bootstrap.spawn.hangarInstanceId;
    case "prefab-elevator":
      if (interaction.marker.targetFloor === "hangar") {
        return ctx.bootstrap.spawn.hangarInstanceId;
      }
      if (interaction.marker.targetFloor === "hab") {
        return ctx.bootstrap.spawn.apartmentInstanceId;
      }
      return "station:public";
    case "terminal":
    case "avms-terminal":
    case "prefab-info":
      return null;
  }
}

function announceElevatorTransition(
  ctx: LoopContext,
  interaction: StationInteraction,
  destination: { roomId: string } | null,
): void {
  const instanceId = networkInstanceForInteraction(ctx, interaction);
  if (!instanceId || !destination) return;
  ctx.network?.transition(instanceId, destination.roomId);
}

async function syncHangarAfterAvms(
  buildTool: BuildTool,
  response: Awaited<ReturnType<typeof resetAssignedHangarBay>>,
): Promise<void> {
  const hangarRuntime = buildTool.buildRuntimeForArea("hangar");
  hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
  if (hangarRuntime) await buildTool.syncBuildPropsVisuals(hangarRuntime);
}

function openAvmsTerminal(ctx: LoopContext, buildTool: BuildTool): void {
  ctx.avmsTerminal?.open({
    ships: shipsForAvms(ctx),
    canStore: ctx.world.assignedHangar !== null,
    onStore: async () => {
      const ship = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
      if (ship) {
        ship.instanceId = "stored";
        ship.body.position = { x: 0, y: -100000, z: 0 };
        ship.body.velocity = { x: 0, y: 0, z: 0 };
      }
      ctx.world.assignedHangar = null;
      ctx.world.prompt = "Ship stored.";
      if (!ctx.bootstrap) return;
      try {
        const response = await resetAssignedHangarBay();
        await syncHangarAfterAvms(buildTool, response);
      } catch (error) {
        console.warn("Failed to persist hangar store.", error);
      }
    },
    onDeliver: async (ship) => {
      const hangar = await callShipToHangar(ctx.world, ctx.planet, ctx.seed, {
        ownedShip: ship,
        playerId: ctx.bootstrap?.player.id,
        hangarInstanceId: ctx.bootstrap?.spawn.hangarInstanceId,
      });
      if (!hangar) throw new Error("No hangar bays available.");
      ctx.world.prompt = `Ship delivered to Hangar ${hangar.index}`;
      if (!ctx.bootstrap) return;
      getActiveShip(ctx.world).instanceId = ctx.bootstrap.spawn.hangarInstanceId;
      try {
        const response = await setAssignedHangarBay(hangar.index);
        await syncHangarAfterAvms(buildTool, response);
      } catch (error) {
        console.warn("Failed to persist assigned hangar bay.", error);
      }
    },
  });
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

/** Resolve nearby station markers, prompts, elevators, AVMS, and prefab F-key toggles. */
export function handleStationInteraction(
  ctx: LoopContext,
  actions: FrameActions,
  deps: {
    buildTool: BuildTool;
    animations: StationAnimations;
    pressInteractPrompt: (label: string) => string;
  },
): void {
  const interaction = resolveStationInteraction(
    ctx.world.character as StationCharacterState,
    ctx.stationFrame,
  );
  trackPrefabProximitySound(ctx, interaction);
  ctx.world.prompt = stationInteractionPrompt(
    ctx,
    interaction,
    deps.pressInteractPrompt,
  );
  if (!interaction) return;
  if (isVitalsLockedApartmentExit(ctx, interaction)) return;

  if (interaction.kind === "terminal" || interaction.kind === "avms-terminal") {
    if (actions.interactPressed) openAvmsTerminal(ctx, deps.buildTool);
    return;
  }

  if (interaction.kind === "hangar-bank") {
    if (actions.interactPressed) {
      const hangarIndex = ctx.world.assignedHangar ?? 1;
      const destination = elevatorDestinationFor(interaction, hangarIndex);
      if (destination) {
        beginElevatorRide(ctx.world, destination);
        announceElevatorTransition(ctx, interaction, destination);
      }
    }
    return;
  }

  if (interaction.kind === "prefab-info") {
    handlePrefabInfoInteraction(actions, interaction, deps.animations);
    return;
  }

  if (actions.interactPressed) {
    const destination = elevatorDestinationFor(interaction);
    if (destination) {
      beginElevatorRide(ctx.world, destination);
      announceElevatorTransition(ctx, interaction, destination);
    }
  }
}
