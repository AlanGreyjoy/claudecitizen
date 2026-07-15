import {
  integrateFlightBody,
  integrateHoveringShip,
} from "../flight/flight_body";
import { cycleFlightMode } from "../flight/flight_modes";
import {
  advanceQuantumTravel,
  buildNavPrompt,
  evaluateQuantumEligibility,
  tryBeginQuantumTravel,
} from "../flight/quantum_travel";
import { regenerateShipShields } from "../flight/ship_instance";
import { getShipInstance, listShipInstances, removeShipInstance } from "../flight/ship_world";
import { type createPlayerControls } from "./player_controls";
import type { KeyboardActionId } from "../flight/input_settings";
import {
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
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
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getDefaultDeckSpawnLocal,
  getShipWalkZones,
  isOnShipRampDeck,
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
import { getShipLayout, getShipLayoutForPrefab, getShipRestHeightMeters, usesColliderDeck } from "../player/ship_layout";
import {
  getRampDismountGroundLocal,
  isShipParked,
  localOffsetToWorld,
  getShipRight,
  nearShipRampOutside,
  sampleRampBoarding,
  sampleRampMount,
  worldToShipLocal,
} from "../player/ship_interaction";
import {
  doorBlends,
  isDoorPassable,
  isRampUsable,
  updateShipRig,
} from "../player/ship_rig";
import { DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD } from "../physics/colliders";
import {
  createShipPhysics,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
  type ShipPhysics,
} from "../physics/ship_physics";
import { playSfx } from "../audio/sfx";
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
import { createWorldState, getActiveShip, getActiveShipBody, getActiveShipRig, PLAYER_SHIP_INSTANCE_ID, type WorldState } from "../player/world_state";
import type { AvmsTerminalController } from "../render/effects/hud/avms_terminal";
import type { BuildTerminalController } from "../render/effects/hud/build_terminal";
import type { HangarBuildController } from "../player/hangar_build/build_controller";
import type { BuildPropColliderRuntime } from "../player/hangar_build/prop_colliders";
import { buildRoomForArea } from "../player/hangar_build/validation";
import type { HangarPropRenderer } from "../render/hangar/prop_instances";
import { pickStationFloorPoint } from "../render/hangar/prop_instances";
import {
  getHangarByIndex,
  getStationFrame,
  getStationHangars,
  getStationLayoutOverride,
  sampleHangarRest,
  worldToStationLocal,
} from "../world/station";
import { dot, normalize } from "../math/vec3";
import { createSoundSceneController, type SoundListenerPose } from "../audio/sound_scene";
import { resetAssignedHangarBay, setAssignedHangarBay } from "../net/api";
import { sampleRenderablePlanetSurface } from "../world/planet_surface";
import type { HudUpdateParams } from "../render/effects";
import type { SpikeRenderer } from "../render/main";
import type { ColorCorrectionSettings, GameMode, Planet, SsaoSettings, Vec3 } from "../types";
import type { BuildArea, GameBootstrap } from "../net/api";
import type { WorldClient } from "../net/world_client";
import {
  syncDynamicColliders,
  teleportStationPlayer,
  type StationPhysics,
} from "../physics/station_physics";

type PlayerControls = ReturnType<typeof createPlayerControls>;

const STATION_SOUND_MODES = new Set<GameMode>([
  MODE_IN_STATION,
  MODE_RIDING_ELEVATOR,
]);
const SHIP_SOUND_MODES = new Set<GameMode>([
  MODE_IN_SHIP,
  MODE_ON_SHIP_DECK,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
]);

export interface BuildAreaRuntime {
  controller: HangarBuildController;
  propRenderer: HangarPropRenderer;
  propColliders: BuildPropColliderRuntime;
}

export interface BuildRuntime {
  areas: Partial<Record<BuildArea, BuildAreaRuntime>>;
  terminal: BuildTerminalController;
}

import type { PrefabDocument, PrefabEntity } from "../world/prefabs/schema";

export interface GameLoopOptions {
  planet: Planet;
  seed: number;
  controls: PlayerControls;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  network?: WorldClient | null;
  bootstrap?: GameBootstrap | null;
  avmsTerminal?: AvmsTerminalController | null;
  build?: BuildRuntime | null;
  physics?: StationPhysics | null;
  stationPrefab?: PrefabDocument | null;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
  isPaused?: () => boolean;
}

export function createGameLoop({
  planet,
  seed,
  controls,
  renderer,
  rendererError,
  network = null,
  bootstrap = null,
  avmsTerminal = null,
  build = null,
  physics = null,
  stationPrefab = null,
  onHudUpdate,
  onResetPeak,
  isPaused,
}: GameLoopOptions) {
  let world: WorldState = createWorldState(planet, seed);
  let shipPhysics: ShipPhysics | null = null;
  let shipPhysicsWarming = false;

  function disposeShipDeckPhysics(): void {
    shipPhysics?.dispose();
    shipPhysics = null;
  }

  async function warmShipDeckPhysics(): Promise<ShipPhysics | null> {
    if (!usesColliderDeck()) return null;
    if (shipPhysics) return shipPhysics;
    if (shipPhysicsWarming) return null;
    shipPhysicsWarming = true;
    try {
      const spawn = getDefaultDeckSpawnLocal();
      const floorHint = getDeckSpawnFloorHint(spawn);
      shipPhysics = await createShipPhysics(
        {
          right: spawn.right,
          up: floorHint + DECK_FLOOR_OFFSET_METERS,
          forward: spawn.forward,
        },
        getShipLayout().colliders,
      );
      return shipPhysics;
    } catch (error) {
      console.warn("Failed to create ship Rapier deck physics.", error);
      shipPhysics = null;
      return null;
    } finally {
      shipPhysicsWarming = false;
    }
  }

  void warmShipDeckPhysics();

  if (bootstrap?.hangar.assignedHangar) {
    world.assignedHangar = bootstrap.hangar.assignedHangar;
  }
  // Scan station prefab for animation components
  const stationAnimationStates: Record<string, { value: number; target: number; rate: number }> = {};
  if (stationPrefab) {
    const visit = (entity: PrefabEntity) => {
      for (const comp of entity.components ?? []) {
        if (comp.type === 'animation') {
          const duration = comp.duration ?? 1.0;
          const rate = duration > 0 ? 1 / duration : 1.5;
          const isOpen = comp.defaultOpen ?? false;
          stationAnimationStates[comp.id] = {
            value: isOpen ? 1 : 0,
            target: isOpen ? 1 : 0,
            rate,
          };
        }
      }
      for (const child of entity.children ?? []) {
        visit(child);
      }
    };
    visit(stationPrefab.root);
  }
  let lastNearbyPrefabInfoId: string | null = null;
  const soundScene = createSoundSceneController();

  function toggleStationAnimation(id: string): void {
    const anim = stationAnimationStates[id];
    if (anim) {
      anim.target = anim.target === 1 ? 0 : 1;
    }
  }

  // Tracks the last setEnabled state per animation id so we only toggle Rapier
  // colliders on threshold crossings, not every frame.
  const doorColliderEnabled: Record<string, boolean> = {};

  function updateStationAnimations(dt: number): void {
    let changed = false;
    for (const anim of Object.values(stationAnimationStates)) {
      if (anim.value !== anim.target) {
        if (anim.value < anim.target) {
          anim.value = Math.min(anim.target, anim.value + anim.rate * dt);
        } else {
          anim.value = Math.max(anim.target, anim.value - anim.rate * dt);
        }
        changed = true;
      }
    }
    if (changed || dt === 0) {
      const blends: Record<string, number> = {};
      for (const [id, anim] of Object.entries(stationAnimationStates)) {
        blends[id] = anim.value;
      }
      renderer?.getStationRoot()?.userData.updateAnimations?.(blends);
    }
    // Toggle Rapier colliders on/off as doors cross the open threshold.
    if (physics) {
      for (const [id, anim] of Object.entries(stationAnimationStates)) {
        const shouldEnable = anim.value < DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
        if (doorColliderEnabled[id] !== shouldEnable) {
          doorColliderEnabled[id] = shouldEnable;
          physics.setDoorColliderEnabled(id, shouldEnable);
        }
      }
    }
  }

  // Initial update of animation transforms + collider enabled states
  updateStationAnimations(0);

  let lastMs = performance.now();
  let running = false;
  let frameRendererError: unknown = rendererError;
  const stationFrame = getStationFrame(planet);

  function sceneVectorFromStation(vector: Vec3): Vec3 {
    return {
      x: -dot(vector, stationFrame.right),
      y: dot(vector, stationFrame.up),
      z: dot(vector, stationFrame.forward),
    };
  }

  function sceneVectorFromShip(vector: Vec3, ship: ReturnType<typeof getActiveShipBody>): Vec3 {
    const shipForward = normalize(ship.forward);
    return {
      x: -dot(vector, getShipRight(ship)),
      y: dot(vector, ship.up),
      z: dot(vector, shipForward),
    };
  }

  function updateSceneSounds(focusPosition: Vec3): void {
    const camera = renderer?.getCamera();
    const renderScale = renderer?.getRenderScale() ?? 1;
    const listenerWorld = camera
      ? {
          x: focusPosition.x + camera.position.x / renderScale,
          y: focusPosition.y + camera.position.y / renderScale,
          z: focusPosition.z + camera.position.z / renderScale,
        }
      : world.character.position;
    const matrix = camera?.matrixWorld.elements;
    const listenerForward = matrix
      ? { x: -matrix[8], y: -matrix[9], z: -matrix[10] }
      : world.character.forward;
    const listenerUp = matrix
      ? { x: matrix[4], y: matrix[5], z: matrix[6] }
      : world.character.up;

    if (STATION_SOUND_MODES.has(world.mode)) {
      const layout = getStationLayoutOverride();
      const local = worldToStationLocal(stationFrame, listenerWorld);
      const pose: SoundListenerPose = {
        position: { x: -local.right, y: local.up, z: local.forward },
        forward: sceneVectorFromStation(listenerForward),
        up: sceneVectorFromStation(listenerUp),
      };
      soundScene.setScene(
        stationPrefab ? `station:${stationPrefab.id}` : null,
        layout?.sounds ?? [],
      );
      soundScene.update(pose);
      return;
    }

    if (SHIP_SOUND_MODES.has(world.mode)) {
      const shipInstance = getActiveShip(world);
      const ship = shipInstance.body;
      const layout = getShipLayoutForPrefab(shipInstance.prefabId);
      const local = worldToShipLocal(ship, listenerWorld);
      soundScene.setScene(
        `ship:${shipInstance.id}:${shipInstance.prefabId}`,
        layout.sounds,
      );
      soundScene.update({
        position: { x: -local.right, y: local.up, z: local.forward },
        forward: sceneVectorFromShip(listenerForward, ship),
        up: sceneVectorFromShip(listenerUp, ship),
      });
      return;
    }

    soundScene.setScene(null, []);
  }

  const transitionContext = {
    planet,
    seed,
    setControlsMode: controls.setMode.bind(controls),
    onDeckEntered: (
      local: { right: number; forward: number },
      floorUp: number,
    ) => {
      if (!usesColliderDeck()) return;
      if (!shipPhysics) {
        void warmShipDeckPhysics().then((physics) => {
          if (!physics) return;
          teleportShipPlayerLocal(physics, {
            right: local.right,
            up: floorUp + DECK_FLOOR_OFFSET_METERS,
            forward: local.forward,
          });
        });
        return;
      }
      teleportShipPlayerLocal(shipPhysics, {
        right: local.right,
        up: floorUp + DECK_FLOOR_OFFSET_METERS,
        forward: local.forward,
      });
    },
  };

  controls.setOrbitFacing(
    world.cameraOrbit.yawRadians,
    world.cameraOrbit.pitchRadians,
  );

  function keyLabel(action: KeyboardActionId): string {
    return controls.getKeyboardActionLabel(action);
  }

  function pressInteractPrompt(text: string): string {
    return `Press ${keyLabel("interact")} — ${text}`;
  }

  function holdPrompt(action: KeyboardActionId, text: string): string {
    return `Hold ${keyLabel(action)} — ${text}`;
  }

  function hangarDigitPrompt(): string {
    return getStationHangars()
      .map((hangar) => keyLabel(`hangar${hangar.index}` as KeyboardActionId))
      .join(' / ');
  }

  // Console-only dev shortcuts (mirrors the __spikeScene diagnostic).
  window.__claudecitizenDev = {
    callShip: async () => {
      const hangar = await callShipToHangar(world, planet, seed, {
        ownedShip: bootstrap?.ships[0],
        playerId: bootstrap?.player.id,
        hangarInstanceId: bootstrap?.spawn.hangarInstanceId,
      });
      return hangar?.index ?? 0;
    },
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
    setColorCorrection: (settings: Partial<ColorCorrectionSettings>) =>
      renderer?.setColorCorrectionSettings(settings),
    setSsaoSettings: (settings: Partial<SsaoSettings>) => renderer?.setSsaoSettings(settings),
    setSsaoIntensity: (intensity: number) => renderer?.setSsaoSettings({ intensity }),
    setSsaoColor: (color: string | null) => renderer?.setSsaoColor(color),
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

  function cleanupForTitleReturn(): void {
    disposeShipDeckPhysics();
    let clearedHangar = false;
    for (const instance of listShipInstances()) {
      const inPrivateHangar =
        bootstrap !== null && instance.instanceId === bootstrap.spawn.hangarInstanceId;
      const parkedInHangar =
        sampleHangarRest(
          stationFrame,
          instance.body.position,
          getShipRestHeightMeters(),
        ) !== null;
      if (!inPrivateHangar && !parkedInHangar) continue;
      removeShipInstance(instance.id);
      clearedHangar = true;
    }
    if (clearedHangar) world.assignedHangar = null;
    delete window.__claudecitizenWorld;
    delete window.__claudecitizenDev;
    window.__claudecitizenRenderStats = null;
  }

  function avmsPrompt(): string {
    return pressInteractPrompt("AVMS terminal");
  }

  function shipsForAvms(): GameBootstrap["ships"] {
    if (bootstrap?.ships.length) return bootstrap.ships;
    const ship = getActiveShip(world);
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

  function stationPrompt(interaction: StationInteraction | null): string {
    if (interaction) {
      switch (interaction.kind) {
        case "hab-lift-down":
          return pressInteractPrompt("elevator to Lobby");
        case "hab-lift-up":
          return pressInteractPrompt("elevator to Habs");
        case "terminal":
        case "avms-terminal":
          return avmsPrompt();
        case "hangar-bank":
          return world.assignedHangar === null
            ? `Press ${hangarDigitPrompt()} — elevator to hangars`
            : `Press ${hangarDigitPrompt()} — elevator to hangars (your ship: Hangar ${world.assignedHangar})`;
        case "hangar-lift-up":
          return pressInteractPrompt("elevator to Lobby");
        case "prefab-elevator":
          return pressInteractPrompt(`elevator to ${interaction.marker.targetFloor}`);
        case "prefab-info": {
          let promptText = interaction.prompt;
          if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
            const animState = stationAnimationStates[interaction.targetAnimationId];
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
    const area = buildAreaForCurrentRoom();
    if (area && buildRuntimeForArea(area)) {
      return `Press ${keyLabel("hangarBuild")} — ${buildAreaLabel(area)} build mode`;
    }
    return "";
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
    return rig.rampDown ? pressInteractPrompt("raise ramp") : pressInteractPrompt("lower ramp");
  }

  /** Walking into the foot of the lowered ramp steps aboard. */
  function tryMountRamp(): boolean {
    const ship = getActiveShipBody(world);
    const rig = getActiveShipRig(world);
    if (!isShipParked(ship) || !isRampUsable(rig)) return false;
    const mountRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    if (usesColliderDeck()) {
      const mount = sampleRampBoarding(world.character, ship, rig);
      if (!mount) return false;
      if (!shipPhysics) {
        void warmShipDeckPhysics();
        return false;
      }
      const floorHint = mount.floorUp;
      teleportShipPlayerLocal(shipPhysics, {
        right: mount.right,
        up: floorHint + DECK_FLOOR_OFFSET_METERS,
        forward: mount.forward,
      });
      syncShipArticulationColliders(
        shipPhysics,
        mountRig,
        getShipLayout().doors.map((door) => door.id),
      );
      world.character = createDeckCharacterState(
        ship,
        mount,
        undefined,
        mountRig,
        floorHint,
      );
    } else {
      const mount = sampleRampMount(world.character, ship);
      if (!mount) return false;
      world.character = createDeckCharacterState(ship, mount, undefined, mountRig);
    }
    world.mode = MODE_ON_SHIP_DECK;
    world.prompt = "";
    return true;
  }

  /** Steps off the ramp tip onto whatever the ship is parked on. */
  function dismountToGround(): void {
    disposeShipDeckPhysics();
    void warmShipDeckPhysics();
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
    // Prefer live pad rest; if the ship drifted slightly, still honor the
    // assigned hangar so we never snap to planet from a station bay.
    const assignedHangar =
      hangarRest?.hangar ??
      (world.assignedHangar !== null
        ? getHangarByIndex(world.assignedHangar)
        : null);
    const facing = {
      x: -ship.forward.x,
      y: -ship.forward.y,
      z: -ship.forward.z,
    };
    if (assignedHangar) {
      const local = worldToStationLocal(stationFrame, groundPosition);
      const surfaceUp =
        hangarRest?.surfaceUp ?? assignedHangar.padSurfaceLocal.up;
      world.character = createStationCharacterAt(
        stationFrame,
        assignedHangar.roomId,
        { right: local.right, forward: local.forward },
        { right: 0, forward: -1 },
        surfaceUp,
      );
      if (physics) {
        teleportStationPlayer(physics, stationFrame, world.character.position);
      }
      world.mode = MODE_IN_STATION;
      return;
    }
    world.character = placeCharacterOnSurface(groundPosition, facing);
    world.mode = MODE_ON_FOOT;
  }

  function buildAreaLabel(area: BuildArea): string {
    return area === "apartment" ? "apartment" : "hangar";
  }

  function buildRuntimes(): BuildAreaRuntime[] {
    return [build?.areas.hangar, build?.areas.apartment].filter(
      (runtime): runtime is BuildAreaRuntime => Boolean(runtime),
    );
  }

  function buildRuntimeForArea(area: BuildArea): BuildAreaRuntime | null {
    return build?.areas[area] ?? null;
  }

  function buildAreaForCurrentRoom(): BuildArea | null {
    if (!bootstrap || world.mode !== MODE_IN_STATION) return null;
    const roomId = (world.character as StationCharacterState).stationRoomId;
    if (roomId === "hab" || roomId === "hab-room") return "apartment";
    if (roomId === "hangar" || roomId.startsWith("hangar-")) return "hangar";
    return null;
  }

  function buildRuntimeForCurrentRoom(): BuildAreaRuntime | null {
    const area = buildAreaForCurrentRoom();
    return area ? buildRuntimeForArea(area) : null;
  }

  function activeBuildRuntime(): BuildAreaRuntime | null {
    return (
      buildRuntimes().find((runtime) => runtime.controller.isBuildToolActive()) ?? null
    );
  }

  async function syncBuildPropsVisuals(runtime: BuildAreaRuntime): Promise<void> {
    const context = runtime.controller.getContext();
    const propColliders = runtime.propColliders.getColliders();
    if (physics) {
      await syncDynamicColliders(physics, propColliders);
    }
    await runtime.propRenderer.setPlacements(context.state.placements);
    await runtime.propColliders.setPlacements(context.state.placements);
    const ghost = context.ghost;
    const definition = context.selectedDefinitionId
      ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
      : null;
    if (ghost && definition && context.toolMode === "place") {
      await runtime.propRenderer.setGhost({
        prefabId: definition.prefabId,
        transform: ghost,
      });
    } else if (context.toolMode === "move" && ghost && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (placement) {
        await runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: ghost,
        });
      }
    } else {
      await runtime.propRenderer.setGhost(null);
    }
  }

  function pickBuildFloorFromPointer(
    runtime: BuildAreaRuntime,
  ): { right: number; up: number; forward: number } | null {
    if (!renderer) return null;
    const context = runtime.controller.getContext();
    const room = buildRoomForArea(context.state.area, context.state.assignedHangar);
    return pickStationFloorPoint(
      renderer.getCamera(),
      runtime.controller.getPointerNdc(),
      renderer.getStationRoot(),
      room.floorUp,
    );
  }

  function updateBuildTool(runtime: BuildAreaRuntime): void {
    if (!runtime.controller.isBuildToolActive()) return;
    const floorPoint = pickBuildFloorFromPointer(runtime);
    runtime.controller.updateGhostFromFloor(floorPoint);
    const context = runtime.controller.getContext();
    if (!context.ghost) {
      if (runtime.propRenderer.getGhost()) {
        void runtime.propRenderer.setGhost(null);
      }
      return;
    }

    const rendererGhost = runtime.propRenderer.getGhost();
    if (context.toolMode === "place") {
      const definition = context.selectedDefinitionId
        ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
        : null;
      if (!definition) return;
      if (!rendererGhost || rendererGhost.prefabId !== definition.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: definition.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else if (context.toolMode === "move" && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (!placement) return;
      if (!rendererGhost || rendererGhost.prefabId !== placement.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else {
      if (rendererGhost) void runtime.propRenderer.setGhost(null);
      return;
    }

    runtime.propRenderer.updateGhostTransform(context.ghost);
  }

  function updateStationMode(
    characterInput: ReturnType<PlayerControls["sampleCharacterInput"]>,
    actions: ReturnType<PlayerControls["consumeActions"]>,
    dt: number,
  ): void {
    const activeRuntime = activeBuildRuntime();
    if (activeRuntime) {
      world.character = updateCharacterInStation(
        world.character as StationCharacterState,
        stationFrame,
        { ...characterInput, jumpPressed: actions.jumpPressed },
        dt,
        planet.gravityMetersPerSecond2 ?? 9.8,
        physics,
      );
      updateBuildTool(activeRuntime);
      const tool = activeRuntime.controller.getContext().toolMode;
      world.prompt =
        tool === "place"
          ? `Click to place · ${keyLabel("hangarRotate")} rotate · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
          : tool === "move"
            ? `Click prop, move, click confirm · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
            : `Click prop to pick up · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`;
      if (actions.hangarBuildPressed) build?.terminal.open(activeRuntime.controller);
      if (actions.hangarRotatePressed) {
        activeRuntime.controller.rotateGhost(Math.PI / 12);
        const ghost = activeRuntime.controller.getContext().ghost;
        if (ghost) activeRuntime.propRenderer.updateGhostTransform(ghost);
      }
      if (actions.hangarCancelPressed) {
        activeRuntime.controller.cancelTool();
        void syncBuildPropsVisuals(activeRuntime);
      }
      return;
    }

    world.character = updateCharacterInStation(
      world.character as StationCharacterState,
      stationFrame,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
      physics,
    );

    if (tryMountRamp()) return;

    const rampPrompt = handleRampOutside(actions.interactPressed);
    if (rampPrompt !== null) {
      world.prompt = rampPrompt;
      return;
    }

    const currentBuildRuntime = buildRuntimeForCurrentRoom();
    if (currentBuildRuntime && actions.hangarBuildPressed) {
      build?.terminal.open(currentBuildRuntime.controller);
    }

    const interaction = resolveStationInteraction(
      world.character as StationCharacterState,
      stationFrame,
    );
    if (interaction?.kind === "prefab-info" && interaction.id) {
      if (interaction.id !== lastNearbyPrefabInfoId) {
        lastNearbyPrefabInfoId = interaction.id;
        if (interaction.proximitySoundUrl) playSfx(interaction.proximitySoundUrl);
      }
    } else {
      lastNearbyPrefabInfoId = null;
    }
    world.prompt = stationPrompt(interaction);
    if (!interaction) return;

    if (interaction.kind === "terminal" || interaction.kind === "avms-terminal") {
      if (actions.interactPressed) {
        avmsTerminal?.open({
          ships: shipsForAvms(),
          canStore: world.assignedHangar !== null,
          onStore: async () => {
            const ship = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
            if (ship) {
              ship.instanceId = "stored";
              ship.body.position = { x: 0, y: -100000, z: 0 };
              ship.body.velocity = { x: 0, y: 0, z: 0 };
            }
            world.assignedHangar = null;
            world.prompt = "Ship stored.";
            if (bootstrap) {
              try {
                const response = await resetAssignedHangarBay();
                const hangarRuntime = buildRuntimeForArea("hangar");
                hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
                if (hangarRuntime) await syncBuildPropsVisuals(hangarRuntime);
              } catch (error) {
                console.warn("Failed to persist hangar store.", error);
              }
            }
          },
          onDeliver: async (ship) => {
            const hangar = await callShipToHangar(world, planet, seed, {
              ownedShip: ship,
              playerId: bootstrap?.player.id,
              hangarInstanceId: bootstrap?.spawn.hangarInstanceId,
            });
            if (!hangar) throw new Error("No hangar bays available.");
            world.prompt = `Ship delivered to Hangar ${hangar.index}`;
            if (bootstrap) {
              getActiveShip(world).instanceId = bootstrap.spawn.hangarInstanceId;
              try {
                const response = await setAssignedHangarBay(hangar.index);
                const hangarRuntime = buildRuntimeForArea("hangar");
                hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
                if (hangarRuntime) await syncBuildPropsVisuals(hangarRuntime);
              } catch (error) {
                console.warn("Failed to persist assigned hangar bay.", error);
              }
            }
          },
        });
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

    if (interaction.kind === 'prefab-info') {
      const key = interaction.keyLabel ?? 'F';
      const keyCode = `Key${key.toUpperCase()}`;
      const pressed = actions.wasKeyPressed ? actions.wasKeyPressed(keyCode) : (key === 'F' ? actions.interactPressed : false);
      if (pressed) {
        if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
          toggleStationAnimation(interaction.targetAnimationId);
        }
        if (interaction.interactSoundUrl) playSfx(interaction.interactSoundUrl);
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
      throttleAccelMps2: instance.spec.throttleAccelMps2,
    });
    const parked = isShipParked(instance.body);
    const gates = {
      rampWalkable: parked && isRampUsable(rig),
      isDoorOpen: (doorId: string) => isDoorPassable(rig, doorId),
    };
    const colliderRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    if (shipPhysics && usesColliderDeck()) {
      syncShipArticulationColliders(
        shipPhysics,
        colliderRig,
        getShipLayout().doors.map((door) => door.id),
      );
    }
    const result = updateCharacterOnDeck(
      world.character as DeckCharacterState,
      instance.body,
      gates,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
      colliderRig,
      usesColliderDeck() ? shipPhysics : null,
    );
    world.character = result.state;

    if (result.dismounted || result.fellOffDeck) {
      dismountToGround();
      return;
    }

    const deckLocal = result.state.deckLocal;

    const seatNearby = nearestSeat(deckLocal);
    if (seatNearby) {
      world.prompt = seatInteractPrompt(seatNearby, keyLabel("interact"));
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
          ? pressInteractPrompt(`close ${door.label}`)
          : pressInteractPrompt(`open ${door.label}`);
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
      world.prompt = ladderInteractPrompt(ladder.direction, keyLabel("interact"));
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

    const standingOnRamp = isOnShipRampDeck(
      deckLocal,
      result.state.deckZone,
    );
    if (parked && nearRampPanel(deckLocal) && !standingOnRamp) {
      world.prompt = rig.rampDown
        ? pressInteractPrompt("raise ramp")
        : pressInteractPrompt("lower ramp");
      if (actions.interactPressed) rig.rampDown = !rig.rampDown;
      return;
    }

    world.prompt = "";
  }

  function frame(nowMs: number): void {
    if (!running) return;

    const paused = isPaused?.() ?? false;
    const dt = paused ? 0 : Math.min((nowMs - lastMs) / 1000, 1 / 30);
    lastMs = nowMs;

    let camera = controls.sampleCameraState(0);

    if (!paused) {
      controls.setMode(world.mode === MODE_IN_SHIP ? MODE_IN_SHIP : MODE_ON_FOOT);
      const actions = controls.consumeActions();
      camera = controls.sampleCameraState(dt);
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

        if (actions.cycleFlightModePressed && world.quantum.phase === "idle") {
          world.flightMode = cycleFlightMode(world.flightMode);
        }

        if (actions.quantumEngagePressed && world.quantum.phase === "idle") {
          const eligibility = evaluateQuantumEligibility({
            body: instance.body,
            flightMode: world.flightMode,
            quantum: world.quantum,
            planet,
            seed,
          });
          if (eligibility.ok) {
            world.quantum = tryBeginQuantumTravel(
              world.quantum,
              instance.body,
              planet,
              seed,
              eligibility.destinationId,
            );
          }
        }

        if (world.quantum.phase !== "idle") {
          const quantumResult = advanceQuantumTravel(
            instance.body,
            world.quantum,
            dt,
            planet,
            seed,
          );
          instance.body = quantumResult.body;
          world.quantum = quantumResult.quantum;
          world.screenFade = quantumResult.screenFade;
          world.prompt =
            world.quantum.phase === "spooling"
              ? "Spooling…"
              : world.quantum.phase === "traveling"
                ? "Quantum travel"
                : "Drop out";
        } else {
          const flightInput = controls.sampleFlightInput();
          if (world.flightMode === "nav") {
            flightInput.throttle01 = (flightInput.throttle01 ?? 0) * 0.5;
          }
          instance.body = integrateFlightBody(
            instance.body,
            flightInput,
            dt,
            planet,
            seed,
            {
              maxSpeedMps: instance.spec.maxSpeedMps,
              throttleAccelMps2: instance.spec.throttleAccelMps2,
            },
          );
          if (world.flightMode === "nav") {
            world.prompt = buildNavPrompt({
              body: instance.body,
              flightMode: world.flightMode,
              quantum: world.quantum,
              planet,
              seed,
            });
          } else {
            world.prompt = `${holdPrompt("seatLook", "look around")} · ${holdPrompt("exitSeat", "get up")}`;
          }
        }

        if (actions.exitSeatPressed && world.quantum.phase === "idle") {
          beginStandTransition(world);
        }
        if (world.quantum.phase === "idle" && world.screenFade > 0) {
          world.screenFade = Math.max(0, world.screenFade - dt * 4);
        }
      } else if (world.mode === MODE_ON_SHIP_DECK) {
        updateDeckMode(characterInput, actions, dt);
      } else if (world.mode === MODE_IN_STATION) {
        updateStationMode(characterInput, actions, dt);
      } else if (world.mode === MODE_RIDING_ELEVATOR) {
        const ride = updateElevatorRide(world, stationFrame, dt, physics);
        world.prompt = ride.destination ? `${ride.destination.label}…` : "";
        if (ride.teleportedNow && ride.destination) {
          controls.setOrbitFacing(stationYawForDir(ride.destination.face));
        }
      } else {
        updateTransition(world, dt, transitionContext);
      }

      updateShipSystems(dt);
      updateStationAnimations(dt);
      renderer?.getStationRoot()?.userData.updateParticles?.(dt);
      network?.publishPresence(world);
    }

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
          flightMode: world.flightMode,
          quantum: world.quantum,
        }) ?? null;
    } catch (error) {
      console.error("ClaudeCitizen render frame failed.", error);
      frameRendererError = error;
    }
    window.__claudecitizenRenderStats = renderStats;
    window.__claudecitizenWorld = world;
    updateSceneSounds(focusPosition);

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
    if (running) return;
    running = true;
    requestAnimationFrame((now) => {
      lastMs = now;
      requestAnimationFrame(frame);
    });
  }

  function stop(): void {
    running = false;
    disposeShipDeckPhysics();
    soundScene.dispose();
    renderer?.getStationRoot()?.userData.disposeParticleSystems?.();
  }

  return {
    cleanupForTitleReturn,
    resetWorld,
    start,
    stop,
  };
}
