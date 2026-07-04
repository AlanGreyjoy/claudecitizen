import {
  integrateFlightBody,
  integrateHoveringShip,
} from "../flight/flight_body";
import { regenerateShipShields } from "../flight/ship_instance";
import { listShipInstances } from "../flight/ship_world";
import { createPlayerControls } from "../flight/player_controls";
import {
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from "../player/modes";
import {
  placeCharacterOnSurface,
  updateCharacterState,
} from "../player/character_controller";
import {
  createDeckCharacterState,
  getShipWalkZone,
  getShipWalkZones,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  ladderInteractPrompt,
  resolveLadderInteraction,
  seatInteractPrompt,
  traverseLadder,
  updateCharacterOnDeck,
  type DeckCharacterState,
  type DeckLocal,
} from "../player/ship_deck";
import { getShipLayout, getShipRestHeightMeters } from "../player/ship_layout";
import {
  getRampDismountGroundLocal,
  isShipParked,
  localOffsetToWorld,
  nearShipRampOutside,
  sampleRampMount,
} from "../player/ship_interaction";
import {
  doorBlends,
  isDoorPassable,
  isRampUsable,
  updateShipRig,
} from "../player/ship_rig";
import {
  beginElevatorRide,
  callShipToHangar,
  elevatorDestinationFor,
  resolveStationInteraction,
  updateElevatorRide,
  type StationInteraction,
} from "../player/station_interaction";
import {
  createStationCharacterAt,
  stationYawForDir,
  updateCharacterInStation,
  type StationCharacterState,
} from "../player/station_walk";
import {
  beginSitTransition,
  beginStandTransition,
  updateTransition,
} from "../player/transitions";
import { createWorldState, getActiveShip, getActiveShipBody, getActiveShipRig, type WorldState } from "../player/world_state";
import {
  getStationFrame,
  getStationHangars,
  sampleHangarRest,
  worldToStationLocal,
} from "../world/station";
import { sampleRenderablePlanetSurface } from "../world/planet_surface";
import type { HudUpdateParams } from "../render/effects";
import type { SpikeRenderer } from "../render/main";
import type { Planet, Vec3 } from "../types";
import type { GameBootstrap } from "../net/api";
import type { WorldClient } from "../net/world_client";

type PlayerControls = ReturnType<typeof createPlayerControls>;

export interface GameLoopOptions {
  planet: Planet;
  seed: number;
  controls: PlayerControls;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  network?: WorldClient | null;
  bootstrap?: GameBootstrap | null;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
}

export function createGameLoop({
  planet,
  seed,
  controls,
  renderer,
  rendererError,
  network = null,
  bootstrap = null,
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

  controls.setOrbitFacing(
    world.cameraOrbit.yawRadians,
    world.cameraOrbit.pitchRadians,
  );

  // Console-only dev shortcuts (mirrors the __spikeScene diagnostic).
  window.__claudecitizenDev = {
    callShip: () => callShipToHangar(world, planet, seed)?.index ?? 0,
    teleportToHangar: (index: number) => {
      const hangars = getStationHangars();
      const hangar =
        hangars.find((entry) => entry.index === index) ?? hangars[0];
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
    controls.setOrbitFacing(
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
    );
    if (bootstrap) {
      network?.transition(
        bootstrap.spawn.apartmentInstanceId,
        bootstrap.spawn.stationRoomId,
      );
    }
    onResetPeak();
  }

  function stationPrompt(interaction: StationInteraction | null): string {
    if (!interaction) return "";
    switch (interaction.kind) {
      case "hab-lift-down":
        return "Press F — elevator to Lobby";
      case "hab-lift-up":
        return "Press F — elevator to Habs";
      case "terminal":
        return world.assignedHangar === null
          ? "Press F — call your ship to a hangar"
          : `Ship delivered to Hangar ${world.assignedHangar}`;
      case "hangar-bank":
        return world.assignedHangar === null
          ? "Press 1 / 2 / 3 — elevator to hangars"
          : `Press 1 / 2 / 3 — elevator to hangars (your ship: Hangar ${world.assignedHangar})`;
      case "hangar-lift-up":
        return "Press F — elevator to Lobby";
      case "prefab-elevator":
        return `Press F — elevator to ${interaction.marker.targetFloor}`;
      case "prefab-info":
        return interaction.prompt;
    }
  }

  function networkInstanceForInteraction(
    interaction: StationInteraction,
  ): string | null {
    if (!bootstrap) return null;
    switch (interaction.kind) {
      case "hab-lift-down":
      case "hangar-lift-up":
        return "station:public";
      case "hab-lift-up":
        return bootstrap.spawn.apartmentInstanceId;
      case "hangar-bank":
        return bootstrap.spawn.hangarInstanceId;
      case "prefab-elevator":
        if (interaction.marker.targetFloor === "hangar")
          return bootstrap.spawn.hangarInstanceId;
        if (interaction.marker.targetFloor === "hab")
          return bootstrap.spawn.apartmentInstanceId;
        return "station:public";
      case "terminal":
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
    network?.transition(instanceId, destination.roomId);
  }

  function updateShipSystems(dt: number): void {
    for (const instance of listShipInstances()) {
      const rig = instance.rig;
      rig.gearDown = instance.body.grounded;
      if (!isShipParked(instance.body)) rig.rampDown = false;
      updateShipRig(rig, dt);
      regenerateShipShields(instance, dt);
    }
  }

  /** Ramp toggle prompt/action for a character standing near the parked ship's tail. */
  function handleRampOutside(interactPressed: boolean): string | null {
    const ship = getActiveShipBody(world);
    const rig = getActiveShipRig(world);
    if (!isShipParked(ship)) return null;
    if (!nearShipRampOutside(world.character, ship)) return null;
    if (interactPressed) rig.rampDown = !rig.rampDown;
    return rig.rampDown ? "Press F — raise ramp" : "Press F — lower ramp";
  }

  /** Walking into the foot of the lowered ramp steps aboard. */
  function tryMountRamp(): boolean {
    const ship = getActiveShipBody(world);
    const rig = getActiveShipRig(world);
    if (!isShipParked(ship) || !isRampUsable(rig)) return false;
    const mount = sampleRampMount(world.character, ship);
    if (!mount) return false;
    world.character = createDeckCharacterState(ship, mount);
    world.mode = MODE_ON_SHIP_DECK;
    world.prompt = "";
    return true;
  }

  /** Steps off the ramp tip onto whatever the ship is parked on. */
  function dismountToGround(): void {
    const ship = getActiveShipBody(world);
    const groundPosition: Vec3 = localOffsetToWorld(ship, {
      ...getRampDismountGroundLocal(),
      up: 0,
    });
    const hangarRest = sampleHangarRest(
      stationFrame,
      ship.position,
      getShipRestHeightMeters(),
    );
    const facing = {
      x: -ship.forward.x,
      y: -ship.forward.y,
      z: -ship.forward.z,
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
    characterInput: ReturnType<PlayerControls["sampleCharacterInput"]>,
    actions: ReturnType<PlayerControls["consumeActions"]>,
    dt: number,
  ): void {
    world.character = updateCharacterInStation(
      world.character as StationCharacterState,
      stationFrame,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
    );

    if (tryMountRamp()) return;

    const rampPrompt = handleRampOutside(actions.interactPressed);
    if (rampPrompt !== null) {
      world.prompt = rampPrompt;
      return;
    }

    const interaction = resolveStationInteraction(
      world.character as StationCharacterState,
    );
    world.prompt = stationPrompt(interaction);
    if (!interaction) return;

    if (interaction.kind === "terminal") {
      if (actions.interactPressed && world.assignedHangar === null) {
        const hangar = callShipToHangar(world, planet, seed);
        if (hangar) world.prompt = `Ship delivered to Hangar ${hangar.index}`;
      }
      return;
    }

    if (interaction.kind === "hangar-bank") {
      if (actions.hangarDigit) {
        const destination = elevatorDestinationFor(
          interaction,
          actions.hangarDigit,
        );
        if (destination) {
          beginElevatorRide(world, destination);
          announceElevatorTransition(interaction, destination);
        }
      }
      return;
    }

    if (actions.interactPressed) {
      const destination = elevatorDestinationFor(interaction);
      if (destination) {
        beginElevatorRide(world, destination);
        announceElevatorTransition(interaction, destination);
      }
    }
  }

  /** Standing inside any zone this door gates — closing it would trap the player. */
  function standingInDoorway(doorId: string, deckLocal: DeckLocal): boolean {
    return getShipWalkZones().some(
      (zone) =>
        typeof zone.gate === "object" &&
        zone.gate.doorId === doorId &&
        deckLocal.right >= zone.minRight &&
        deckLocal.right <= zone.maxRight &&
        deckLocal.forward >= zone.minForward &&
        deckLocal.forward <= zone.maxForward,
    );
  }

  function updateDeckMode(
    characterInput: ReturnType<PlayerControls["sampleCharacterInput"]>,
    actions: ReturnType<PlayerControls["consumeActions"]>,
    dt: number,
  ): void {
    const instance = getActiveShip(world);
    const ship = instance.body;
    const rig = instance.rig;
    instance.body = integrateHoveringShip(ship, dt, planet, seed, {
      maxSpeedMps: instance.spec.maxSpeedMps,
    });
    const parked = isShipParked(instance.body);
    const gates = {
      rampWalkable: parked && isRampUsable(rig),
      isDoorOpen: (doorId: string) => isDoorPassable(rig, doorId),
    };
    const result = updateCharacterOnDeck(
      world.character as DeckCharacterState,
      instance.body,
      gates,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
    );
    world.character = result.state;

    if (result.dismounted) {
      dismountToGround();
      return;
    }

    const deckLocal = result.state.deckLocal;

    const seatNearby = nearestSeat(deckLocal);
    if (seatNearby) {
      world.prompt = seatInteractPrompt(seatNearby);
      if (actions.interactPressed && seatNearby.role === "pilot")
        beginSitTransition(world);
      return;
    }

    const doorNearby = nearestDoor(deckLocal);
    if (doorNearby) {
      const door = getShipLayout().doors.find(
        (entry) => entry.id === doorNearby.doorId,
      );
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

    const ladder = resolveLadderInteraction(
      deckLocal,
      gates,
      result.state.deckZone,
    );
    if (ladder) {
      world.prompt = ladderInteractPrompt(ladder.direction);
      if (actions.interactPressed) {
        const next = traverseLadder(
          world.character as DeckCharacterState,
          ladder.zone,
          ladder.direction,
          gates,
          instance.body,
        );
        if (next) world.character = next;
      }
      return;
    }

    const standingOnRamp =
      getShipWalkZone(result.state.deckZone)?.gate === "ramp";
    if (parked && nearRampPanel(deckLocal) && !standingOnRamp) {
      world.prompt = rig.rampDown
        ? "Press F — raise ramp"
        : "Press F — lower ramp";
      if (actions.interactPressed) rig.rampDown = !rig.rampDown;
      return;
    }

    world.prompt = "";
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
        world.prompt = handleRampOutside(actions.interactPressed) ?? "";
      }
    } else if (world.mode === MODE_IN_SHIP) {
      const instance = getActiveShip(world);
      instance.body = integrateFlightBody(
        instance.body,
        controls.sampleFlightInput(),
        dt,
        planet,
        seed,
        { maxSpeedMps: instance.spec.maxSpeedMps },
      );
      world.prompt = "Hold F — look around · Hold Y — get up";
      if (actions.exitSeatPressed) {
        beginStandTransition(world);
      }
    } else if (world.mode === MODE_ON_SHIP_DECK) {
      updateDeckMode(characterInput, actions, dt);
    } else if (world.mode === MODE_IN_STATION) {
      updateStationMode(characterInput, actions, dt);
    } else if (world.mode === MODE_RIDING_ELEVATOR) {
      const ride = updateElevatorRide(world, stationFrame, dt);
      world.prompt = ride.destination ? `${ride.destination.label}…` : "";
      if (ride.teleportedNow && ride.destination) {
        controls.setOrbitFacing(stationYawForDir(ride.destination.face));
      }
    } else {
      updateTransition(world, dt, transitionContext);
    }

    updateShipSystems(dt);
    network?.publishPresence(world);

    const activeShip = getActiveShipBody(world);
    const shipSurface = sampleRenderablePlanetSurface(
      planet,
      seed,
      activeShip.position,
    );
    const focusPosition =
      world.mode === MODE_IN_SHIP
        ? activeShip.position
        : world.character.position;
    const focusVelocity =
      world.mode === MODE_IN_SHIP
        ? activeShip.velocity
        : world.character.velocity;
    const focusSurface = sampleRenderablePlanetSurface(
      planet,
      seed,
      focusPosition,
    );

    let renderStats = null;
    try {
      renderStats =
        renderer?.render({
          cameraOrbit: world.cameraOrbit,
          cameraView: world.cameraView,
          shipCameraView: world.shipCameraView,
          shipCameraZoom: world.shipCameraZoom,
          seatLook: camera.seatLook,
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
          ship: activeShip,
          activeShipId: world.activeShipId,
          ships: listShipInstances().map((instance) => ({
            id: instance.id,
            prefabId: instance.prefabId,
            body: instance.body,
            rig: {
              gear01: instance.rig.gear01,
              ramp01: instance.rig.ramp01,
              doors: doorBlends(instance.rig),
            },
            vitals: { ...instance.vitals },
            spec: {
              maxHp: instance.spec.maxHp,
              maxShields: instance.spec.maxShields,
            },
          })),
          shipRig: {
            gear01: getActiveShipRig(world).gear01,
            ramp01: getActiveShipRig(world).ramp01,
            doors: doorBlends(getActiveShipRig(world)),
          },
          networkEntities: network?.getRemoteEntities(nowMs) ?? [],
          shipZoneId: world.character.deckZone ?? null,
          stationRoomId: world.character.stationRoomId ?? null,
          timeSeconds: nowMs / 1000,
        }) ?? null;
    } catch (error) {
      console.error("ClaudeCitizen render frame failed.", error);
      frameRendererError = error;
    }
    window.__claudecitizenRenderStats = renderStats;
    window.__claudecitizenWorld = world;

    const focusForward =
      world.mode === MODE_IN_SHIP
        ? activeShip.forward
        : world.character.forward;

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
      shipPosition: activeShip.position,
      shipForward: activeShip.forward,
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
