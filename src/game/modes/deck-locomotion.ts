import { getActiveShip } from "../../player/world-state";
import {
  getShipLayout,
  getShipRestHeightMeters,
  usesColliderDeck,
} from "../../player/ship-layout";
import { sampleHangarRest } from "../../world/station";
import { doorBlends } from "../../player/ship-rig";
import {
  isShipParked,
  isWithinShipPadHorizontal,
} from "../../player/ship-interaction";
import {
  updateCharacterClimbingOnDeck,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from "../../player/ship-deck";
import { findLadderById } from "../../world/ladders";
import { syncShipArticulationColliders } from "../../physics/ship-physics";
import { radialUp } from "../../world/coordinates";
import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop-context";
import type { WeaponCombat } from "../combat/weapon-combat";
import type { PadInterest } from "../station/pad-interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";
import { syncShipExteriorFeetToPlanet } from "./deck-exterior-feet";
import { handleDeckInteriorInteractions } from "./deck-interior-interactions";
import {
  classifyCurrentDeckPose,
  classifyPriorDeckPose,
} from "./deck-pose";

function syncArticulation(
  ctx: LoopContext,
  colliderRig: {
    gear01: number;
    ramp01: number;
    doors: ReturnType<typeof doorBlends>;
  },
): void {
  if (!ctx.shipPhysics || !usesColliderDeck()) return;
  syncShipArticulationColliders(
    ctx.shipPhysics,
    colliderRig,
    getShipLayout().doors.map((door) => door.id),
  );
}

function handleExteriorDeck(
  ctx: LoopContext,
  padInterest: PadInterest,
  shipSystems: ShipSystems,
  instance: ReturnType<typeof getActiveShip>,
  result: ReturnType<typeof updateCharacterOnDeck>,
  onHullExterior: boolean,
  interactPressed: boolean,
): void {
  if (
    !isShipParked(instance.body) ||
    !isWithinShipPadHorizontal(ctx.world.character, instance.body)
  ) {
    padInterest.leaveShipDeck();
    return;
  }
  ctx.world.shipExteriorWalk = true;
  // A hull parked in a station hangar has no terrain under it — snapping feet
  // to the planet surface from inside an interior scene drops the player
  // through the deck. The pad collider is the floor there, so Rapier's own
  // result already stands them on it.
  const inHangar =
    sampleHangarRest(
      ctx.stationFrame,
      instance.body.position,
      getShipRestHeightMeters(),
    ) !== null;
  if (onHullExterior || inHangar) {
    ctx.world.character = {
      ...result.state,
      up: inHangar ? ctx.world.character.up : radialUp(result.state.position),
      deckZone: undefined,
    };
  } else {
    syncShipExteriorFeetToPlanet(ctx);
  }
  ctx.world.prompt = shipSystems.handleRampOutside(interactPressed) ?? "";
}

/**
 * Ladder climbing replaces deck locomotion while attached. Returns false when
 * the player is not on a ship ladder so the caller falls through to walking.
 */
function climbDeckLadder(
  ctx: LoopContext,
  prompts: Prompts,
  input: WalkModeInput,
): boolean {
  const climb = ctx.world.ladderClimb;
  if (!climb || climb.surface !== "ship") return false;
  const ladder = findLadderById(getShipLayout().ladders, climb.ladderId);
  if (!ladder) {
    ctx.world.ladderClimb = null;
    return false;
  }
  // Jump lets go anywhere on the rail — the fall is the dismount.
  if (input.actions.jumpPressed) {
    ctx.world.ladderClimb = null;
    return false;
  }

  const result = updateCharacterClimbingOnDeck(
    ctx.world.character as DeckCharacterState,
    getActiveShip(ctx.world).body,
    ladder,
    input.characterInput,
    input.dt,
    usesColliderDeck() ? ctx.shipPhysics : null,
  );
  ctx.world.character = result.state;
  ctx.world.shipExteriorWalk = false;
  if (result.exit === "none") {
    climb.along = result.along;
    ctx.world.prompt = `Forward / back to climb · ${prompts.keyLabel("jump")} to let go`;
    return true;
  }
  ctx.world.ladderClimb = null;
  ctx.world.prompt = "";
  return true;
}

/** Full deck-mode step: locomotion, exterior/interior routing, interactions. */
export function updateDeckMode(
  ctx: LoopContext,
  deps: {
    combat: WeaponCombat;
    padInterest: PadInterest;
    shipSystems: ShipSystems;
    prompts: Prompts;
  },
  input: WalkModeInput,
): void {
  const { characterInput, actions, dt } = input;
  const instance = getActiveShip(ctx.world);
  const colliderRig = {
    gear01: instance.rig.gear01,
    ramp01: instance.rig.ramp01,
    doors: doorBlends(instance.rig),
  };
  syncArticulation(ctx, colliderRig);
  if (climbDeckLadder(ctx, deps.prompts, input)) return;

  const prior = ctx.world.character as DeckCharacterState;
  const { likelyExterior, exteriorPlanetGrounded } = classifyPriorDeckPose(
    ctx,
    instance,
    prior,
    colliderRig,
  );

  const result = updateCharacterOnDeck(
    prior,
    instance.body,
    { ...characterInput, jumpPressed: actions.jumpPressed },
    dt,
    ctx.planet.gravityMetersPerSecond2 ?? 9.8,
    usesColliderDeck() ? ctx.shipPhysics : null,
    {
      exteriorPlanetGrounded,
      suppressDeckExit: likelyExterior,
      stanceId: deps.combat.currentAnimStance(),
      aiming: deps.combat.currentWeaponPoseAiming(characterInput),
    },
  );
  ctx.world.character = result.state;

  const { onHullExterior, onInterior } = classifyCurrentDeckPose(
    instance,
    result.state,
    colliderRig,
  );

  if (!onInterior) {
    handleExteriorDeck(
      ctx,
      deps.padInterest,
      deps.shipSystems,
      instance,
      result,
      onHullExterior,
      actions.interactPressed,
    );
    return;
  }

  ctx.world.shipExteriorWalk = false;
  if (result.dismounted || result.fellOffDeck) {
    deps.padInterest.leaveShipDeck();
    return;
  }

  handleDeckInteriorInteractions(
    ctx,
    deps.prompts,
    actions,
    result.state.deckLocal,
    result.state.position,
  );
}
