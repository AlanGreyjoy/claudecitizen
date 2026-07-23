import {
  getActiveShipBody,
  getActiveShipRig,
} from "../../player/world_state";
import {
  getShipLayout,
  getShipRestHeightMeters,
  usesColliderDeck,
} from "../../player/ship_layout";
import { sampleHangarRest, worldToStationLocal } from "../../world/station";
import {
  isNearParkedShipPad,
  worldToShipLocal,
} from "../../player/ship_interaction";
import { doorBlends } from "../../player/ship_rig";
import {
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
} from "../../player/ship_deck";
import {
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
} from "../../physics/ship_physics";
import {
  createStationCharacterAt,
  type StationCharacterState,
} from "../../player/station_walk";
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
} from "../../player/character_controller";
import { sampleFootPlanetSurface } from "../../world/planet_surface";
import { surfacePointFromPosition } from "../../world/coordinates";
import { teleportStationPlayer } from "../../physics/station_physics";
import { dot } from "../../math/vec3";
import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { DeckPhysics } from "../ship/deck_physics";

export interface PadInterest {
  tryEnterShipPadInterest: () => boolean;
  leaveShipDeck: () => void;
}

/** Boards / leaves the ship-local Rapier world when near a parked ship pad. */
export function createPadInterest(
  ctx: LoopContext,
  deps: { deckPhysics: DeckPhysics },
): PadInterest {
  /**
   * Enter ship-local Rapier when near a parked ship (pad interest).
   * Continuous walk onto the open ramp — no ramp-tip teleport.
   */
  function tryEnterShipPadInterest(): boolean {
    if (!usesColliderDeck()) return false;
    const ship = getActiveShipBody(ctx.world);
    // A parked ship only owns locomotion for players sharing its walkable
    // area. Without this gate the raw ship-local proximity box reaches
    // through station walls/floors: delivering a ship to the hangar (or
    // walking past the lobby lift while a ship is parked) yanked players
    // into the empty ship-local Rapier world and dropped them through the
    // station.
    const hangarRest = sampleHangarRest(
      ctx.stationFrame,
      ship.position,
      getShipRestHeightMeters(),
    );
    if (ctx.world.mode === MODE_IN_STATION) {
      if (!hangarRest) return false;
      const roomId = (ctx.world.character as StationCharacterState).stationRoomId;
      if (roomId !== hangarRest.hangar.roomId) return false;
    } else if (hangarRest) {
      // On foot outdoors: hangar-parked ships are boarded from the hangar
      // deck (station mode), never by world-switching through station walls.
      return false;
    }
    if (!isNearParkedShipPad(ctx.world.character, ship)) return false;
    if (!ctx.shipPhysics) {
      void deps.deckPhysics.warmShipDeckPhysics();
      return false;
    }
    const rig = getActiveShipRig(ctx.world);
    const mountRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    const local = worldToShipLocal(ship, ctx.world.character.position);
    ctx.shipPhysics.setPadEnabled(true);
    ctx.shipPhysics.setPadRestHeight(getShipRestHeightMeters());
    teleportShipPlayerLocal(ctx.shipPhysics, {
      right: local.right,
      up: local.up,
      forward: local.forward,
    });
    syncShipArticulationColliders(
      ctx.shipPhysics,
      mountRig,
      getShipLayout().doors.map((door) => door.id),
    );
    // floorUp is mesh height; createDeckCharacterState adds DECK_FLOOR_OFFSET.
    ctx.world.character = createDeckCharacterState(
      ship,
      { right: local.right, forward: local.forward },
      undefined,
      mountRig,
      local.up - DECK_FLOOR_OFFSET_METERS,
    );
    ctx.world.mode = MODE_ON_SHIP_DECK;
    ctx.world.shipExteriorWalk = true;
    ctx.world.prompt = "";
    return true;
  }

  /**
   * Leave ship-local Rapier for planet/station at the character's current feet
   * (walked off the pad / freefall). Keeps ship physics warm for re-entry.
   */
  function leaveShipDeck(): void {
    const ship = getActiveShipBody(ctx.world);
    const feet = ctx.world.character.position;
    const facing = ctx.world.character.forward;
    ctx.world.shipExteriorWalk = false;

    const hangarRest = sampleHangarRest(
      ctx.stationFrame,
      ship.position,
      getShipRestHeightMeters(),
    );
    if (hangarRest) {
      const local = worldToStationLocal(ctx.stationFrame, feet);
      ctx.world.character = createStationCharacterAt(
        ctx.stationFrame,
        hangarRest.hangar.roomId,
        { right: local.right, forward: local.forward },
        {
          right: dot(facing, ctx.stationFrame.right),
          forward: dot(facing, ctx.stationFrame.forward),
        },
        hangarRest.surfaceUp,
      );
      if (ctx.physics) {
        teleportStationPlayer(ctx.physics, ctx.stationFrame, ctx.world.character.position);
      }
      ctx.world.mode = MODE_IN_STATION;
      return;
    }

    const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, feet);
    const groundPosition = surfacePointFromPosition(
      feet,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    ctx.world.character = createCharacterState(groundPosition, facing);
    ctx.world.mode = MODE_ON_FOOT;
  }

  return { tryEnterShipPadInterest, leaveShipDeck };
}
