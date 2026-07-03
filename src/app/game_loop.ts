import { integrateFlightBody, integrateHoveringShip } from '../flight/flight_body';
import { createPlayerControls } from '../flight/player_controls';
import {
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from '../player/modes';
import { placeCharacterOnSurface, updateCharacterState } from '../player/character_controller';
import {
  canReturnToPilot,
  createDeckCharacterState,
  getShipWalkZone,
  getShipWalkZones,
  nearestDoor,
  nearRampPanel,
  updateCharacterOnDeck,
  type DeckCharacterState,
  type DeckLocal,
} from '../player/ship_deck';
import { getShipLayout, getShipRestHeightMeters } from '../player/ship_layout';
import {
  getRampDismountGroundLocal,
  isShipParked,
  localOffsetToWorld,
  nearShipRampOutside,
  sampleRampMount,
} from '../player/ship_interaction';
import { doorBlends, isDoorPassable, isRampUsable, updateShipRig } from '../player/ship_rig';
import {
  beginElevatorRide,
  callShipToHangar,
  elevatorDestinationFor,
  resolveStationInteraction,
  updateElevatorRide,
  type StationInteraction,
} from '../player/station_interaction';
import {
  createStationCharacterAt,
  stationYawForDir,
  updateCharacterInStation,
  type StationCharacterState,
} from '../player/station_walk';
import { beginSitTransition, beginStandTransition, updateTransition } from '../player/transitions';
import { createWorldState, type WorldState } from '../player/world_state';
import {
  getStationFrame,
  getStationHangars,
  sampleHangarRest,
  worldToStationLocal,
} from '../world/station';
import { sampleRenderablePlanetSurface } from '../world/planet_surface';
import type { HudUpdateParams } from '../render/effects';
import type { SpikeRenderer } from '../render/main';
import type { Planet, Vec3 } from '../types';

type PlayerControls = ReturnType<typeof createPlayerControls>;

export interface GameLoopOptions {
  planet: Planet;
  seed: number;
  controls: PlayerControls;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
}

export function createGameLoop({
  planet,
  seed,
  controls,
  renderer,
  rendererError,
  onHudUpdate,
  onResetPeak,
}: GameLoopOptions) {
  let world: WorldState = createWorldState(planet, seed);
  let lastMs = performance.now();
  let frameRendererError: unknown = rendererError;
  const stationFrame = getStationFrame(planet);

  const transitionContext = {
    planet,
    seed,
    setControlsMode: controls.setMode.bind(controls),
  };

  controls.setOrbitFacing(world.cameraOrbit.yawRadians, world.cameraOrbit.pitchRadians);

  // Console-only dev shortcuts (mirrors the __spikeScene diagnostic).
  window.__claudecitizenDev = {
    callShip: () => callShipToHangar(world, planet, seed)?.index ?? 0,
    teleportToHangar: (index: number) => {
      const hangars = getStationHangars();
      const hangar = hangars.find((entry) => entry.index === index) ?? hangars[0];
      if (!hangar) return;
      world.character = createStationCharacterAt(
        stationFrame,
        hangar.roomId,
        { right: hangar.centerRight, forward: -12 },
        { right: 0, forward: 1 },
      );
      world.mode = MODE_IN_STATION;
      world.stationElevator = null;
      world.screenFade = 0;
    },
    face: (yawRadians: number, pitchRadians?: number) =>
      controls.setOrbitFacing(yawRadians, pitchRadians),
  };

  function resetWorld(): void {
    world = createWorldState(planet, seed);
    controls.setMode(MODE_ON_FOOT);
    controls.setOrbitFacing(world.cameraOrbit.yawRadians, world.cameraOrbit.pitchRadians);
    onResetPeak();
  }

  function stationPrompt(interaction: StationInteraction | null): string {
    if (!interaction) return '';
    switch (interaction.kind) {
      case 'hab-lift-down':
        return 'Press F — elevator to Lobby';
      case 'hab-lift-up':
        return 'Press F — elevator to Habs';
      case 'terminal':
        return world.assignedHangar === null
          ? 'Press F — call your ship to a hangar'
          : `Ship delivered to Hangar ${world.assignedHangar}`;
      case 'hangar-bank':
        return world.assignedHangar === null
          ? 'Press 1 / 2 / 3 — elevator to hangars'
          : `Press 1 / 2 / 3 — elevator to hangars (your ship: Hangar ${world.assignedHangar})`;
      case 'hangar-lift-up':
        return 'Press F — elevator to Lobby';
      case 'prefab-elevator':
        return `Press F — elevator to ${interaction.marker.targetFloor}`;
      case 'prefab-info':
        return interaction.prompt;
    }
  }

  function updateShipSystems(dt: number): void {
    const rig = world.shipRig;
    rig.gearDown = world.ship.grounded;
    if (!isShipParked(world.ship)) rig.rampDown = false;
    updateShipRig(rig, dt);
  }

  /** Ramp toggle prompt/action for a character standing near the parked ship's tail. */
  function handleRampOutside(interactPressed: boolean): string | null {
    if (!isShipParked(world.ship)) return null;
    if (!nearShipRampOutside(world.character, world.ship)) return null;
    const rig = world.shipRig;
    if (interactPressed) rig.rampDown = !rig.rampDown;
    return rig.rampDown ? 'Press F — raise ramp' : 'Press F — lower ramp';
  }

  /** Walking into the foot of the lowered ramp steps aboard. */
  function tryMountRamp(): boolean {
    if (!isShipParked(world.ship) || !isRampUsable(world.shipRig)) return false;
    const mount = sampleRampMount(world.character, world.ship);
    if (!mount) return false;
    world.character = createDeckCharacterState(world.ship, mount);
    world.mode = MODE_ON_SHIP_DECK;
    world.prompt = '';
    return true;
  }

  /** Steps off the ramp tip onto whatever the ship is parked on. */
  function dismountToGround(): void {
    const groundPosition: Vec3 = localOffsetToWorld(world.ship, {
      ...getRampDismountGroundLocal(),
      up: 0,
    });
    const hangarRest = sampleHangarRest(
      stationFrame,
      world.ship.position,
      getShipRestHeightMeters(),
    );
    const facing = {
      x: -world.ship.forward.x,
      y: -world.ship.forward.y,
      z: -world.ship.forward.z,
    };
    if (hangarRest) {
      const local = worldToStationLocal(stationFrame, groundPosition);
      world.character = createStationCharacterAt(
        stationFrame,
        hangarRest.hangar.roomId,
        { right: local.right, forward: local.forward },
        { right: 0, forward: -1 },
      );
      world.mode = MODE_IN_STATION;
      return;
    }
    world.character = placeCharacterOnSurface(groundPosition, facing);
    world.mode = MODE_ON_FOOT;
  }

  function updateStationMode(
    characterInput: ReturnType<PlayerControls['sampleCharacterInput']>,
    actions: ReturnType<PlayerControls['consumeActions']>,
    dt: number,
  ): void {
    world.character = updateCharacterInStation(
      world.character as StationCharacterState,
      stationFrame,
      characterInput,
      dt,
    );

    if (tryMountRamp()) return;

    const rampPrompt = handleRampOutside(actions.interactPressed);
    if (rampPrompt !== null) {
      world.prompt = rampPrompt;
      return;
    }

    const interaction = resolveStationInteraction(world.character as StationCharacterState);
    world.prompt = stationPrompt(interaction);
    if (!interaction) return;

    if (interaction.kind === 'terminal') {
      if (actions.interactPressed && world.assignedHangar === null) {
        const hangar = callShipToHangar(world, planet, seed);
        if (hangar) world.prompt = `Ship delivered to Hangar ${hangar.index}`;
      }
      return;
    }

    if (interaction.kind === 'hangar-bank') {
      if (actions.hangarDigit) {
        const destination = elevatorDestinationFor(interaction, actions.hangarDigit);
        if (destination) beginElevatorRide(world, destination);
      }
      return;
    }

    if (actions.interactPressed) {
      const destination = elevatorDestinationFor(interaction);
      if (destination) beginElevatorRide(world, destination);
    }
  }

  /** Standing inside any zone this door gates — closing it would trap the player. */
  function standingInDoorway(doorId: string, deckLocal: DeckLocal): boolean {
    return getShipWalkZones().some(
      (zone) =>
        typeof zone.gate === 'object' &&
        zone.gate.doorId === doorId &&
        deckLocal.right >= zone.minRight &&
        deckLocal.right <= zone.maxRight &&
        deckLocal.forward >= zone.minForward &&
        deckLocal.forward <= zone.maxForward,
    );
  }

  function updateDeckMode(
    characterInput: ReturnType<PlayerControls['sampleCharacterInput']>,
    actions: ReturnType<PlayerControls['consumeActions']>,
    dt: number,
  ): void {
    world.ship = integrateHoveringShip(world.ship, dt, planet, seed);
    const rig = world.shipRig;
    const parked = isShipParked(world.ship);
    const gates = {
      rampWalkable: parked && isRampUsable(rig),
      isDoorOpen: (doorId: string) => isDoorPassable(rig, doorId),
    };
    const result = updateCharacterOnDeck(
      world.character as DeckCharacterState,
      world.ship,
      gates,
      characterInput,
      dt,
    );
    world.character = result.state;

    if (result.dismounted) {
      dismountToGround();
      return;
    }

    const deckLocal = result.state.deckLocal;

    if (canReturnToPilot(deckLocal)) {
      world.prompt = 'Press F — take the seat';
      if (actions.interactPressed) beginSitTransition(world);
      return;
    }

    const doorNearby = nearestDoor(deckLocal);
    if (doorNearby) {
      const door = getShipLayout().doors.find((entry) => entry.id === doorNearby.doorId);
      const doorRig = rig.doors[doorNearby.doorId];
      if (door && doorRig) {
        world.prompt = doorRig.isOpen
          ? `Press F — close ${door.label}`
          : `Press F — open ${door.label}`;
        if (
          actions.interactPressed &&
          !(doorRig.isOpen && standingInDoorway(door.id, deckLocal))
        ) {
          doorRig.isOpen = !doorRig.isOpen;
        }
        return;
      }
    }

    const standingOnRamp = getShipWalkZone(result.state.deckZone)?.gate === 'ramp';
    if (parked && nearRampPanel(deckLocal) && !standingOnRamp) {
      world.prompt = rig.rampDown ? 'Press F — raise ramp' : 'Press F — lower ramp';
      if (actions.interactPressed) rig.rampDown = !rig.rampDown;
      return;
    }

    world.prompt = '';
  }

  function frame(nowMs: number): void {
    const dt = Math.min((nowMs - lastMs) / 1000, 1 / 30);
    lastMs = nowMs;

    controls.setMode(world.mode === MODE_IN_SHIP ? MODE_IN_SHIP : MODE_ON_FOOT);
    const actions = controls.consumeActions();
    const camera = controls.sampleCameraState(dt);
    world.cameraOrbit = {
      pitchRadians: camera.pitchRadians,
      yawRadians: camera.yawRadians,
      zoomDistance: camera.zoomDistance,
    };
    world.cameraView = camera.cameraView;
    world.shipCameraView = camera.shipCameraView;
    world.shipCameraZoom = camera.shipZoomDistance;

    const characterInput = controls.sampleCharacterInput();

    if (world.mode === MODE_ON_FOOT) {
      world.character = updateCharacterState(
        world.character,
        {
          ...characterInput,
          jumpPressed: actions.jumpPressed,
        },
        dt,
        planet,
        seed,
      );
      if (!tryMountRamp()) {
        world.prompt = handleRampOutside(actions.interactPressed) ?? '';
      }
    } else if (world.mode === MODE_IN_SHIP) {
      world.ship = integrateFlightBody(
        world.ship,
        controls.sampleFlightInput(),
        dt,
        planet,
        seed,
      );
      world.prompt = 'Press F — get up';
      if (actions.interactPressed) {
        beginStandTransition(world);
      }
    } else if (world.mode === MODE_ON_SHIP_DECK) {
      updateDeckMode(characterInput, actions, dt);
    } else if (world.mode === MODE_IN_STATION) {
      updateStationMode(characterInput, actions, dt);
    } else if (world.mode === MODE_RIDING_ELEVATOR) {
      const ride = updateElevatorRide(world, stationFrame, dt);
      world.prompt = ride.destination ? `${ride.destination.label}…` : '';
      if (ride.teleportedNow && ride.destination) {
        controls.setOrbitFacing(stationYawForDir(ride.destination.face));
      }
    } else {
      updateTransition(world, dt, transitionContext);
    }

    updateShipSystems(dt);

    const shipSurface = sampleRenderablePlanetSurface(planet, seed, world.ship.position);
    const focusPosition =
      world.mode === MODE_IN_SHIP ? world.ship.position : world.character.position;
    const focusVelocity =
      world.mode === MODE_IN_SHIP ? world.ship.velocity : world.character.velocity;
    const focusSurface = sampleRenderablePlanetSurface(planet, seed, focusPosition);

    let renderStats = null;
    try {
      renderStats = renderer?.render({
        cameraOrbit: world.cameraOrbit,
        cameraView: world.cameraView,
        shipCameraView: world.shipCameraView,
        shipCameraZoom: world.shipCameraZoom,
        character:
          world.mode === MODE_IN_SHIP
            ? null
            : {
                animation: world.character.animation,
                forward: world.character.forward,
                position: world.character.position,
                up: world.character.up,
              },
        mode: world.mode,
        prompt: world.prompt,
        ship: world.ship,
        shipRig: {
          gear01: world.shipRig.gear01,
          ramp01: world.shipRig.ramp01,
          doors: doorBlends(world.shipRig),
        },
        shipZoneId: world.character.deckZone ?? null,
        stationRoomId: world.character.stationRoomId ?? null,
        timeSeconds: nowMs / 1000,
      }) ?? null;
    } catch (error) {
      console.error('ClaudeCitizen render frame failed.', error);
      frameRendererError = error;
    }
    window.__claudecitizenRenderStats = renderStats;
    window.__claudecitizenWorld = world;

    const focusForward =
      world.mode === MODE_IN_SHIP ? world.ship.forward : world.character.forward;

    onHudUpdate({
      world,
      focusSurface,
      focusVelocity,
      shipSurface,
      renderStats: renderStats ?? null,
      rendererError: frameRendererError,
      rendererMode: renderer?.rendererMode,
      planet,
      isPointerLocked: controls.isPointerLocked(),
      seed,
      focusPosition,
      focusForward,
      shipPosition: world.ship.position,
      shipForward: world.ship.forward,
      characterPosition: world.character.position,
      nowMs,
    });

    requestAnimationFrame(frame);
  }

  function start(): void {
    requestAnimationFrame((now) => {
      lastMs = now;
      requestAnimationFrame(frame);
    });
  }

  return {
    resetWorld,
    start,
  };
}
