import {
  getActiveShip,
  getActiveShipBody,
} from "../../player/world_state";
import { getShipLayout, usesColliderDeck } from "../../player/ship_layout";
import { doorBlends } from "../../player/ship_rig";
import {
  isShipParked,
  isWithinShipPadHorizontal,
  worldToShipLocal,
} from "../../player/ship_interaction";
import { sampleColliderGroundHeight } from "../../physics/colliders";
import {
  bedInteractPrompt,
  isOnShipRampDeck,
  isShipInteriorWalkPose,
  nearestBed,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  resolveDoorInteractAim,
  seatInteractPrompt,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from "../../player/ship_deck";
import {
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
} from "../../physics/ship_physics";
import { sampleFootPlanetSurface } from "../../world/planet_surface";
import { radialUp, surfacePointFromPosition } from "../../world/coordinates";
import { CHARACTER_GROUND_OFFSET_METERS } from "../../player/character_controller";
import { dot, sub } from "../../math/vec3";
import { playShipRampToggleSfx } from "../../player/ship_articulation_sfx";
import { beginLieTransition, beginSitTransition } from "../../player/transitions";
import { playSfx } from "../../audio/sfx";
import type { Vec3 } from "../../types";
import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop_context";
import type { WeaponCombat } from "../combat/weapon_combat";
import type { PadInterest } from "../station/pad_interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";

export interface OnShipDeckMode {
  updateOnShipDeckMode: (input: WalkModeInput) => void;
}

/** Ship-deck walking (interior + exterior hull/pad) with seat/bed/door/ramp. */
export function createOnShipDeckMode(
  ctx: LoopContext,
  deps: {
    combat: WeaponCombat;
    padInterest: PadInterest;
    shipSystems: ShipSystems;
    prompts: Prompts;
  },
): OnShipDeckMode {
  /** Height above planet foot surface along radial up (meters). */
  function planetFeetHeightAbove(position: Vec3): number {
    const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, position);
    const groundWorld = surfacePointFromPosition(
      position,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    return dot(sub(position, groundWorld), radialUp(position));
  }

  function isPlanetFeetGrounded(
    position: Vec3,
    verticalVelocity: number,
  ): boolean {
    if (verticalVelocity > 0.15) return false;
    return planetFeetHeightAbove(position) <= 0.22;
  }

  /**
   * Exterior near-ship: keep Rapier XY (hull collision), stick to / land on
   * planet terrain. Does not kill jumps mid-air.
   */
  function syncShipExteriorFeetToPlanet(): void {
    if (!ctx.shipPhysics) return;
    const ship = getActiveShipBody(ctx.world);
    const deck = ctx.world.character as DeckCharacterState;
    const verticalVel = deck.shipVerticalVelocity ?? 0;
    const local = getShipPlayerLocal(ctx.shipPhysics);
    const approxWorld = getShipPlayerWorldPosition(ctx.shipPhysics, ship);
    const up = radialUp(approxWorld);
    const heightAbove = planetFeetHeightAbove(approxWorld);

    // Airborne: follow Rapier pose, keep vertical velocity, planet-radial up.
    if (verticalVel > 0.15 || heightAbove > 0.35) {
      ctx.world.character = {
        ...deck,
        position: approxWorld,
        up,
        grounded: false,
        airborneOffDeckFrames: 0,
        shipVerticalVelocity: verticalVel,
      };
      return;
    }

    const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, approxWorld);
    const groundWorld = surfacePointFromPosition(
      approxWorld,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    const groundLocal = worldToShipLocal(ship, groundWorld);
    teleportShipPlayerLocal(ctx.shipPhysics, {
      right: local.right,
      up: groundLocal.up,
      forward: local.forward,
    });
    const position = getShipPlayerWorldPosition(ctx.shipPhysics, ship);
    ctx.world.character = {
      ...deck,
      position,
      up: radialUp(position),
      grounded: true,
      jumpPhase: "grounded",
      airborneOffDeckFrames: 0,
      shipVerticalVelocity: 0,
    };
  }

  function updateDeckMode(input: WalkModeInput): void {
    const { characterInput, actions, dt } = input;
    const instance = getActiveShip(ctx.world);
    const rig = instance.rig;
    const colliderRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    if (ctx.shipPhysics && usesColliderDeck()) {
      syncShipArticulationColliders(
        ctx.shipPhysics,
        colliderRig,
        getShipLayout().doors.map((door) => door.id),
      );
    }

    const prior = ctx.world.character as DeckCharacterState;
    const priorLocal = worldToShipLocal(instance.body, prior.position);
    const priorStructureFloor = sampleColliderGroundHeight(
      priorLocal.right,
      priorLocal.up + 4,
      priorLocal.forward,
      getShipLayout().colliders,
      colliderRig,
      priorLocal.up + 0.55,
    );
    const priorVertical = prior.shipVerticalVelocity ?? 0;
    const priorInterior =
      priorVertical <= 0.5 &&
      isShipInteriorWalkPose(
        { right: priorLocal.right, forward: priorLocal.forward },
        priorLocal.up,
        priorStructureFloor,
      );
    const likelyExterior =
      isShipParked(instance.body) &&
      isWithinShipPadHorizontal(prior, instance.body) &&
      (ctx.world.shipExteriorWalk || !priorInterior);
    // Planet jump only on ground — not while standing on the outer hull.
    const onHullContact =
      priorStructureFloor !== null &&
      priorLocal.up >= priorStructureFloor - 0.12 &&
      priorLocal.up <= priorStructureFloor + 0.85;
    const exteriorPlanetGrounded =
      likelyExterior &&
      !onHullContact &&
      isPlanetFeetGrounded(prior.position, priorVertical);

    const result = updateCharacterOnDeck(
      prior,
      instance.body,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      ctx.planet.gravityMetersPerSecond2 ?? 9.8,
      colliderRig,
      usesColliderDeck() ? ctx.shipPhysics : null,
      {
        exteriorPlanetGrounded,
        suppressDeckExit: likelyExterior,
      },
      deps.combat.currentAnimStance(),
      deps.combat.currentWeaponPoseAiming(characterInput),
    );
    ctx.world.character = result.state;

    const deckLocal = result.state.deckLocal;
    const local = worldToShipLocal(instance.body, result.state.position);
    const structureFloor = sampleColliderGroundHeight(
      local.right,
      local.up + 4,
      local.forward,
      getShipLayout().colliders,
      colliderRig,
      local.up + 0.55,
    );
    const verticalVel = result.state.shipVerticalVelocity ?? 0;
    const onHullExterior =
      structureFloor !== null &&
      verticalVel <= 0.5 &&
      local.up >= structureFloor - 0.12 &&
      local.up <= structureFloor + 0.85 &&
      !isShipInteriorWalkPose(deckLocal, local.up, structureFloor);
    const onInterior =
      verticalVel <= 0.5 &&
      isShipInteriorWalkPose(deckLocal, local.up, structureFloor);

    if (!onInterior) {
      if (
        !isShipParked(instance.body) ||
        !isWithinShipPadHorizontal(ctx.world.character, instance.body)
      ) {
        deps.padInterest.leaveShipDeck();
        return;
      }
      ctx.world.shipExteriorWalk = true;
      if (onHullExterior) {
        // Outer hull / roof: keep Rapier contact, character-orbit camera.
        // Do not snap through the ship to planet ground.
        ctx.world.character = {
          ...result.state,
          up: radialUp(result.state.position),
          deckZone: undefined,
        };
        ctx.world.prompt = deps.shipSystems.handleRampOutside(actions.interactPressed) ?? "";
        return;
      }
      syncShipExteriorFeetToPlanet();
      ctx.world.prompt = deps.shipSystems.handleRampOutside(actions.interactPressed) ?? "";
      return;
    }

    ctx.world.shipExteriorWalk = false;

    if (result.dismounted || result.fellOffDeck) {
      deps.padInterest.leaveShipDeck();
      return;
    }

    const seatNearby = nearestSeat(deckLocal);
    if (seatNearby) {
      ctx.world.prompt = seatInteractPrompt(seatNearby, deps.prompts.keyLabel("interact"));
      if (actions.interactPressed && seatNearby.role === "pilot")
        beginSitTransition(ctx.world);
      return;
    }

    const doorAim = resolveDoorInteractAim(
      instance.body,
      result.state.position,
      ctx.world.cameraOrbit.yawRadians,
      ctx.world.cameraOrbit.pitchRadians,
      ctx.world.cameraOrbit.zoomDistance,
    );
    const bedNearby = nearestBed(deckLocal, doorAim);
    if (bedNearby) {
      ctx.world.prompt = bedInteractPrompt(bedNearby, deps.prompts.keyLabel("interact"));
      if (actions.interactPressed) beginLieTransition(ctx.world, bedNearby.id);
      return;
    }

    const doorNearby = nearestDoor(deckLocal, doorAim);
    if (doorNearby) {
      const door = getShipLayout().doors.find(
        (entry) => entry.id === doorNearby.doorId,
      );
      const doorRig = rig.doors[doorNearby.doorId];
      if (door && doorRig) {
        ctx.world.prompt = doorRig.isOpen
          ? deps.prompts.pressInteractPrompt(`close ${door.label}`)
          : deps.prompts.pressInteractPrompt(`open ${door.label}`);
        if (actions.interactPressed) {
          doorRig.isOpen = !doorRig.isOpen;
          const sfx = doorRig.isOpen ? door.openSoundUrl : door.closeSoundUrl;
          if (sfx) playSfx(sfx);
        }
        return;
      }
    }

    const standingOnRamp = isOnShipRampDeck(deckLocal);
    if (nearRampPanel(deckLocal) && !standingOnRamp) {
      ctx.world.prompt = rig.rampDown
        ? deps.prompts.pressInteractPrompt("raise ramp")
        : deps.prompts.pressInteractPrompt("lower ramp");
      if (actions.interactPressed) {
        rig.rampDown = !rig.rampDown;
        playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
      }
      return;
    }

    ctx.world.prompt = "";
  }

  function updateOnShipDeckMode(input: WalkModeInput): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    updateDeckMode(input);
  }

  return { updateOnShipDeckMode };
}
