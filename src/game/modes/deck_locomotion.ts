import { getActiveShip } from "../../player/world_state";
import { getShipLayout, usesColliderDeck } from "../../player/ship_layout";
import { doorBlends } from "../../player/ship_rig";
import {
  isShipParked,
  isWithinShipPadHorizontal,
} from "../../player/ship_interaction";
import {
  updateCharacterOnDeck,
  type DeckCharacterState,
} from "../../player/ship_deck";
import { syncShipArticulationColliders } from "../../physics/ship_physics";
import { radialUp } from "../../world/coordinates";
import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop_context";
import type { WeaponCombat } from "../combat/weapon_combat";
import type { PadInterest } from "../station/pad_interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";
import { syncShipExteriorFeetToPlanet } from "./deck_exterior_feet";
import { handleDeckInteriorInteractions } from "./deck_interior_interactions";
import {
  classifyCurrentDeckPose,
  classifyPriorDeckPose,
} from "./deck_pose";

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
  if (onHullExterior) {
    ctx.world.character = {
      ...result.state,
      up: radialUp(result.state.position),
      deckZone: undefined,
    };
  } else {
    syncShipExteriorFeetToPlanet(ctx);
  }
  ctx.world.prompt = shipSystems.handleRampOutside(interactPressed) ?? "";
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
