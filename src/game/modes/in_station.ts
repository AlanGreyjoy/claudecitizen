import {
  updateCharacterInStation,
  type StationCharacterState,
} from "../../player/station_walk";
import {
  getActiveShip,
  PLAYER_SHIP_INSTANCE_ID,
} from "../../player/world_state";
import { getShipInstance } from "../../flight/ship_world";
import { getStationLayoutOverride } from "../../world/station";
import {
  characterHeadLookTowardPoint,
  resolveNearestScreenHotspot,
  SCREEN_HOTSPOT_MAX_DISTANCE_METERS,
  screenWorldNormal,
  stationHotspotEyeWorld,
  type ScreenHotspotAnchor,
} from "../../player/screen_hotspot";
import {
  resolveStationWalkView,
  resolveWeaponShopGazeTarget,
  stationWalkAimOriginWorld,
  weaponShopLabel,
  weaponShopWorldPosition,
} from "../../player/weapon_shop_gaze";
import {
  outfittersLabel,
  outfittersWorldPosition,
  resolveOutfittersGazeTarget,
} from "../../player/outfitters_gaze";
import {
  foodShopLabel,
  foodShopWorldPosition,
  resolveFoodShopGazeTarget,
} from "../../player/food_shop_gaze";
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
import type { WeaponCombat } from "../combat/weapon_combat";
import type { PadInterest } from "../station/pad_interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";
import type { StationAnimations } from "../station/animations";
import type { BuildTool } from "../station/build_tool";
import type { BuildAreaRuntime, FrameActions, WalkModeInput } from "../types";

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

/** Station walking: build tool, vendor screens, terminals, and elevators. */
export function createInStationMode(
  ctx: LoopContext,
  deps: InStationDeps,
): InStationMode {
  const { keyLabel, pressInteractPrompt } = deps.prompts;

  function avmsPrompt(): string {
    return pressInteractPrompt("AVMS terminal");
  }

  function shipsForAvms(): GameBootstrap["ships"] {
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

  function isVitalsLockedApartmentExit(interaction: StationInteraction): boolean {
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

  function stationPrompt(interaction: StationInteraction | null): string {
    if (interaction) {
      if (isVitalsLockedApartmentExit(interaction)) {
        return "Vitals sync unavailable — apartment exit locked";
      }
      switch (interaction.kind) {
        case "hab-lift-down":
          return pressInteractPrompt("elevator to Lobby");
        case "hab-lift-up":
          return pressInteractPrompt("elevator to Habs");
        case "terminal":
        case "avms-terminal":
          return avmsPrompt();
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
        case "prefab-info": {
          let promptText = interaction.prompt;
          if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
            const animState = ctx.stationAnimationStates[interaction.targetAnimationId];
            const isOpen = animState ? animState.target === 1 : false;
            if (isOpen) {
              promptText = promptText.replace(/\bopen\b/ig, (m) => m === 'open' ? 'close' : 'Close');
            }
          }
          const key = interaction.keyLabel ?? 'F';
          if (key !== 'F') {
            promptText = promptText.replace(/Press F\b/i, `Press ${key}`);
          }
          return promptText;
        }
      }
    }
    return "";
  }

  function networkInstanceForInteraction(
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
        if (interaction.marker.targetFloor === "hangar")
          return ctx.bootstrap.spawn.hangarInstanceId;
        if (interaction.marker.targetFloor === "hab")
          return ctx.bootstrap.spawn.apartmentInstanceId;
        return "station:public";
      case "terminal":
      case "avms-terminal":
      case "prefab-info":
        return null;
    }
  }

  function announceElevatorTransition(
    interaction: StationInteraction,
    destination: { roomId: string } | null,
  ): void {
    const instanceId = networkInstanceForInteraction(interaction);
    if (!instanceId || !destination) return;
    ctx.network?.transition(instanceId, destination.roomId);
  }

  function walkInStation(input: WalkModeInput): void {
    ctx.world.character = updateCharacterInStation(
      ctx.world.character as StationCharacterState,
      ctx.stationFrame,
      { ...input.characterInput, jumpPressed: input.actions.jumpPressed },
      input.dt,
      ctx.planet.gravityMetersPerSecond2 ?? 9.8,
      ctx.physics,
      deps.combat.currentAnimStance(),
      deps.combat.currentWeaponPoseAiming(input.characterInput),
    );
  }

  function handleActiveBuildTool(
    activeRuntime: BuildAreaRuntime,
    input: WalkModeInput,
  ): void {
    const { actions } = input;
    walkInStation(input);
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

  function handleVendors(actions: FrameActions): boolean {
    const shops = getStationLayoutOverride()?.weaponShops ?? [];
    const outfittersShops = getStationLayoutOverride()?.outfitters ?? [];
    const foodShops = getStationLayoutOverride()?.foodShops ?? [];

    // Proximity hotspots: turn the Head bone toward vendor screens.
    const hotspotEye = stationHotspotEyeWorld(
      ctx.world.character.position,
      ctx.stationFrame.up,
    );
    const hotspotAnchors: ScreenHotspotAnchor[] = [];
    for (const shop of shops) {
      hotspotAnchors.push({
        worldPosition: weaponShopWorldPosition(ctx.stationFrame, shop),
        maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
        worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
      });
    }
    for (const shop of outfittersShops) {
      hotspotAnchors.push({
        worldPosition: outfittersWorldPosition(ctx.stationFrame, shop),
        maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
        worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
      });
    }
    for (const shop of foodShops) {
      hotspotAnchors.push({
        worldPosition: foodShopWorldPosition(ctx.stationFrame, shop),
        maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
        worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
      });
    }
    const anyVendorOpen =
      Boolean(ctx.weaponShop?.isOpen()) ||
      Boolean(ctx.outfitters?.isOpen()) ||
      Boolean(ctx.foodShop?.isOpen());
    const hotspot = resolveNearestScreenHotspot(hotspotAnchors, hotspotEye);
    ctx.stationScreenHeadLook = hotspot
      ? characterHeadLookTowardPoint(
          ctx.world.character.forward,
          ctx.world.character.up,
          hotspotEye,
          hotspot.worldPosition,
        )
      : null;

    const walkView = resolveStationWalkView(
      ctx.stationFrame.forward,
      ctx.stationFrame.up,
      ctx.world.cameraOrbit.yawRadians,
      ctx.world.cameraOrbit.pitchRadians,
    );
    const shopEye = stationWalkAimOriginWorld(
      ctx.world.character.position,
      ctx.stationFrame.up,
      walkView.forward,
    );
    const shopHit = resolveWeaponShopGazeTarget(
      shops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    );
    const outfittersHit = resolveOutfittersGazeTarget(
      outfittersShops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    );
    const foodShopHit = resolveFoodShopGazeTarget(
      foodShops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    );

    if (ctx.weaponShopScreen && ctx.renderer && shops.length > 0) {
      ctx.weaponShopScreen.attachTo(ctx.renderer.getStationRoot());
      ctx.weaponShopScreen.setSpec(shopHit?.shop ?? shops[0]!);
    }
    if (ctx.outfittersScreen && ctx.renderer && outfittersShops.length > 0) {
      ctx.outfittersScreen.attachTo(ctx.renderer.getStationRoot());
      ctx.outfittersScreen.setSpec(outfittersHit?.shop ?? outfittersShops[0]!);
    }
    if (ctx.foodShopScreen && ctx.renderer && foodShops.length > 0) {
      ctx.foodShopScreen.attachTo(ctx.renderer.getStationRoot());
      ctx.foodShopScreen.setSpec(foodShopHit?.shop ?? foodShops[0]!);
    }

    if (
      shopHit &&
      actions.interactPressed &&
      ctx.weaponShop &&
      !ctx.weaponShop.isOpen() &&
      !ctx.outfitters?.isOpen() &&
      !ctx.foodShop?.isOpen()
    ) {
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
      ctx.weaponShopScreen?.setPowered(true);
      ctx.weaponShopScreen?.setInteractive(true);
      ctx.weaponShop.open({
        shop: shopHit.shop,
        onClose: () => {
          ctx.weaponShopScreen?.setInteractive(false);
          ctx.weaponShopScreen?.setPowered(false);
        },
      });
      ctx.world.prompt = "";
      return true;
    }

    if (
      outfittersHit &&
      actions.interactPressed &&
      ctx.outfitters &&
      !ctx.outfitters.isOpen() &&
      !ctx.weaponShop?.isOpen() &&
      !ctx.foodShop?.isOpen()
    ) {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
      ctx.outfittersScreen?.setPowered(true);
      ctx.outfittersScreen?.setInteractive(true);
      ctx.outfitters.open({
        shop: outfittersHit.shop,
        onClose: () => {
          ctx.outfittersScreen?.setInteractive(false);
          ctx.outfittersScreen?.setPowered(false);
        },
      });
      ctx.world.prompt = "";
      return true;
    }

    if (
      foodShopHit &&
      actions.interactPressed &&
      ctx.foodShop &&
      !ctx.foodShop.isOpen() &&
      !ctx.weaponShop?.isOpen() &&
      !ctx.outfitters?.isOpen()
    ) {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
      ctx.foodShopScreen?.setPowered(true);
      ctx.foodShopScreen?.setInteractive(true);
      ctx.foodShop.open({
        shop: foodShopHit.shop,
        onClose: () => {
          ctx.foodShopScreen?.setInteractive(false);
          ctx.foodShopScreen?.setPowered(false);
        },
      });
      ctx.world.prompt = "";
      return true;
    }

    if (anyVendorOpen) {
      ctx.world.prompt = "";
      return true;
    }

    if (shopHit) {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
      ctx.world.prompt = pressInteractPrompt(weaponShopLabel(shopHit.shop));
      return true;
    }

    if (outfittersHit) {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
      ctx.world.prompt = pressInteractPrompt(outfittersLabel(outfittersHit.shop));
      return true;
    }

    if (foodShopHit) {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
      ctx.world.prompt = pressInteractPrompt(foodShopLabel(foodShopHit.shop));
      return true;
    }

    ctx.weaponShopScreen?.setInteractive(false);
    ctx.weaponShopScreen?.setPowered(false);
    ctx.outfittersScreen?.setInteractive(false);
    ctx.outfittersScreen?.setPowered(false);
    ctx.foodShopScreen?.setInteractive(false);
    ctx.foodShopScreen?.setPowered(false);
    return false;
  }

  function openAvmsTerminal(): void {
    ctx.avmsTerminal?.open({
      ships: shipsForAvms(),
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
        if (ctx.bootstrap) {
          try {
            const response = await resetAssignedHangarBay();
            const hangarRuntime = deps.buildTool.buildRuntimeForArea("hangar");
            hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
            if (hangarRuntime) await deps.buildTool.syncBuildPropsVisuals(hangarRuntime);
          } catch (error) {
            console.warn("Failed to persist hangar store.", error);
          }
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
        if (ctx.bootstrap) {
          getActiveShip(ctx.world).instanceId = ctx.bootstrap.spawn.hangarInstanceId;
          try {
            const response = await setAssignedHangarBay(hangar.index);
            const hangarRuntime = deps.buildTool.buildRuntimeForArea("hangar");
            hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
            if (hangarRuntime) await deps.buildTool.syncBuildPropsVisuals(hangarRuntime);
          } catch (error) {
            console.warn("Failed to persist assigned hangar bay.", error);
          }
        }
      },
    });
  }

  function handleStationInteraction(actions: FrameActions): void {
    const interaction = resolveStationInteraction(
      ctx.world.character as StationCharacterState,
      ctx.stationFrame,
    );
    if (interaction?.kind === "prefab-info" && interaction.id) {
      if (interaction.id !== ctx.lastNearbyPrefabInfoId) {
        ctx.lastNearbyPrefabInfoId = interaction.id;
        if (interaction.proximitySoundUrl) playSfx(interaction.proximitySoundUrl);
      }
    } else {
      ctx.lastNearbyPrefabInfoId = null;
    }
    ctx.world.prompt = stationPrompt(interaction);
    if (!interaction) return;
    if (isVitalsLockedApartmentExit(interaction)) return;

    if (interaction.kind === "terminal" || interaction.kind === "avms-terminal") {
      if (actions.interactPressed) {
        openAvmsTerminal();
      }
      return;
    }

    if (interaction.kind === "hangar-bank") {
      if (actions.interactPressed) {
        const hangarIndex = ctx.world.assignedHangar ?? 1;
        const destination = elevatorDestinationFor(interaction, hangarIndex);
        if (destination) {
          beginElevatorRide(ctx.world, destination);
          announceElevatorTransition(interaction, destination);
        }
      }
      return;
    }

    if (interaction.kind === 'prefab-info') {
      const key = interaction.keyLabel ?? 'F';
      const keyCode = `Key${key.toUpperCase()}`;
      const pressed = actions.wasKeyPressed ? actions.wasKeyPressed(keyCode) : (key === 'F' ? actions.interactPressed : false);
      if (pressed) {
        if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
          deps.animations.toggleStationAnimation(interaction.targetAnimationId);
        }
        if (interaction.interactSoundUrl) playSfx(interaction.interactSoundUrl);
      }
      return;
    }

    if (actions.interactPressed) {
      const destination = elevatorDestinationFor(interaction);
      if (destination) {
        beginElevatorRide(ctx.world, destination);
        announceElevatorTransition(interaction, destination);
      }
    }
  }

  function updateInStationMode(input: WalkModeInput): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();

    const activeRuntime = deps.buildTool.activeBuildRuntime();
    if (activeRuntime) {
      handleActiveBuildTool(activeRuntime, input);
      return;
    }

    walkInStation(input);

    if (deps.padInterest.tryEnterShipPadInterest()) return;

    const rampPrompt = deps.shipSystems.handleRampOutside(input.actions.interactPressed);
    if (rampPrompt !== null) {
      ctx.world.prompt = rampPrompt;
      return;
    }

    if (handleVendors(input.actions)) return;

    handleStationInteraction(input.actions);
  }

  return { updateInStationMode };
}
