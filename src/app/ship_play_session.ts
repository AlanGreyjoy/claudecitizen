import * as THREE from "three";
import { N8AOPostPass } from "n8ao";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { createPlayerControls } from "../input/player_controls";
import {
  FIRST_PERSON_PITCH_LIMIT,
  integrateCharacterLocomotion,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
} from "../player/character_controller";
import { loadCurrentDefaultAnimationController } from "../player/animation";
import {
  getCharacterSettings,
  loadCurrentCharacterSettings,
} from "../player/character_settings";
import {
  animationFromState,
  resolveWalkInputIntent,
  WALK_MOVE_THRESHOLD,
} from "../player/character_locomotion";
import {
  bedInteractPrompt,
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getSandboxDeckSpawn,
  isOnShipRampDeck,
  nearestBed,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  resolveDoorInteractAim,
  seatInteractPrompt,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from "../player/ship_deck";
import {
  getShipLayout,
  getShipRestHeightMeters,
  setShipLayoutOverride,
  usesColliderDeck,
} from "../player/ship_layout";
import {
  createShipPhysics,
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  occludeShipCamera,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
  type ShipPhysics,
} from "../physics/ship_physics";
import {
  createTransitionPose,
  getBedAnchor,
  getBedEyeLocal,
  getBedSpec,
  getPilotSeatAnchor,
  getShipRight,
  localOffsetToWorld,
  nearShipRampOutside,
  worldToShipLocal,
} from "../player/ship_interaction";
import { getDeckWorldPose, getLeavePilotStandPose } from "../player/ship_deck";
import {
  createShipRigState,
  doorBlends,
  updateShipRig,
} from "../player/ship_rig";
import { createCharacterAvatar } from "../render/main/scene/character_avatar";
import { resolveRenderQuality } from "../render/main/domain/render_quality";
import { createShipModel } from "../render/main/scene/ship_model";
import { updateShipPlacement } from "../render/main/update/sun_system";
import { attachPrefabParticleSystems } from "../render/particles";
import { attachPrefabObjectAnimations } from "../render/prefabs/object_animation";
import { loadPrefabDocument } from "../world/prefabs/loader";
import { buildShipLayoutFromPrefab } from "../world/prefabs/ship_runtime";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  rotateAroundAxis,
  scale,
  vec3,
} from "../math/vec3";
import type { CharacterState, FlightBody, Pose, Vec3 } from "../types";
import { createUiIcon, UiIcons } from "../ui/icons";
import {
  createSoundSceneController,
  type SoundListenerPose,
} from "../audio/sound_scene";
import {
  createFootstepController,
  footstepGaitFromIntent,
} from "../audio/footsteps";
import { createLoopingSfxController, playSfx } from "../audio/sfx";
import {
  flightOptionsFromSpec,
  integrateSandboxFlightBody,
} from "../flight/flight_body";
import {
  recenterAimAsNoseTracks,
  resolveAimForward,
  resolveDeckCameraOrbit,
  resolveSeatLookForward,
} from "../flight/flight_aim";
import {
  createFlightReticle,
  projectDirectionToReticleOffset,
} from "../render/effects/hud/flight_reticle";
import { createCockpitGazeHud } from "../render/effects/hud/cockpit_gaze_hud";
import { createCockpitSpeedHud } from "../render/effects/hud/cockpit_speed_hud";
import { createGameMenu } from "../render/effects/hud/game_menu";
import {
  applyCockpitControlAction,
  cockpitControlLabel,
  projectWorldPointToScreenOffset,
  resolveCockpitGazeTarget,
} from "../player/cockpit_gaze";
import {
  createEntertainmentCameraState,
  updateEntertainmentCameraFeel,
} from "../player/entertainment_camera";
import {
  entertainmentSystemLabel,
  resolveEntertainmentGazeTarget,
} from "../player/entertainment_gaze";
import { resolveVisibleCockpitSpeedInstruments } from "../player/cockpit_stats";
import { createEntertainmentSystem } from "../render/effects/hud/entertainment_system";
import { createEntertainmentScreen } from "../render/effects/entertainment_screen";
import {
  createFlightCameraFeelState,
  updateFlightCameraFeel,
} from "../player/flight_camera_feel";
import { resolveBoostMaxSpeedMps } from "../flight/flight_config";
import {
  playCockpitControlToggleSfx,
  playShipGearToggleSfx,
  playShipRampToggleSfx,
} from "../player/ship_articulation_sfx";
import { createQuantumTravelState } from "../flight/quantum_travel";
import {
  GET_UP_FROM_BED_SECONDS,
  LIE_TRANSITION_SECONDS,
  MODE_IN_SHIP,
  MODE_ON_FOOT,
} from "../player/modes";

/**
 * Dev-only ship sandbox (?shipPrefab=<id>): loads a ship prefab, applies its
 * gameplay layout, and drops the player on the deck of the ship on a flat
 * test pad. Pilot seat enables SC-style flight (mass/thrust + dual reticle)
 * over the pad — no planet or station.
 */

const PAD_RADIUS_METERS = 42;
const SANDBOX_GROUND_Y_METERS = 0.05;
const SANDBOX_GRAVITY = 9.8;
const TURN_SPEED = 10;
const SIT_SECONDS = 1.3;
const STAND_SECONDS = 1.0;

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const SHIP_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

type SandboxMode =
  | "deck"
  | "ground"
  | "pilot"
  | "sitting"
  | "standing"
  | "lying"
  | "in-bed"
  | "getting-up";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dt: number,
  halfLife: number,
): void {
  if (dt <= 0) return;
  const smoothness = Math.LN2 / halfLife;
  const blend = 1 - Math.exp(-smoothness * dt);
  current.lerp(target, blend);
}

function smoothstep01(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Y-up orbit camera basis for the flat sandbox frame (on-foot / third-person). */
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

/** Cockpit free-look relative to the ship frame (matches main-play). */
function resolveShipSeatLook(
  shipForward: Vec3,
  shipUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number,
) {
  return resolveSeatLookForward(
    shipForward,
    shipUp,
    yawRadians,
    pitchRadians,
    pitchLimit,
  );
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
  button.title =
    "Return to the editor with this prefab loaded (Esc opens the menu and unlocks the mouse)";
  button.append(
    createUiIcon(UiIcons.chevronLeft, { className: "sc-ui-icon", size: 14, strokeWidth: 2 }),
    document.createTextNode(` Back to Editor (${prefabId})`),
  );
  Object.assign(button.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "250",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
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

  // Dev: pick up Base Character settings + animation controller saved since page load.
  await Promise.all([
    loadCurrentCharacterSettings(),
    loadCurrentDefaultAnimationController(),
  ]);

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
    const layout = await buildShipLayoutFromPrefab(doc);
    if (layout) {
      setShipLayoutOverride(layout);
      prefabApplied = true;
      console.info(`Ship prefab sandbox active: "${prefabId}".`);
    }
  }
  // Deck walking needs Rapier deck colliders on the ship layout.
  const walkable = (prefabApplied || !doc) && usesColliderDeck();
  const hint = walkable
    ? "Ship sandbox — WASD walk · F interact · sit pilot to fly · G gear · Esc menu"
    : prefabApplied
      ? "Hull loaded — add a ship-controller with deck colliders to walk the interior"
      : 'Ship prefab not applied (kind must be "ship") — showing the built-in ship';

  const editorReturnUrl = `/?boot=editor&prefab=${encodeURIComponent(prefabId)}`;

  // --- DOM --------------------------------------------------------------------
  document.getElementById("title-screen")?.classList.add("is-hidden");
  requireElement<HTMLElement>("app").classList.remove("is-hidden");
  mountBanner(prefabId, hint, !walkable);

  // Trim the full-game HUD down to FPS + interact prompt.
  for (const selector of [
    ".sc-hud-chat",
    ".sc-hud-debug-wrap",
    "#hud-build-btn",
    "#weapon-crosshair",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  const canvas = requireElement<HTMLCanvasElement>("view");
  const fpsEl = requireElement<HTMLElement>("hud-fps-value");
  const interactPromptEl = requireElement<HTMLElement>("interact-prompt");
  const flightReticleEl = requireElement<HTMLElement>("flight-reticle");
  const flightReticle = createFlightReticle({ rootEl: flightReticleEl });
  const cockpitGazeEl = requireElement<HTMLElement>("cockpit-gaze");
  const cockpitGazeHud = createCockpitGazeHud({ rootEl: cockpitGazeEl });
  const cockpitSpeedEl = requireElement<HTMLElement>("cockpit-speed");
  const cockpitSpeedHud = createCockpitSpeedHud({ rootEl: cockpitSpeedEl });
  const entertainmentSystem = createEntertainmentSystem({
    rootEl: requireElement<HTMLElement>("entertainment-system"),
    homeEl: requireElement<HTMLElement>("es-home"),
    docsEl: requireElement<HTMLElement>("es-docs"),
    youtubeEl: requireElement<HTMLElement>("es-youtube"),
    nasaEl: requireElement<HTMLElement>("es-nasa"),
    localnowEl: requireElement<HTMLElement>("es-localnow"),
    docsFrameEl: requireElement<HTMLIFrameElement>("es-docs-frame"),
    youtubeFrameEl: requireElement<HTMLIFrameElement>("es-youtube-frame"),
    nasaFrameEl: requireElement<HTMLIFrameElement>("es-nasa-frame"),
    youtubeUrlInputEl: requireElement<HTMLInputElement>("es-youtube-url"),
    youtubeGridEl: requireElement<HTMLElement>("es-youtube-grid"),
    powerBtnEl: requireElement<HTMLButtonElement>("es-power-btn"),
    backBtnEl: requireElement<HTMLButtonElement>("es-back-btn"),
    closeBtnEl: requireElement<HTMLButtonElement>("es-close-btn"),
    docsTileEl: requireElement<HTMLButtonElement>("es-docs-tile"),
    youtubeTileEl: requireElement<HTMLButtonElement>("es-youtube-tile"),
    nasaTileEl: requireElement<HTMLButtonElement>("es-nasa-tile"),
    localnowTileEl: requireElement<HTMLButtonElement>("es-localnow-tile"),
    localnowOpenBtnEl: requireElement<HTMLButtonElement>("es-localnow-open-btn"),
    youtubeLoadBtnEl: requireElement<HTMLButtonElement>("es-youtube-load-btn"),
  });
  const esScreen = createEntertainmentScreen({
    panelEl: requireElement<HTMLElement>("es-bezel"),
  });
  const esCameraState = createEntertainmentCameraState();
  const idleQuantum = createQuantumTravelState();
  const onEsResize = () => esScreen.resize();
  window.addEventListener("resize", onEsResize);
  window.addEventListener(
    "pagehide",
    () => {
      entertainmentSystem.dispose();
      window.removeEventListener("resize", onEsResize);
      esScreen.dispose();
    },
    { once: true },
  );

  const gameMenuEl = requireElement<HTMLElement>("game-menu");
  const gameMenuResumeBtn = requireElement<HTMLButtonElement>("game-menu-resume-btn");
  const gameMenuExitBtn = requireElement<HTMLButtonElement>("game-menu-exit-btn");
  const gameMenuMasterVolume = requireElement<HTMLInputElement>("game-menu-master-volume");
  const gameMenuSfxVolume = requireElement<HTMLInputElement>("game-menu-sfx-volume");
  const gameMenuMusicVolume = requireElement<HTMLInputElement>("game-menu-music-volume");
  const gameMenuMasterValue = requireElement<HTMLElement>("game-menu-master-value");
  const gameMenuSfxValue = requireElement<HTMLElement>("game-menu-sfx-value");
  const gameMenuMusicValue = requireElement<HTMLElement>("game-menu-music-value");
  const chatInputEl = requireElement<HTMLInputElement>("hud-chat-input");

  const exitCopyEl = gameMenuEl.querySelector<HTMLElement>(".sc-game-menu-exit-copy");
  const exitPanelTitleEl = gameMenuEl.querySelector<HTMLElement>(
    '#game-menu-panel-exit .sc-game-menu-panel-title',
  );
  const exitNavBtn = gameMenuEl.querySelector<HTMLButtonElement>(
    '[data-game-menu-tab="exit"]',
  );
  if (exitCopyEl) {
    exitCopyEl.textContent =
      "Leave ship preview and return to the prefab editor with this ship loaded.";
  }
  if (exitPanelTitleEl) exitPanelTitleEl.textContent = "Back to Editor";
  if (exitNavBtn) exitNavBtn.textContent = "Back to Editor";
  gameMenuExitBtn.textContent = "Back to Editor";

  const gameMenu = createGameMenu(
    {
      rootEl: gameMenuEl,
      resumeBtnEl: gameMenuResumeBtn,
      exitBtnEl: gameMenuExitBtn,
      chatInputEl,
      masterVolumeEl: gameMenuMasterVolume,
      sfxVolumeEl: gameMenuSfxVolume,
      musicVolumeEl: gameMenuMusicVolume,
      masterValueEl: gameMenuMasterValue,
      sfxValueEl: gameMenuSfxValue,
      musicValueEl: gameMenuMusicValue,
    },
    {
      onExitGame: () => {
        window.location.href = editorReturnUrl;
      },
    },
  );
  window.addEventListener("pagehide", () => gameMenu.dispose(), { once: true });

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
  camera.userData.baseFovDeg = 60;
  const cameraTarget = new THREE.Vector3();
  const flightCameraFeelState = createFlightCameraFeelState();
  let flightCameraFeelFrame: {
    fovDeltaDeg: number;
    thrust01: number;
    boost01: number;
    eyeShake: { right: number; up: number; forward: number };
  } | null = null;
  const boostSfx = createLoopingSfxController();
  const thrustSfx = createLoopingSfxController();

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
  const soundScene = createSoundSceneController();
  const footsteps = createFootstepController();
  const shipModel = createShipModel(1, {
    hullUrl: layout.hullUrl,
    hullNodeOverrides: layout.hullNodeOverrides,
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
  esScreen.attachTo(shipModel.group);
  window.__claudecitizenShipModel = shipModel;
  if (doc && prefabApplied) {
    attachPrefabParticleSystems(doc, shipModel.group);
    attachPrefabObjectAnimations(doc, shipModel.group);
  }

  const avatar = createCharacterAvatar(scene, 1);

  // --- world state ---------------------------------------------------------------
  const authoredRestHeight = layout.restHeightMeters;
  const ship: FlightBody = {
    angularVelocity: vec3(0, 0, 0),
    forward: { ...SHIP_FORWARD },
    grounded: true,
    position: { x: 0, y: getShipRestHeightMeters(), z: 0 },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
  const disposeAudio = () => {
    soundScene.dispose();
    footsteps.dispose();
  };
  const disposeParticles = () =>
    shipModel.group.userData.disposeParticleSystems?.();
  window.addEventListener("pagehide", disposeAudio, { once: true });
  window.addEventListener("pagehide", disposeParticles, { once: true });
  window.addEventListener("pagehide", () => {
    boostSfx.stop();
    thrustSfx.stop();
  }, { once: true });
  // Without an authored rest height, rest the hull's lowest point on the pad
  // once the model has loaded and been measured.
  let autoRestPending = authoredRestHeight === null;
  function sandboxPadRestHeightMeters(): number {
    return Math.max(0.3, ship.position.y - SANDBOX_GROUND_Y_METERS);
  }
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
    shipPhysics?.setPadRestHeight(sandboxPadRestHeightMeters());
    autoRestPending = false;
  }
  const rig = createShipRigState({ gearDown: true, rampDown: true });
  rig.ramp01 = 1;

  let mode: SandboxMode = walkable ? "deck" : "ground";
  const spawnRig = { gear01: rig.gear01, ramp01: rig.ramp01, doors: doorBlends(rig) };
  const sandboxSpawn = getSandboxDeckSpawn(spawnRig);
  const spawnLocal = sandboxSpawn.local;
  const spawnFloorHint = sandboxSpawn.floorUp;
  let shipPhysics: ShipPhysics | null = null;
  if (walkable && usesColliderDeck()) {
    try {
      shipPhysics = await createShipPhysics(
        {
          right: spawnLocal.right,
          up: spawnFloorHint + DECK_FLOOR_OFFSET_METERS,
          forward: spawnLocal.forward,
        },
        getShipLayout().colliders,
        {
          pad: {
            restHeightMeters: sandboxPadRestHeightMeters(),
            halfExtentMeters: PAD_RADIUS_METERS,
          },
        },
      );
      shipPhysics.setPadEnabled(true);
      syncShipArticulationColliders(
        shipPhysics,
        spawnRig,
        getShipLayout().doors.map((door) => door.id),
      );
      const testSpawn = getShipLayout().testSpawn;
      console.info(
        `Ship sandbox: Rapier deck+pad with ${getShipLayout().colliders.length} colliders; spawn (${spawnLocal.right.toFixed(2)}, ${spawnFloorHint.toFixed(2)}, ${spawnLocal.forward.toFixed(2)})${testSpawn ? " from Test Spawn" : ""}.`,
      );
    } catch (error) {
      console.warn("Ship sandbox: failed to create Rapier deck physics.", error);
      shipPhysics = null;
    }
  }
  const disposeShipPhysics = () => {
    shipPhysics?.dispose();
    shipPhysics = null;
  };
  window.addEventListener("pagehide", disposeShipPhysics, { once: true });

  let character: CharacterState | DeckCharacterState = walkable
    ? createDeckCharacterState(
        ship,
        spawnLocal,
        undefined,
        spawnRig,
        spawnFloorHint,
      )
    : groundCharacterAt({ x: 12, y: 0, z: -16 }, { x: -0.5, y: 0, z: 0.65 });
  let prompt = "";
  let activeBedId: string | null = null;
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
    if (event.code === "KeyG") {
      rig.gearDown = !rig.gearDown;
      playShipGearToggleSfx(getShipLayout().spec, rig.gearDown);
    }
  });

  // --- sim ------------------------------------------------------------------------
  function clampLocalToSandboxPad(right: number, forward: number): {
    right: number;
    forward: number;
  } {
    const radial = Math.hypot(right, forward);
    const maxR = PAD_RADIUS_METERS - 2;
    if (radial <= maxR || radial < 1e-4) return { right, forward };
    const pull = maxR / radial;
    return { right: right * pull, forward: forward * pull };
  }

  function softTagWalkModeFromPad(): void {
    if (!shipPhysics) return;
    const local = getShipPlayerLocal(shipPhysics);
    // Camera/HUD only — locomotion always stays in ship Rapier when available.
    // Tight band so mid-ramp / deck keep ship-orbit camera.
    const onPad =
      Math.abs(local.up + sandboxPadRestHeightMeters()) <= 0.85;
    mode = onPad ? "ground" : "deck";
  }

  /**
   * Unified pad + hull + ramp walk via ship-local Rapier (no board/leave teleport).
   */
  function updateShipWalk(
    dt: number,
    actions: { interactPressed: boolean; jumpPressed: boolean },
  ): void {
    if (!shipPhysics) return;
    const input = controls.sampleCharacterInput();
    const colliderRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    shipPhysics.setPadEnabled(true);
    syncShipArticulationColliders(
      shipPhysics,
      colliderRig,
      getShipLayout().doors.map((door) => door.id),
    );
    const result = updateCharacterOnDeck(
      character as DeckCharacterState,
      ship,
      { ...input, jumpPressed: actions.jumpPressed },
      dt,
      SANDBOX_GRAVITY,
      colliderRig,
      shipPhysics,
    );
    character = result.state;
    prompt = "";

    if (result.dismounted || result.fellOffDeck) {
      // Keep Rapier authority — snap back onto the pad plane.
      const rest = sandboxPadRestHeightMeters();
      const local = getShipPlayerLocal(shipPhysics);
      const clamped = clampLocalToSandboxPad(local.right, local.forward);
      teleportShipPlayerLocal(shipPhysics, {
        right: clamped.right,
        up: -rest + DECK_FLOOR_OFFSET_METERS,
        forward: clamped.forward,
      });
      character = createDeckCharacterState(
        ship,
        clamped,
        undefined,
        colliderRig,
        -rest,
      );
      character.position = getShipPlayerWorldPosition(shipPhysics, ship);
      softTagWalkModeFromPad();
      return;
    }

    softTagWalkModeFromPad();
    const deckLocal = result.state.deckLocal;
    const onPad = mode === "ground";

    if (onPad) {
      if (nearShipRampOutside(character, ship)) {
        prompt = rig.rampDown ? "Press F — raise ramp" : "Press F — lower ramp";
        if (actions.interactPressed) {
          rig.rampDown = !rig.rampDown;
          playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
        }
      }
      return;
    }

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

    const cameraState = controls.sampleCameraState(0);
    const doorAim = resolveDoorInteractAim(
      ship,
      result.state.position,
      cameraState.yawRadians,
      cameraState.pitchRadians,
      cameraState.zoomDistance,
    );
    const bedNearby = nearestBed(deckLocal, doorAim);
    if (bedNearby) {
      prompt = bedInteractPrompt(bedNearby);
      if (actions.interactPressed) {
        activeBedId = bedNearby.id;
        transition = {
          start: {
            forward: character.forward,
            position: character.position,
            up: character.up,
          },
          end: getBedAnchor(ship, bedNearby.id),
          elapsed: 0,
          duration: LIE_TRANSITION_SECONDS,
        };
        mode = "lying";
      }
      return;
    }

    const doorNearby = nearestDoor(deckLocal, doorAim);
    if (doorNearby) {
      const door = getShipLayout().doors.find(
        (entry) => entry.id === doorNearby.doorId,
      );
      const doorRig = rig.doors[doorNearby.doorId];
      if (door && doorRig) {
        prompt = doorRig.isOpen
          ? `Press F — close ${door.label}`
          : `Press F — open ${door.label}`;
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
      prompt = rig.rampDown ? "Press F — raise ramp" : "Press F — lower ramp";
      if (actions.interactPressed) {
        rig.rampDown = !rig.rampDown;
        playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
      }
    }
  }

  function clampToSandboxPad(position: Vec3): Vec3 {
    const radial = Math.hypot(position.x, position.z);
    if (radial <= PAD_RADIUS_METERS - 1) return position;
    const pull = (PAD_RADIUS_METERS - 1) / radial;
    return { x: position.x * pull, y: position.y, z: position.z * pull };
  }

  /** Fallback when the ship has no collider deck (rare). */
  function updateGroundFallback(
    dt: number,
    actions: { interactPressed: boolean; jumpPressed: boolean },
  ): void {
    const input = controls.sampleCharacterInput();
    const moveX = input.moveX ?? 0;
    const moveY = input.moveY ?? 0;
    const yaw = input.cameraYawRadians ?? 0;
    const orbit = resolveSandboxOrbit(yaw, 0, ORBIT_PITCH_LIMIT);
    const moveDir = add(scale(orbit.right, moveX), scale(orbit.forward, moveY));
    const intent = resolveWalkInputIntent(input);
    const moveSpeed = intent.moveSpeedMetersPerSecond;
    const isMoving = intent.isMoving;
    const desiredDirection =
      isMoving && Math.hypot(moveDir.x, moveDir.z) > 1e-4
        ? normalize({ x: moveDir.x, y: 0, z: moveDir.z })
        : vec3(0, 0, 0);

    const motion = integrateCharacterLocomotion(
      character,
      {
        wantsJump: actions.jumpPressed,
        wantsSprint: intent.isSprinting,
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

    const desiredFacing = moveDir;
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
      animation: animationFromState({
        isMoving,
        gait: intent.gait,
        jumpPhase: motion.jumpPhase,
      }),
      upperBodyAnimation: null,
      forward,
      grounded: motion.grounded,
      jumpPhase: motion.jumpPhase,
      jumpPhaseTime: motion.jumpPhaseTime,
      position: motion.position,
      up: motion.up,
      velocity: motion.velocity,
    };
    prompt = "";
  }

  function updateTransitionMode(dt: number): void {
    if (!transition) return;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
    const eased = smoothstep01(transition.elapsed / transition.duration);
    const pose = createTransitionPose(transition.start, transition.end, eased);
    const entering = mode === "sitting" || mode === "lying";
    character = {
      animation: entering ? "Sitting_Enter" : "Sitting_Exit",
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
    } else if (mode === "lying") {
      mode = "in-bed";
    } else {
      // Prefer leave-pilot / bed stand pose location when available.
      const leave =
        mode === "getting-up" && activeBedId
          ? getDeckWorldPose(ship, getBedSpec(activeBedId)?.stand ?? { right: 0, forward: 0 })
          : getLeavePilotStandPose(ship);
      const leaveLocal = worldToShipLocal(ship, leave.position);
      const resumeLocal = {
        right: leaveLocal.right,
        forward: leaveLocal.forward,
      };
      const floorHint = getDeckSpawnFloorHint(resumeLocal);
      character = createDeckCharacterState(
        ship,
        resumeLocal,
        undefined,
        {
          gear01: rig.gear01,
          ramp01: rig.ramp01,
          doors: doorBlends(rig),
        },
        floorHint,
      );
      if (shipPhysics) {
        teleportShipPlayerLocal(shipPhysics, {
          right: resumeLocal.right,
          up: floorHint + DECK_FLOOR_OFFSET_METERS,
          forward: resumeLocal.forward,
        });
      }
      activeBedId = null;
      mode = "deck";
    }
    transition = null;
  }

  function beginGetUpFromBed(): void {
    if (!activeBedId) return;
    entertainmentSystem.close();
    esScreen.setInteractive(false);
    esScreen.setPowered(false);
    esScreen.setSpec(null);
    const bed = getBedAnchor(ship, activeBedId);
    const stand = getDeckWorldPose(
      ship,
      getBedSpec(activeBedId)?.stand ?? { right: 0, forward: 0 },
    );
    transition = {
      start: bed,
      end: stand,
      elapsed: 0,
      duration: GET_UP_FROM_BED_SECONDS,
    };
    mode = "getting-up";
    character = {
      animation: "Sitting_Exit",
      forward: bed.forward,
      grounded: true,
      jumpPhase: "grounded",
      jumpPhaseTime: 0,
      position: bed.position,
      up: bed.up,
      velocity: vec3(0, 0, 0),
    };
  }

  function updateInBed(
    actions: { exitSeatPressed: boolean; interactPressed: boolean },
  ): void {
    const layout = getShipLayout();
    const eyeLocal = getBedEyeLocal(activeBedId) ?? layout.pilotEye;
    const eye = localOffsetToWorld(ship, eyeLocal);
    const seat = controls.getSeatLook();
    const view = resolveSeatLookForward(
      ship.forward,
      ship.up,
      seat.yawRadians,
      seat.pitchRadians,
    );
    const esHit = resolveEntertainmentGazeTarget(
      layout.entertainmentSystems,
      ship,
      eye,
      view.forward,
    );

    if (layout.entertainmentSystems.length > 0) {
      esScreen.setSpec(esHit?.system ?? layout.entertainmentSystems[0]!);
    }

    if (esHit && actions.interactPressed && !entertainmentSystem.isOpen()) {
      esScreen.setPowered(true);
      esScreen.setInteractive(true);
      cockpitGazeHud.update({ visible: false });
      entertainmentSystem.open({
        onExitBed: () => beginGetUpFromBed(),
        onClose: () => {
          esScreen.setInteractive(false);
          esScreen.setPowered(false);
        },
      });
      prompt = "";
      return;
    }

    if (actions.exitSeatPressed) {
      beginGetUpFromBed();
      return;
    }

    esScreen.setInteractive(false);
    esScreen.setPowered(false);
    prompt = esHit
      ? `Press F — ${entertainmentSystemLabel(esHit.system)} · Hold Y — get up`
      : "Look around · Hold Y — get up";

    if (esHit) {
      const fovY = (camera.fov * Math.PI) / 180;
      const offset = projectWorldPointToScreenOffset(
        esHit.worldPosition,
        eye,
        view.forward,
        view.right,
        view.up,
        fovY,
        window.innerHeight,
      );
      if (!offset.behind) {
        cockpitGazeHud.update({
          visible: true,
          label: entertainmentSystemLabel(esHit.system),
          offsetPx: { x: offset.x, y: offset.y },
        });
        return;
      }
    }
    cockpitGazeHud.update({ visible: false });
  }

  function updatePilot(
    dt: number,
    actions: {
      exitSeatPressed: boolean;
      coupledToggled?: boolean;
      primaryClickPressed?: boolean;
    },
  ): void {
    const flightInput = controls.sampleFlightInput();
    const previousForward = ship.forward;
    const aim = controls.getFlightAim();
    const aimForward = resolveAimForward(ship, aim);
    const restHeight = getShipRestHeightMeters();
    const next = integrateSandboxFlightBody(
      ship,
      flightInput,
      dt,
      {
        gravityMps2: SANDBOX_GRAVITY,
        groundY: SANDBOX_GROUND_Y_METERS,
        restHeightMeters: restHeight,
        atmosphereHeightMeters: 80,
      },
      flightOptionsFromSpec(getShipLayout().spec, {
        coupled: controls.isCoupledMode(),
        aimForward,
      }),
    );
    Object.assign(ship, next);
    controls.setFlightAim(recenterAimAsNoseTracks(aim, ship, previousForward));

    flightCameraFeelFrame = updateFlightCameraFeel(
      flightCameraFeelState,
      {
        throttle01: flightInput.throttle01 ?? 0,
        strafe01: flightInput.strafe01 ?? 0,
        lift01: flightInput.lift01 ?? 0,
        boost01: flightInput.boost01 ?? 0,
      },
      getShipLayout().spec,
      dt,
    );
    const layout = getShipLayout();
    boostSfx.setLevel(
      layout.spec.boostSoundUrl,
      flightCameraFeelFrame.boost01 * layout.spec.boostSoundVolume,
    );
    thrustSfx.setLevel(
      layout.spec.thrustSoundUrl,
      flightCameraFeelFrame.thrust01 * layout.spec.thrustSoundVolume,
    );

    const speed = length(ship.velocity);
    const nearPad =
      Boolean(ship.grounded) || ship.position.y <= restHeight + 6;
    const parkedEnough = speed < 4;

    if (controls.isSeatLookActive()) {
      const eye = localOffsetToWorld(ship, layout.pilotEye);
      const seat = controls.getSeatLook();
      const view = resolveSeatLookForward(
        ship.forward,
        ship.up,
        seat.yawRadians,
        seat.pitchRadians,
        FIRST_PERSON_PITCH_LIMIT,
      );
      const hit = resolveCockpitGazeTarget(
        layout.cockpitControls,
        ship,
        eye,
        view.forward,
      );
      if (actions.primaryClickPressed && hit) {
        const applied = applyCockpitControlAction(hit.control.action, rig);
        if (applied) {
          playCockpitControlToggleSfx(
            hit.control.action,
            rig,
            getShipLayout().spec,
          );
        }
      }
    }

    if (actions.coupledToggled) {
      prompt = controls.isCoupledMode() ? "Coupled mode" : "Decoupled mode";
    } else if (actions.exitSeatPressed) {
      // Match main play: Hold Y always leaves the seat. Settle onto the pad
      // when nearby so deck walk starts from a parked ship.
      if (nearPad) {
        ship.position = {
          ...ship.position,
          y: Math.max(ship.position.y, restHeight),
        };
        ship.velocity = vec3(0, 0, 0);
        ship.angularVelocity = vec3(0, 0, 0);
        // Park level with the pad — keep yaw, kill flight pitch/roll.
        const flatForward = normalize({
          x: ship.forward.x,
          y: 0,
          z: ship.forward.z,
        });
        ship.forward =
          length(flatForward) > 1e-4 ? flatForward : { ...SHIP_FORWARD };
        ship.up = { ...WORLD_UP };
        ship.grounded = true;
      }
      transition = {
        start: getPilotSeatAnchor(ship),
        end: getLeavePilotStandPose(ship),
        elapsed: 0,
        duration: STAND_SECONDS,
      };
      mode = "standing";
      prompt = "";
    } else {
      prompt = parkedEnough
        ? "Hold F — look around · V camera · Hold Y — get up · Alt+C coupled"
        : "WASD thrust · mouse aim · Hold F look · V camera · Hold Y — get up · Alt+C";
    }

    const seat = controls.getSeatLook();
    const seatLooking = controls.isSeatLookActive();
    const freeLooking =
      seatLooking ||
      Math.abs(seat.yawRadians) > 1e-6 ||
      Math.abs(seat.pitchRadians) > 1e-6;
    const view = freeLooking
      ? resolveSeatLookForward(
          ship.forward,
          ship.up,
          seat.yawRadians,
          seat.pitchRadians,
          FIRST_PERSON_PITCH_LIMIT,
        )
      : {
          forward: ship.forward,
          up: ship.up,
          right: normalize(cross(ship.forward, ship.up)),
        };
    const aimDir = resolveAimForward(ship, controls.getFlightAim());
    const fovY = (camera.fov * Math.PI) / 180;
    const viewportH = window.innerHeight;
    const aimOff = projectDirectionToReticleOffset(
      aimDir,
      view.forward,
      view.right,
      view.up,
      fovY,
      viewportH,
    );
    const noseOff = projectDirectionToReticleOffset(
      ship.forward,
      view.forward,
      view.right,
      view.up,
      fovY,
      viewportH,
    );
    flightReticle.update({
      mode: MODE_IN_SHIP,
      flightMode: "combat",
      quantum: idleQuantum,
      dual: {
        aimOffsetPx: { x: aimOff.x, y: aimOff.y },
        noseOffsetPx: { x: noseOff.x, y: noseOff.y },
        coupled: controls.isCoupledMode(),
      },
    });

    const eye = localOffsetToWorld(ship, layout.pilotEye);
    const boost01 = flightCameraFeelFrame?.boost01 ?? 0;
    const scmMax = layout.spec.maxSpeedMps;
    const boostMax = resolveBoostMaxSpeedMps(scmMax);
    const speedViews = resolveVisibleCockpitSpeedInstruments(
      layout.cockpitStats,
      ship,
      eye,
      view.forward,
      view.right,
      view.up,
      fovY,
      viewportH,
    );
    if (speedViews.length > 0) {
      const speedMps = length(ship.velocity);
      cockpitSpeedHud.update({
        visible: true,
        instruments: speedViews.map((viewStat) => ({
          id: viewStat.id,
          offsetPx: viewStat.offsetPx,
          speedMps,
          scmMaxMps: scmMax,
          boostMaxMps: boostMax,
          boosting: boost01 > 0.05,
          boost01,
          ...(viewStat.label ? { label: viewStat.label } : {}),
        })),
      });
    } else {
      cockpitSpeedHud.update({ visible: false });
    }

    if (seatLooking) {
      const hit = resolveCockpitGazeTarget(
        layout.cockpitControls,
        ship,
        eye,
        view.forward,
      );
      if (hit) {
        const offset = projectWorldPointToScreenOffset(
          hit.worldPosition,
          eye,
          view.forward,
          view.right,
          view.up,
          fovY,
          viewportH,
        );
        if (!offset.behind) {
          cockpitGazeHud.update({
            visible: true,
            label: cockpitControlLabel(
              hit.control.action,
              { gearDown: rig.gearDown, rampDown: rig.rampDown },
              hit.control.label,
            ),
            offsetPx: { x: offset.x, y: offset.y },
          });
          return;
        }
      }
    }
    cockpitGazeHud.update({ visible: false });
  }

  // --- render loop -----------------------------------------------------------------
  function updateCamera(dt: number): void {
    const cameraState = controls.sampleCameraState(dt);
    if (mode === "in-bed") {
      flightCameraFeelFrame = null;
      const layout = getShipLayout();
      const eyeLocal = getBedEyeLocal(activeBedId) ?? layout.pilotEye;
      const eye = localOffsetToWorld(ship, eyeLocal);
      const seatLook = cameraState.seatLook;
      const lookingAround =
        seatLook &&
        (Math.abs(seatLook.yawRadians) > 1e-6 ||
          Math.abs(seatLook.pitchRadians) > 1e-6);
      const look = lookingAround
        ? resolveShipSeatLook(
            ship.forward,
            ship.up,
            seatLook.yawRadians,
            seatLook.pitchRadians,
            FIRST_PERSON_PITCH_LIMIT,
          )
        : { forward: ship.forward, up: ship.up };

      let feelEye = eye;
      let feelTarget = {
        x: eye.x + look.forward.x * 60,
        y: eye.y + look.forward.y * 60,
        z: eye.z + look.forward.z * 60,
      };
      let fovDelta = 0;
      if (layout.entertainmentSystems.length > 0) {
        const esHit = resolveEntertainmentGazeTarget(
          layout.entertainmentSystems,
          ship,
          eye,
          look.forward,
        );
        const screenSpec = esHit?.system ?? layout.entertainmentSystems[0]!;
        const screen = localOffsetToWorld(ship, screenSpec.position);
        const feel = updateEntertainmentCameraFeel(esCameraState, {
          dt,
          open: entertainmentSystem.isOpen(),
          gazing: Boolean(esHit),
          eye,
          screen,
          viewForward: look.forward,
        });
        if (feel) {
          feelEye = feel.eye;
          feelTarget = feel.lookTarget;
          fovDelta = feel.fovDeltaDeg;
        }
      } else {
        esCameraState.focus01 = 0;
      }

      if (typeof camera.userData.baseFovDeg !== "number") {
        camera.userData.baseFovDeg = camera.fov;
      }
      camera.fov = (camera.userData.baseFovDeg as number) + fovDelta;
      camera.updateProjectionMatrix();
      camera.position.set(feelEye.x, feelEye.y, feelEye.z);
      cameraTarget.set(feelTarget.x, feelTarget.y, feelTarget.z);
      camera.up.set(look.up.x, look.up.y, look.up.z);
      camera.lookAt(cameraTarget);
      camera.userData.smoothedPos = null;
      camera.userData.smoothedTarget = null;
      return;
    }
    esCameraState.focus01 = 0;
    if (mode === "pilot") {
      if (cameraState.shipCameraView === "external") {
        camera.fov = camera.userData.baseFovDeg as number;
        camera.updateProjectionMatrix();
        const zoom = cameraState.shipZoomDistance ?? 1;
        const back = 28 * zoom;
        const up = 8 * zoom;
        const lookAhead = 40;
        const desiredPos = new THREE.Vector3(
          ship.position.x - ship.forward.x * back + ship.up.x * up,
          ship.position.y - ship.forward.y * back + ship.up.y * up,
          ship.position.z - ship.forward.z * back + ship.up.z * up,
        );
        const desiredTarget = new THREE.Vector3(
          ship.position.x + ship.forward.x * lookAhead,
          ship.position.y + ship.forward.y * lookAhead,
          ship.position.z + ship.forward.z * lookAhead,
        );
        if (!camera.userData.smoothedPos) {
          camera.userData.smoothedPos = new THREE.Vector3().copy(desiredPos);
        }
        if (!camera.userData.smoothedTarget) {
          camera.userData.smoothedTarget = new THREE.Vector3().copy(desiredTarget);
        }
        smoothVector(camera.userData.smoothedPos, desiredPos, dt, 0.06);
        smoothVector(camera.userData.smoothedTarget, desiredTarget, dt, 0.04);
        camera.position.copy(camera.userData.smoothedPos);
        cameraTarget.copy(camera.userData.smoothedTarget);
        camera.up.set(ship.up.x, ship.up.y, ship.up.z);
        camera.lookAt(cameraTarget);
        return;
      }

      const eyeLocal = getShipLayout().pilotEye;
      const shake = flightCameraFeelFrame?.eyeShake;
      const eyeOffset = shake
        ? {
            right: eyeLocal.right + shake.right,
            up: eyeLocal.up + shake.up,
            forward: eyeLocal.forward + shake.forward,
          }
        : eyeLocal;
      const eye = localOffsetToWorld(ship, eyeOffset);
      const seatLook = cameraState.seatLook;
      const lookingAround =
        seatLook &&
        (Math.abs(seatLook.yawRadians) > 1e-6 ||
          Math.abs(seatLook.pitchRadians) > 1e-6);
      const look = lookingAround
        ? resolveShipSeatLook(
            ship.forward,
            ship.up,
            seatLook.yawRadians,
            seatLook.pitchRadians,
            FIRST_PERSON_PITCH_LIMIT,
          )
        : { forward: ship.forward, up: ship.up };
      camera.position.set(eye.x, eye.y, eye.z);
      cameraTarget.set(
        eye.x + look.forward.x * 60,
        eye.y + look.forward.y * 60,
        eye.z + look.forward.z * 60,
      );
      camera.up.set(look.up.x, look.up.y, look.up.z);
      camera.lookAt(cameraTarget);
      camera.fov =
        (camera.userData.baseFovDeg as number) +
        (flightCameraFeelFrame?.fovDeltaDeg ?? 0);
      camera.updateProjectionMatrix();

      camera.userData.smoothedPos = null;
      camera.userData.smoothedTarget = null;
      return;
    }

    flightCameraFeelFrame = null;
    camera.fov = camera.userData.baseFovDeg as number;
    camera.updateProjectionMatrix();

    // On the hull, orbit relative to ship frame so a pitched ship leans the camera too.
    const onShip =
      mode === "deck" ||
      mode === "sitting" ||
      mode === "standing" ||
      mode === "lying" ||
      mode === "getting-up";
    const orbit = onShip
      ? resolveDeckCameraOrbit(
          ship.forward,
          ship.up,
          cameraState.yawRadians,
          cameraState.pitchRadians,
          ORBIT_PITCH_LIMIT,
        )
      : resolveSandboxOrbit(
          cameraState.yawRadians,
          cameraState.pitchRadians,
          ORBIT_PITCH_LIMIT,
        );
    const orbitUp = onShip ? ship.up : WORLD_UP;
    const rigOffsets = resolveCharacterCameraRig(orbit, cameraState.zoomDistance);

    const desiredPos = new THREE.Vector3(
      character.position.x + rigOffsets.positionOffset.x,
      character.position.y + rigOffsets.positionOffset.y,
      character.position.z + rigOffsets.positionOffset.z,
    );
    const desiredTarget = new THREE.Vector3(
      character.position.x + rigOffsets.targetOffset.x,
      character.position.y + rigOffsets.targetOffset.y,
      character.position.z + rigOffsets.targetOffset.z,
    );

    if (!camera.userData.smoothedPos) {
      camera.userData.smoothedPos = new THREE.Vector3().copy(desiredPos);
    }
    if (!camera.userData.smoothedTarget) {
      camera.userData.smoothedTarget = new THREE.Vector3().copy(desiredTarget);
    }
    smoothVector(camera.userData.smoothedPos, desiredPos, dt, 0.05);
    smoothVector(camera.userData.smoothedTarget, desiredTarget, dt, 0.04);
    // Pull the camera in front of the first ship collider blocking the line
    // from the look target, so the eye never clips the hull or pad.
    if (shipPhysics) {
      const smoothedPos = camera.userData.smoothedPos as THREE.Vector3;
      const smoothedTarget = camera.userData.smoothedTarget as THREE.Vector3;
      const clamped = occludeShipCamera(
        shipPhysics,
        ship,
        { x: smoothedTarget.x, y: smoothedTarget.y, z: smoothedTarget.z },
        { x: smoothedPos.x, y: smoothedPos.y, z: smoothedPos.z },
      );
      smoothedPos.set(clamped.x, clamped.y, clamped.z);
    }
    camera.position.copy(camera.userData.smoothedPos);
    cameraTarget.copy(camera.userData.smoothedTarget);

    camera.up.set(orbitUp.x, orbitUp.y, orbitUp.z);
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
    const paused = gameMenu.isPaused() || entertainmentSystem.isPaused();
    const frameDt = Math.min((nowMs - lastMs) / 1000, 1 / 30);
    const dt = paused ? 0 : frameDt;
    lastMs = nowMs;

    if (!paused) {
      tryAutoRest();
      controls.setMode(
        mode === "pilot" ? "in-ship" : mode === "in-bed" ? "in-bed" : "on-foot",
      );
      const actions = controls.consumeActions();

      if (mode === "deck" || mode === "ground") {
        if (shipPhysics && walkable) updateShipWalk(dt, actions);
        else updateGroundFallback(dt, actions);
      } else if (mode === "pilot") updatePilot(dt, actions);
      else if (mode === "in-bed") updateInBed(actions);
      else updateTransitionMode(dt);

      if (mode !== "pilot") {
        boostSfx.stop();
        thrustSfx.stop();
        flightReticle.update({
          mode: MODE_ON_FOOT,
          flightMode: "traverse",
          quantum: idleQuantum,
        });
        if (mode !== "in-bed") {
          cockpitGazeHud.update({ visible: false });
        }
        cockpitSpeedHud.update({ visible: false });
      }

      updateShipRig(rig, dt);
      shipModel.setArticulation({
        gear01: rig.gear01,
        ramp01: rig.ramp01,
        doors: doorBlends(rig),
      });
      updateShipPlacement(shipModel.group, ship, vec3(0, 0, 0), 1);
      shipModel.group.userData.updateParticles?.(dt);
      shipModel.group.userData.updateObjectAnimations?.(dt);

      avatar.update(
        mode === "pilot" || mode === "in-bed"
          ? null
          : {
              animation: character.animation,
              upperBodyAnimation: character.upperBodyAnimation ?? null,
              forward: character.forward,
              position: character.position,
              up: character.up,
            },
        vec3(0, 0, 0),
        nowMs / 1000,
      );

      updateCamera(dt);
      camera.updateMatrixWorld();
      const matrix = camera.matrixWorld.elements;
      const worldForward = { x: -matrix[8], y: -matrix[9], z: -matrix[10] };
      const worldUp = { x: matrix[4], y: matrix[5], z: matrix[6] };
      let listenerPose: SoundListenerPose;
      let footstepPosition: Vec3;
      if (mode === "ground") {
        soundScene.setScene(null, []);
        listenerPose = {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          forward: worldForward,
          up: worldUp,
        };
        footstepPosition = character.position;
      } else {
        const local = worldToShipLocal(ship, {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        });
        const shipRight = getShipRight(ship);
        const shipForward = normalize(ship.forward);
        const toSceneVector = (vector: Vec3): Vec3 => ({
          x: -dot(vector, shipRight),
          y: dot(vector, ship.up),
          z: dot(vector, shipForward),
        });
        const characterLocal = worldToShipLocal(ship, character.position);
        listenerPose = {
          position: { x: -local.right, y: local.up, z: local.forward },
          forward: toSceneVector(worldForward),
          up: toSceneVector(worldUp),
        };
        footstepPosition = {
          x: -characterLocal.right,
          y: characterLocal.up,
          z: characterLocal.forward,
        };
        soundScene.setScene(`ship-preview:${prefabId}`, layout.sounds);
        soundScene.update(listenerPose);
      }
      footsteps.update(
        dt,
        listenerPose,
        mode === "deck" || mode === "ground"
          ? [
              {
                id: "ship-preview-player",
                position: footstepPosition,
                grounded: character.grounded,
                gait: footstepGaitFromIntent({
                  isMoving: length(character.velocity) > WALK_MOVE_THRESHOLD,
                  isSprinting:
                    length(character.velocity)
                    >= getCharacterSettings().sprintSpeedMetersPerSecond * 0.85,
                }),
                surface: "metal",
                spatial: false,
              },
            ]
          : [],
      );
    } else if (mode === "in-bed" || entertainmentSystem.isOpen()) {
      // Keep SC-style screen zoom easing while the ES UI pauses input.
      updateCamera(frameDt);
      camera.updateMatrixWorld();
    }

    composer.render(dt);

    if (mode === "in-bed" || entertainmentSystem.isOpen()) {
      esScreen.sync();
      esScreen.render(camera);
    }

    interactPromptEl.textContent = prompt;
    interactPromptEl.classList.toggle("is-visible", prompt.length > 0);

    if (!paused) {
      fpsAccum += dt;
      fpsFrames += 1;
      if (nowMs - fpsLastUpdate > 500 && fpsAccum > 0) {
        fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum));
        fpsAccum = 0;
        fpsFrames = 0;
        fpsLastUpdate = nowMs;
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame((now) => {
    lastMs = now;
    requestAnimationFrame(frame);
  });
}
