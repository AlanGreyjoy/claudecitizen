import * as THREE from "three";
import { N8AOPostPass } from "n8ao";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { createPlayerControls } from "../flight/player_controls";
import {
  FIRST_PERSON_PITCH_LIMIT,
  integrateCharacterLocomotion,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
  resolveFirstPersonCameraRig,
  SPRINT_SPEED_METERS_PER_SECOND,
  WALK_SPEED_METERS_PER_SECOND,
} from "../player/character_controller";
import {
  createDeckCharacterState,
  getDefaultDeckSpawnLocal,
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
import {
  getShipLayout,
  getShipRestHeightMeters,
  setShipLayoutOverride,
} from "../player/ship_layout";
import {
  createTransitionPose,
  getPilotSeatAnchor,
  getRampDismountGroundLocal,
  localOffsetToWorld,
  nearShipRampOutside,
  sampleRampMount,
} from "../player/ship_interaction";
import { getLeavePilotStandPose } from "../player/ship_deck";
import {
  createShipRigState,
  doorBlends,
  isDoorPassable,
  isRampUsable,
  updateShipRig,
} from "../player/ship_rig";
import { createCharacterAvatar } from "../player/avatar";
import { resolveRenderQuality } from "../render/main/domain/render_quality";
import { createShipModel } from "../render/main/scene/ship_model";
import { updateShipPlacement } from "../render/main/update/sun_system";
import { loadPrefabDocument } from "../world/prefabs/loader";
import { buildShipLayoutFromPrefab } from "../world/prefabs/ship_runtime";
import {
  add,
  cross,
  normalize,
  rotateAroundAxis,
  scale,
  vec3,
} from "../math/vec3";
import type { CharacterState, FlightBody, Pose, Vec3 } from "../types";

/**
 * Dev-only ship sandbox (?shipPrefab=<id>): loads a ship prefab, applies its
 * gameplay layout, and drops the player on the deck of the parked ship on a
 * flat test pad — no planet, station, or flight. Everything that matters for
 * a ship prefab is testable here: walk zones, doors, ramp, pilot seat, rig.
 */

const PAD_RADIUS_METERS = 42;
const SANDBOX_GROUND_Y_METERS = 0.05;
const SANDBOX_GRAVITY = 9.8;
const TURN_SPEED = 10;
const SIT_SECONDS = 1.3;
const STAND_SECONDS = 1.0;

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const SHIP_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

type SandboxMode = "deck" | "ground" | "pilot" | "sitting" | "standing";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep01(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Y-up orbit camera basis for the flat sandbox frame. */
function resolveSandboxOrbit(
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number,
) {
  const right0 = normalize(cross(SHIP_FORWARD, WORLD_UP));
  const deckYaw = -yawRadians;
  const planarForward = normalize(
    add(
      scale(SHIP_FORWARD, Math.cos(deckYaw)),
      scale(right0, Math.sin(deckYaw)),
    ),
  );
  const right = normalize(cross(planarForward, WORLD_UP));
  const clampedPitch = clamp(pitchRadians, -pitchLimit, pitchLimit);
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    pitchRadians: clampedPitch,
    right,
    up: WORLD_UP,
  };
}

function groundCharacterAt(position: Vec3, forward: Vec3): CharacterState {
  return {
    animation: "Idle_Loop",
    forward: normalize({ x: forward.x, y: 0, z: forward.z }),
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position: { x: position.x, y: SANDBOX_GROUND_Y_METERS, z: position.z },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
}

function mountBanner(
  prefabId: string,
  hintText: string,
  isWarning: boolean,
): void {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `◂ Back to Editor (${prefabId})`;
  button.title =
    "Return to the editor with this prefab loaded (press Esc first to unlock the mouse)";
  Object.assign(button.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "250",
    padding: "9px 18px",
    border: "1px solid rgba(255, 206, 111, 0.5)",
    background: "rgba(6, 12, 26, 0.88)",
    color: "var(--accent-2, #ffce6f)",
    font: "600 13px/1 'Rajdhani', sans-serif",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener("click", () => {
    window.location.href = `/?boot=editor&prefab=${encodeURIComponent(prefabId)}`;
  });
  document.body.appendChild(button);

  const hint = document.createElement("div");
  hint.textContent = hintText;
  Object.assign(hint.style, {
    position: "fixed",
    bottom: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "250",
    padding: "8px 16px",
    border: "1px solid rgba(90, 190, 255, 0.35)",
    background: "rgba(6, 12, 26, 0.82)",
    color: isWarning ? "var(--accent-2, #ffce6f)" : "var(--muted, #8fa3c9)",
    font: "500 12px/1.4 'Rajdhani', sans-serif",
    letterSpacing: "0.08em",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(hint);
}

let started = false;

export async function startShipPlaySession(prefabId: string): Promise<void> {
  if (started) return;
  started = true;

  // --- prefab layout ----------------------------------------------------------
  const doc = await loadPrefabDocument(prefabId);
  let prefabApplied = false;
  if (!doc) {
    console.warn(
      `Ship prefab "${prefabId}" not found; sandbox uses the built-in Starhopper.`,
    );
  } else if (doc.kind !== "ship") {
    console.warn(
      `Prefab "${prefabId}" is kind "${doc.kind}", not ship; using the built-in layout.`,
    );
  } else {
    const layout = buildShipLayoutFromPrefab(doc);
    if (layout) {
      setShipLayoutOverride(layout);
      prefabApplied = true;
      console.info(`Ship prefab sandbox active: "${prefabId}".`);
    }
  }
  // Deck spawning needs authored walk zones (or the built-in ship when the
  // prefab is missing entirely); otherwise start on the pad beside the ship.
  const walkable = (prefabApplied || !doc) && getShipWalkZones().length > 0;
  const hint = walkable
    ? "Ship sandbox — WASD walk · F interact · V camera · G gear · Esc unlock mouse"
    : prefabApplied
      ? "Hull loaded — add ship-walk-zone components (and a pilot-seat) in the editor to walk the deck"
      : 'Ship prefab not applied (kind must be "ship") — showing the built-in ship';

  // --- DOM --------------------------------------------------------------------
  document.getElementById("title-screen")?.classList.add("is-hidden");
  requireElement<HTMLElement>("app").classList.remove("is-hidden");
  mountBanner(prefabId, hint, !walkable);

  // Trim the full-game HUD down to FPS + interact prompt.
  for (const selector of [
    ".sc-hud-minimap",
    ".sc-hud-chat",
    ".sc-hud-debug-wrap",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  const canvas = requireElement<HTMLCanvasElement>("view");
  const fpsEl = requireElement<HTMLElement>("hud-fps-value");
  const interactPromptEl = requireElement<HTMLElement>("interact-prompt");

  // --- scene --------------------------------------------------------------------
  const renderQuality = resolveRenderQuality();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a121f);
  scene.fog = new THREE.Fog(0x0a121f, 160, 420);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2_000);
  camera.position.set(14, 8, 14);
  const cameraTarget = new THREE.Vector3();

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });
  composer.addPass(new RenderPass(scene, camera));
  let n8aoPass: N8AOPostPass | null = null;
  if (renderQuality.ambientOcclusionEnabled) {
    n8aoPass = new N8AOPostPass(scene, camera, 1, 1);
    n8aoPass.configuration.aoRadius = 0.2;
    n8aoPass.configuration.intensity = renderQuality.ambientOcclusionIntensity * 1.35;
    n8aoPass.configuration.distanceFalloff = 1.0;
    n8aoPass.configuration.gammaCorrection = false;
    n8aoPass.configuration.colorMultiply = true;
    n8aoPass.configuration.halfRes = renderQuality.ambientOcclusionResolutionScale <= 0.5;
    n8aoPass.configuration.depthAwareUpsampling = true;
    n8aoPass.configuration.transparencyAware = false;
    n8aoPass.setQualityMode(
      renderQuality.ambientOcclusionSamples <= 8
        ? "Performance"
        : renderQuality.ambientOcclusionSamples <= 16
          ? "Low"
          : renderQuality.ambientOcclusionSamples <= 32
            ? "Medium"
            : renderQuality.ambientOcclusionSamples <= 64
              ? "High"
              : "Ultra",
    );
    composer.addPass(n8aoPass);
  }
  if (renderQuality.useSmaa) {
    composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2030, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS_METERS, PAD_RADIUS_METERS, 0.5, 64),
    new THREE.MeshStandardMaterial({
      color: 0x2a3242,
      metalness: 0.15,
      roughness: 0.85,
    }),
  );
  pad.position.y = -0.25;
  pad.receiveShadow = true;
  scene.add(pad);
  const grid = new THREE.GridHelper(
    PAD_RADIUS_METERS * 2,
    42,
    0x33507a,
    0x18243c,
  );
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.01;
  scene.add(grid);

  const layout = getShipLayout();
  const shipModel = createShipModel(1, {
    hullUrl: layout.hullUrl,
    doors: layout.doors.map((door) => ({
      id: door.id,
      motion: door.motion,
      axis: door.axis,
      nodes: door.nodes,
    })),
    gearHinges: layout.spec.gearHinges,
    rampHinge: layout.spec.rampHinge,
  });
  shipModel.group.frustumCulled = false;
  scene.add(shipModel.group);
  window.__claudecitizenShipModel = shipModel;

  const avatar = createCharacterAvatar(scene, 1);

  // --- world state ---------------------------------------------------------------
  const authoredRestHeight = layout.restHeightMeters;
  const ship: FlightBody = {
    forward: { ...SHIP_FORWARD },
    grounded: true,
    position: { x: 0, y: getShipRestHeightMeters(), z: 0 },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
  // Without an authored rest height, rest the hull's lowest point on the pad
  // once the model has loaded and been measured.
  let autoRestPending = authoredRestHeight === null;
  function tryAutoRest(): void {
    if (!autoRestPending) return;
    const measured = shipModel.measure() as {
      ship?: { min?: { up?: number } };
    } | null;
    const lowestUp = measured?.ship?.min?.up;
    if (typeof lowestUp !== "number") return;
    ship.position = {
      ...ship.position,
      y: Math.min(30, Math.max(0.3, -lowestUp)),
    };
    autoRestPending = false;
  }
  const rig = createShipRigState({ gearDown: true, rampDown: true });
  rig.ramp01 = 1;

  let mode: SandboxMode = walkable ? "deck" : "ground";
  let character: CharacterState | DeckCharacterState = walkable
    ? createDeckCharacterState(ship, getDefaultDeckSpawnLocal())
    : groundCharacterAt({ x: 12, y: 0, z: -16 }, { x: -0.5, y: 0, z: 0.65 });
  let prompt = "";
  let transition: {
    start: Pose;
    end: Pose;
    elapsed: number;
    duration: number;
  } | null = null;

  const controls = createPlayerControls(canvas);
  controls.setMode("on-foot");

  // Gear preview toggle (visual only — the parked pose does not move).
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyG") rig.gearDown = !rig.gearDown;
  });

  // --- sim ------------------------------------------------------------------------
  function gates() {
    return {
      rampWalkable: isRampUsable(rig),
      isDoorOpen: (doorId: string) => isDoorPassable(rig, doorId),
    };
  }

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

  function updateDeck(
    dt: number,
    actions: { interactPressed: boolean; jumpPressed: boolean },
  ): void {
    const input = controls.sampleCharacterInput();
    const result = updateCharacterOnDeck(
      character as DeckCharacterState,
      ship,
      gates(),
      { ...input, jumpPressed: actions.jumpPressed },
      dt,
      SANDBOX_GRAVITY,
      { gear01: rig.gear01, ramp01: rig.ramp01, doors: doorBlends(rig) },
    );
    character = result.state;
    prompt = "";

    if (result.dismounted) {
      const spot = getRampDismountGroundLocal();
      const world = localOffsetToWorld(ship, { ...spot, up: 0 });
      character = groundCharacterAt(world, scale(ship.forward, -1));
      mode = "ground";
      return;
    }

    const deckLocal = result.state.deckLocal;

    const seatNearby = nearestSeat(deckLocal);
    if (seatNearby) {
      prompt = seatInteractPrompt(seatNearby);
      if (actions.interactPressed && seatNearby.role === "pilot") {
        transition = {
          start: {
            forward: character.forward,
            position: character.position,
            up: character.up,
          },
          end: getPilotSeatAnchor(ship),
          elapsed: 0,
          duration: SIT_SECONDS,
        };
        mode = "sitting";
      }
      return;
    }

    const doorNearby = nearestDoor(deckLocal);
    if (doorNearby) {
      const door = getShipLayout().doors.find(
        (entry) => entry.id === doorNearby.doorId,
      );
      const doorRig = rig.doors[doorNearby.doorId];
      if (door && doorRig) {
        prompt = doorRig.isOpen
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
      gates(),
      result.state.deckZone,
    );
    if (ladder) {
      prompt = ladderInteractPrompt(ladder.direction);
      if (actions.interactPressed) {
        const next = traverseLadder(
          character as DeckCharacterState,
          ladder.zone,
          ladder.direction,
          gates(),
          ship,
        );
        if (next) character = next;
      }
      return;
    }

    const standingOnRamp =
      getShipWalkZone(result.state.deckZone)?.gate === "ramp";
    if (nearRampPanel(deckLocal) && !standingOnRamp) {
      prompt = rig.rampDown ? "Press F — raise ramp" : "Press F — lower ramp";
      if (actions.interactPressed) rig.rampDown = !rig.rampDown;
    }
  }

  function clampToSandboxPad(position: Vec3): Vec3 {
    const radial = Math.hypot(position.x, position.z);
    if (radial <= PAD_RADIUS_METERS - 1) return position;
    const pull = (PAD_RADIUS_METERS - 1) / radial;
    return { x: position.x * pull, y: position.y, z: position.z * pull };
  }

  function updateGround(
    dt: number,
    actions: { interactPressed: boolean; jumpPressed: boolean },
  ): void {
    const input = controls.sampleCharacterInput();
    const moveX = input.moveX ?? 0;
    const moveY = input.moveY ?? 0;
    const yaw = input.cameraYawRadians ?? 0;
    const orbit = resolveSandboxOrbit(yaw, 0, ORBIT_PITCH_LIMIT);
    const moveDir = add(scale(orbit.right, moveX), scale(orbit.forward, moveY));
    const magnitude = Math.min(1, Math.hypot(moveX, moveY));
    const moveSpeed =
      (input.sprint
        ? SPRINT_SPEED_METERS_PER_SECOND
        : WALK_SPEED_METERS_PER_SECOND) * magnitude;
    const isMoving = magnitude > 0.08;
    const desiredDirection =
      isMoving && Math.hypot(moveDir.x, moveDir.z) > 1e-4
        ? normalize({ x: moveDir.x, y: 0, z: moveDir.z })
        : vec3(0, 0, 0);

    const motion = integrateCharacterLocomotion(
      character,
      {
        wantsJump: actions.jumpPressed,
        wantsSprint: Boolean(input.sprint),
        isMoving,
        desiredDirection,
        moveSpeed,
      },
      dt,
      WORLD_UP,
      SANDBOX_GRAVITY,
      {
        onGroundedStep: () => {
          let position = character.position;
          if (isMoving) {
            position = clampToSandboxPad(
              add(position, scale(desiredDirection, moveSpeed * dt)),
            );
          }
          return {
            position: {
              x: position.x,
              y: SANDBOX_GROUND_Y_METERS,
              z: position.z,
            },
            up: WORLD_UP,
          };
        },
        tryLand: (candidate) => {
          if (candidate.y > SANDBOX_GROUND_Y_METERS) return null;
          const clamped = clampToSandboxPad(candidate);
          return {
            position: {
              x: clamped.x,
              y: SANDBOX_GROUND_Y_METERS,
              z: clamped.z,
            },
            up: WORLD_UP,
          };
        },
      },
    );

    const desiredFacing = input.faceCameraYaw ? orbit.forward : moveDir;
    let forward = character.forward;
    if (Math.hypot(desiredFacing.x, desiredFacing.z) > 1e-4) {
      const target = normalize({
        x: desiredFacing.x,
        y: 0,
        z: desiredFacing.z,
      });
      const t = clamp(dt * TURN_SPEED, 0, 1);
      forward = normalize({
        x: forward.x + (target.x - forward.x) * t,
        y: 0,
        z: forward.z + (target.z - forward.z) * t,
      });
    }

    character = {
      ...character,
      animation: motion.animation,
      forward,
      grounded: motion.grounded,
      jumpPhase: motion.jumpPhase,
      jumpPhaseTime: motion.jumpPhaseTime,
      position: motion.position,
      up: motion.up,
      velocity: motion.velocity,
    };
    prompt = "";

    // Walking into the lowered ramp's foot steps aboard.
    if (walkable && isRampUsable(rig)) {
      const mount = sampleRampMount(character, ship);
      if (mount) {
        character = createDeckCharacterState(ship, mount);
        mode = "deck";
        return;
      }
    }

    if (nearShipRampOutside(character, ship)) {
      prompt = rig.rampDown ? "Press F — raise ramp" : "Press F — lower ramp";
      if (actions.interactPressed) rig.rampDown = !rig.rampDown;
    }
  }

  function updateTransitionMode(dt: number): void {
    if (!transition) return;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
    const eased = smoothstep01(transition.elapsed / transition.duration);
    const pose = createTransitionPose(transition.start, transition.end, eased);
    character = {
      animation: mode === "sitting" ? "Sitting_Enter" : "Sitting_Exit",
      forward: pose.forward,
      grounded: true,
      jumpPhase: "grounded",
      jumpPhaseTime: 0,
      position: pose.position,
      up: pose.up,
      velocity: vec3(0, 0, 0),
    };
    if (transition.elapsed < transition.duration) return;
    if (mode === "sitting") {
      mode = "pilot";
    } else {
      character = createDeckCharacterState(ship);
      mode = "deck";
    }
    transition = null;
  }

  function updatePilot(actions: { exitSeatPressed: boolean }): void {
    prompt = "Hold F — look around · Hold Y — get up";
    if (actions.exitSeatPressed) {
      transition = {
        start: getPilotSeatAnchor(ship),
        end: getLeavePilotStandPose(ship),
        elapsed: 0,
        duration: STAND_SECONDS,
      };
      mode = "standing";
    }
  }

  // --- render loop -----------------------------------------------------------------
  function updateCamera(dt: number): void {
    const cameraState = controls.sampleCameraState(dt);
    if (mode === "pilot") {
      const eye = localOffsetToWorld(ship, getShipLayout().pilotEye);
      const seatLook = cameraState.seatLook;
      const lookForward =
        seatLook &&
        (Math.abs(seatLook.yawRadians) > 1e-6 ||
          Math.abs(seatLook.pitchRadians) > 1e-6)
          ? resolveSandboxOrbit(
              seatLook.yawRadians,
              seatLook.pitchRadians,
              FIRST_PERSON_PITCH_LIMIT,
            ).forward
          : ship.forward;
      camera.position.set(eye.x, eye.y, eye.z);
      cameraTarget.set(
        eye.x + lookForward.x * 60,
        eye.y + lookForward.y * 60,
        eye.z + lookForward.z * 60,
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(cameraTarget);
      return;
    }

    const firstPerson =
      cameraState.cameraView === "first-person" &&
      mode !== "sitting" &&
      mode !== "standing";
    const pitchLimit = firstPerson
      ? FIRST_PERSON_PITCH_LIMIT
      : ORBIT_PITCH_LIMIT;
    const orbit = resolveSandboxOrbit(
      cameraState.yawRadians,
      cameraState.pitchRadians,
      pitchLimit,
    );
    const rigOffsets = firstPerson
      ? resolveFirstPersonCameraRig(orbit)
      : resolveCharacterCameraRig(orbit, cameraState.zoomDistance);
    camera.position.set(
      character.position.x + rigOffsets.positionOffset.x,
      character.position.y + rigOffsets.positionOffset.y,
      character.position.z + rigOffsets.positionOffset.z,
    );
    cameraTarget.set(
      character.position.x + rigOffsets.targetOffset.x,
      character.position.y + rigOffsets.targetOffset.y,
      character.position.z + rigOffsets.targetOffset.z,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraTarget);
  }

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    composer.setSize(width, height);
    n8aoPass?.setSize(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
  }
  window.addEventListener("resize", resize);
  resize();

  let lastMs = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsLastUpdate = 0;

  function frame(nowMs: number): void {
    const dt = Math.min((nowMs - lastMs) / 1000, 1 / 30);
    lastMs = nowMs;

    tryAutoRest();
    controls.setMode(mode === "pilot" ? "in-ship" : "on-foot");
    const actions = controls.consumeActions();

    if (mode === "deck") updateDeck(dt, actions);
    else if (mode === "ground") updateGround(dt, actions);
    else if (mode === "pilot") updatePilot(actions);
    else updateTransitionMode(dt);

    updateShipRig(rig, dt);
    shipModel.setArticulation({
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    });
    updateShipPlacement(shipModel.group, ship, vec3(0, 0, 0), 1);

    const firstPersonActive =
      mode !== "pilot" &&
      mode !== "sitting" &&
      mode !== "standing" &&
      controls.sampleCameraState(0).cameraView === "first-person";
    avatar.update(
      mode === "pilot"
        ? null
        : {
            animation: character.animation,
            forward: character.forward,
            position: character.position,
            up: character.up,
          },
      vec3(0, 0, 0),
      nowMs / 1000,
      firstPersonActive,
    );

    updateCamera(dt);
    composer.render(dt);

    interactPromptEl.textContent = prompt;
    interactPromptEl.classList.toggle("is-visible", prompt.length > 0);

    fpsAccum += dt;
    fpsFrames += 1;
    if (nowMs - fpsLastUpdate > 500 && fpsAccum > 0) {
      fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum));
      fpsAccum = 0;
      fpsFrames = 0;
      fpsLastUpdate = nowMs;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame((now) => {
    lastMs = now;
    requestAnimationFrame(frame);
  });
}
