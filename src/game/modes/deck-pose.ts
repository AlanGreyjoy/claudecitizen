import type { getActiveShip } from "../../player/world_state";
import { getShipLayout } from "../../player/ship_layout";
import {
  isShipParked,
  isWithinShipPadHorizontal,
  worldToShipLocal,
} from "../../player/ship_interaction";
import { sampleColliderGroundHeight } from "../../physics/colliders";
import {
  isShipInteriorWalkPose,
  type DeckCharacterState,
} from "../../player/ship_deck";
import type { doorBlends } from "../../player/ship_rig";
import type { LoopContext } from "../loop_context";
import { isPlanetFeetGrounded } from "./deck_exterior_feet";

type ColliderRig = {
  gear01: number;
  ramp01: number;
  doors: ReturnType<typeof doorBlends>;
};

export function classifyPriorDeckPose(
  ctx: LoopContext,
  instance: ReturnType<typeof getActiveShip>,
  prior: DeckCharacterState,
  colliderRig: ColliderRig,
): {
  likelyExterior: boolean;
  exteriorPlanetGrounded: boolean;
} {
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
  const onHullContact =
    priorStructureFloor !== null &&
    priorLocal.up >= priorStructureFloor - 0.12 &&
    priorLocal.up <= priorStructureFloor + 0.85;
  const exteriorPlanetGrounded =
    likelyExterior &&
    !onHullContact &&
    isPlanetFeetGrounded(ctx, prior.position, priorVertical);
  return { likelyExterior, exteriorPlanetGrounded };
}

export function classifyCurrentDeckPose(
  instance: ReturnType<typeof getActiveShip>,
  resultState: DeckCharacterState,
  colliderRig: ColliderRig,
): { onHullExterior: boolean; onInterior: boolean } {
  const deckLocal = resultState.deckLocal;
  const local = worldToShipLocal(instance.body, resultState.position);
  const structureFloor = sampleColliderGroundHeight(
    local.right,
    local.up + 4,
    local.forward,
    getShipLayout().colliders,
    colliderRig,
    local.up + 0.55,
  );
  const verticalVel = resultState.shipVerticalVelocity ?? 0;
  const onHullExterior =
    structureFloor !== null &&
    verticalVel <= 0.5 &&
    local.up >= structureFloor - 0.12 &&
    local.up <= structureFloor + 0.85 &&
    !isShipInteriorWalkPose(deckLocal, local.up, structureFloor);
  const onInterior =
    verticalVel <= 0.5 &&
    isShipInteriorWalkPose(deckLocal, local.up, structureFloor);
  return { onHullExterior, onInterior };
}
