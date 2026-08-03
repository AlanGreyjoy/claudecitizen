import type {
  CameraOrbit,
  CharacterState,
  FlightBody,
  GameMode,
  Planet,
  Pose,
  ShipCameraView,
} from '../types';
import type { LadderClimbState } from '../world/ladders';
import type { ChairOccupancyState } from '../world/chair-seats';
import type { ShipInstance } from '../flight/ship-instance';
import {
  clearShipWorld,
  getShipInstance,
  registerShipInstance,
} from '../flight/ship-world';
import { createShipInstance } from '../flight/ship-instance';
import type { DeckCharacterState } from './ship-deck';
import type { ShipRigState } from './ship-rig';
import type { StationCharacterState } from './station-walk';
import { MODE_IN_SHIP, MODE_IN_STATION, MODE_ON_FOOT } from './modes';
import type { HangarOpenSpaceExitWorldPose } from '../world/hangar-open-space-exit';
import {
  createPilotSpawnCharacter,
  createSpaceSpawnShip,
  createSpaceSpawnShipAtPose,
  createSpawnCharacter,
  createSpawnShip,
  initialCameraYaw,
} from './spawn';
import { createStationSpawnCharacter, initialStationCameraYaw } from './station-walk';
import {
  DEFAULT_SHIP_LAYOUT,
  getShipLayoutForPrefab,
} from './ship-layout';
import { NO_SHIP_PREFAB_ID } from '../world/ships';
import type { ShipFlightMode } from '../flight/flight-modes';
import {
  createQuantumTravelState,
  type QuantumTravelState,
} from '../flight/quantum-travel';
import {
  createPlayerVitals,
  type PlayerSurvivalVitals,
  type PlayerVitals,
} from './vitals';

export type TransitionType = 'sit' | 'stand' | 'lie' | 'get-up' | 'chair-sit' | 'chair-stand';

export interface WorldTransition {
  duration: number;
  elapsed: number;
  endPose: Pose;
  startPose: Pose;
  type: TransitionType;
}

export type WorldCharacter = CharacterState &
  Partial<
    Pick<
      DeckCharacterState,
      | 'deckLocal'
      | 'deckZone'
      | 'airborneOffDeckFrames'
      | 'shipVerticalVelocity'
      | 'deckExitGraceFrames'
    >
  > &
  Partial<
    Pick<
      StationCharacterState,
      'stationLocal' | 'stationRoomId' | 'stationVerticalVelocity'
    >
  >;

export interface WorldState {
  cameraOrbit: CameraOrbit;
  /** Piloting camera: seated cockpit eye (default) or external chase view. */
  shipCameraView: ShipCameraView;
  shipCameraZoom: number;
  character: WorldCharacter;
  mode: GameMode;
  /**
   * True while ship-local Rapier is active but feet are on planet ground outside
   * the hull/ramp (near a parked ship). Camera/HUD treat this as on-foot.
   */
  shipExteriorWalk: boolean;
  prompt: string;
  /** Id of the ship the player is piloting / boarding. */
  activeShipId: string;
  /** Active bunk id while entering / in / leaving bed. */
  activeBedId: string | null;
  /** Furniture chair occupancy while entering / in / leaving chair. */
  chairOccupancy: ChairOccupancyState | null;
  transition: WorldTransition | null;
  /** Hangar the ship was delivered to via the lobby terminal, if called. */
  assignedHangar: number | null;
  /**
   * Set while the player is attached to a ladder. Climbing is a sub-state of
   * the walking modes, not a mode of its own: the player is still in the
   * station / on the ship deck, so camera, HUD, and combat gating stay put.
   */
  ladderClimb: LadderClimbState | null;
  /** 0..1 black overlay opacity used for scripted fades. */
  screenFade: number;
  /** Piloting sub-mode: traverse, combat, or nav (quantum). */
  flightMode: ShipFlightMode;
  quantum: QuantumTravelState;
  /** Active SystemDocument id (System Map). */
  systemId: string;
  /** Primary interactable system station instance id, when authored. */
  activeStationInstanceId: string | null;
  /** Personal status for HaloBand / HUD (presentation; non-lethal for now). */
  vitals: PlayerVitals;
  /** Fail-closed state while the private survival record cannot be persisted. */
  vitalsSyncLocked: boolean;
}

export const PLAYER_SHIP_INSTANCE_ID = 'player-ship-primary';

export function getActiveShip(world: WorldState): ShipInstance {
  const ship = getShipInstance(world.activeShipId);
  if (!ship) {
    throw new Error(`Missing ship instance "${world.activeShipId}".`);
  }
  return ship;
}

export function getActiveShipBody(world: WorldState): FlightBody {
  return getActiveShip(world).body;
}

export function getActiveShipRig(world: WorldState): ShipRigState {
  return getActiveShip(world).rig;
}

export function createWorldState(
  planet: Planet,
  seed: number,
  options: {
    spawn?: 'station' | 'surface';
    /**
     * How the player got here. `in-ship` is a fly-through scene-exit: the
     * session is torn down and rebuilt, so without this the pilot would be
     * dropped on foot at the destination's Player Start mid-flight.
     */
    arrival?: 'default' | 'in-ship';
    /**
     * Hangar-mouth pose for an `in-ship` arrival. When unset, open-space spawn
     * falls back to the generic landing-site orbit altitude.
     */
    spaceSpawnPose?: HangarOpenSpaceExitWorldPose | null;
    planetId?: string;
    systemId?: string;
    activeStationInstanceId?: string | null;
    /** Hull the player ship spawns as. Unset keeps the default ship. */
    shipPrefabId?: string | null;
    /** Ship playtest spawn: boardable hull instead of a sealed one. */
    shipRampDownOnSpawn?: boolean;
    vitals?: PlayerSurvivalVitals;
  } = {},
): WorldState {
  clearShipWorld();
  const prefabId = options.shipPrefabId ?? NO_SHIP_PREFAB_ID;
  const layout = getShipLayoutForPrefab(prefabId) ?? DEFAULT_SHIP_LAYOUT;
  const inShip = options.arrival === 'in-ship';
  const body = inShip
    ? (options.spaceSpawnPose
      ? createSpaceSpawnShipAtPose(options.spaceSpawnPose)
      : createSpaceSpawnShip(planet, seed))
    : createSpawnShip(planet, seed);
  const planetId = options.planetId ?? 'asteron';
  const instance = createShipInstance({
    id: PLAYER_SHIP_INSTANCE_ID,
    prefabId,
    layout,
    body,
    instanceId: inShip ? `space:${options.systemId ?? 'default'}` : `planet:${planetId}`,
    // Gear and ramp stay stowed on a flying arrival: the player is mid-flight,
    // not parked.
    rig: inShip
      ? { gearDown: false, rampDown: false }
      : { gearDown: true, rampDown: options.shipRampDownOnSpawn ?? false },
  });
  registerShipInstance(instance);

  const spawnSurface = !inShip && options.spawn === 'surface';
  let character: CharacterState;
  if (inShip) character = createPilotSpawnCharacter(body);
  else if (spawnSurface) character = createSpawnCharacter(planet, seed, body);
  else character = createStationSpawnCharacter(planet);
  return {
    cameraOrbit: {
      pitchRadians: -0.12,
      yawRadians: spawnSurface ? initialCameraYaw(character) : initialStationCameraYaw(),
      zoomDistance: 5.2,
    },
    shipCameraView: 'cockpit',
    shipCameraZoom: 1.0,
    character,
    mode: inShip ? MODE_IN_SHIP : (spawnSurface ? MODE_ON_FOOT : MODE_IN_STATION),
    shipExteriorWalk: false,
    prompt: '',
    activeShipId: instance.id,
    activeBedId: null,
    chairOccupancy: null,
    transition: null,
    assignedHangar: null,
    ladderClimb: null,
    screenFade: 0,
    flightMode: 'traverse',
    quantum: createQuantumTravelState(),
    systemId: options.systemId ?? 'default',
    activeStationInstanceId: options.activeStationInstanceId ?? null,
    vitals: createPlayerVitals(options.vitals),
    vitalsSyncLocked: false,
  };
}
