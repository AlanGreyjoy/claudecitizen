import { createPlayerControls } from '../input/player-controls';
import { createDeckCharacterState } from '../player/ship-deck';
import { getShipLayout, getShipRestHeightMeters } from '../player/ship-layout';
import { createShipModel } from '../render/main/scene/ship-model';
import { createCharacterAvatar } from '../render/main/scene/character-avatar';
import {
  clonePlayerCharacterAppearance,
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
} from '../player/character_creator/player-character-appearance';
import { attachPrefabParticleSystems } from '../render/particles';
import { attachPrefabObjectAnimations } from '../render/prefabs/object-animation';
import { vec3 } from '../math/vec3';
import type { FlightBody } from '../types';
import { createSoundSceneController } from '../audio/sound-scene';
import { createFootstepController } from '../audio/footsteps';
import { createLoopingSfxController } from '../audio/sfx';
import { createFlightReticle } from '../render/effects/hud/flight-reticle';
import { createCockpitGazeHud } from '../render/effects/hud/cockpit-gaze-hud';
import { createCockpitSpeedHud } from '../render/effects/hud/cockpit-speed-hud';
import { createGameMenu } from '../render/effects/hud/game-menu';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment-system';
import { createEntertainmentScreen } from '../render/effects/entertainment-screen';
import { createEntertainmentCameraState } from '../player/entertainment-camera';
import { createFlightCameraFeelState } from '../player/flight-camera-feel';
import { createQuantumTravelState } from '../flight/quantum-travel';
import type { ShipSandboxScene } from './ship_sandbox/scene';
import { groundCharacterAt } from './ship_sandbox/ground';
import type { ShipSandboxSession } from './ship_sandbox/types';
import { SHIP_FORWARD, WORLD_UP } from './ship_sandbox/types';
import type { PrefabDocument } from '../world/prefabs/schema';
import type { createShipPhysics } from '../physics/ship-physics';
import type { createShipRigState } from '../player/ship-rig';
import type { ShipColliderRigState } from '../physics/colliders';

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

/** Collects teardown for everything a sandbox session creates. */
export type SandboxDisposeCollector = (dispose: () => void) => void;

export function createSandboxHudOverlays(options: {
  /** Runs when the player picks Exit in the in-game menu. */
  onExit: () => void;
  addDispose: SandboxDisposeCollector;
}): {
  canvas: HTMLCanvasElement;
  fpsEl: HTMLElement;
  interactPromptEl: HTMLElement;
  flightReticle: ReturnType<typeof createFlightReticle>;
  cockpitGazeHud: ReturnType<typeof createCockpitGazeHud>;
  cockpitSpeedHud: ReturnType<typeof createCockpitSpeedHud>;
  entertainmentSystem: ReturnType<typeof createEntertainmentSystem>;
  esScreen: ReturnType<typeof createEntertainmentScreen>;
  gameMenu: ReturnType<typeof createGameMenu>;
} {
  const canvas = requireElement<HTMLCanvasElement>('view');
  const fpsEl = requireElement<HTMLElement>('hud-fps-value');
  const interactPromptEl = requireElement<HTMLElement>('interact-prompt');
  const flightReticle = createFlightReticle({ rootEl: requireElement<HTMLElement>('flight-reticle') });
  const cockpitGazeHud = createCockpitGazeHud({ rootEl: requireElement<HTMLElement>('cockpit-gaze') });
  const cockpitSpeedHud = createCockpitSpeedHud({ rootEl: requireElement<HTMLElement>('cockpit-speed') });
  const entertainmentSystem = createEntertainmentSystem({
    rootEl: requireElement<HTMLElement>('entertainment-system'),
    homeEl: requireElement<HTMLElement>('es-home'),
    docsEl: requireElement<HTMLElement>('es-docs'),
    youtubeEl: requireElement<HTMLElement>('es-youtube'),
    nasaEl: requireElement<HTMLElement>('es-nasa'),
    localnowEl: requireElement<HTMLElement>('es-localnow'),
    docsFrameEl: requireElement<HTMLIFrameElement>('es-docs-frame'),
    youtubeFrameEl: requireElement<HTMLIFrameElement>('es-youtube-frame'),
    nasaFrameEl: requireElement<HTMLIFrameElement>('es-nasa-frame'),
    youtubeUrlInputEl: requireElement<HTMLInputElement>('es-youtube-url'),
    youtubeGridEl: requireElement<HTMLElement>('es-youtube-grid'),
    powerBtnEl: requireElement<HTMLButtonElement>('es-power-btn'),
    backBtnEl: requireElement<HTMLButtonElement>('es-back-btn'),
    closeBtnEl: requireElement<HTMLButtonElement>('es-close-btn'),
    docsTileEl: requireElement<HTMLButtonElement>('es-docs-tile'),
    youtubeTileEl: requireElement<HTMLButtonElement>('es-youtube-tile'),
    nasaTileEl: requireElement<HTMLButtonElement>('es-nasa-tile'),
    localnowTileEl: requireElement<HTMLButtonElement>('es-localnow-tile'),
    localnowOpenBtnEl: requireElement<HTMLButtonElement>('es-localnow-open-btn'),
    youtubeLoadBtnEl: requireElement<HTMLButtonElement>('es-youtube-load-btn'),
  });
  const esScreen = createEntertainmentScreen({ panelEl: requireElement<HTMLElement>('es-bezel') });
  const onEsResize = () => esScreen.resize();
  window.addEventListener('resize', onEsResize);
  options.addDispose(() => {
    entertainmentSystem.dispose();
    window.removeEventListener('resize', onEsResize);
    esScreen.dispose();
  });

  const gameMenuEl = requireElement<HTMLElement>('game-menu');
  const exitCopyEl = gameMenuEl.querySelector<HTMLElement>('.sc-game-menu-exit-copy');
  const exitPanelTitleEl = gameMenuEl.querySelector<HTMLElement>(
    '#game-menu-panel-exit .sc-game-menu-panel-title',
  );
  const exitNavBtn = gameMenuEl.querySelector<HTMLButtonElement>(
    '[data-game-menu-tab="exit"]',
  );
  const gameMenuExitBtn = requireElement<HTMLButtonElement>('game-menu-exit-btn');
  if (exitCopyEl) {
    exitCopyEl.textContent =
      'Leave ship preview and return to the prefab editor with this ship loaded.';
  }
  if (exitPanelTitleEl) exitPanelTitleEl.textContent = 'Back to Editor';
  if (exitNavBtn) exitNavBtn.textContent = 'Back to Editor';
  gameMenuExitBtn.textContent = 'Back to Editor';
  const gameMenu = createGameMenu(
    {
      rootEl: gameMenuEl,
      resumeBtnEl: requireElement<HTMLButtonElement>('game-menu-resume-btn'),
      exitBtnEl: gameMenuExitBtn,
      chatInputEl: requireElement<HTMLInputElement>('hud-chat-input'),
      masterVolumeEl: requireElement<HTMLInputElement>('game-menu-master-volume'),
      sfxVolumeEl: requireElement<HTMLInputElement>('game-menu-sfx-volume'),
      musicVolumeEl: requireElement<HTMLInputElement>('game-menu-music-volume'),
      masterValueEl: requireElement<HTMLElement>('game-menu-master-value'),
      sfxValueEl: requireElement<HTMLElement>('game-menu-sfx-value'),
      musicValueEl: requireElement<HTMLElement>('game-menu-music-value'),
    },
    { onExitGame: options.onExit },
  );
  options.addDispose(() => gameMenu.dispose());

  return {
    canvas,
    fpsEl,
    interactPromptEl,
    flightReticle,
    cockpitGazeHud,
    cockpitSpeedHud,
    entertainmentSystem,
    esScreen,
    gameMenu,
  };
}

export function createSandboxShipVisuals(
  sandboxScene: ShipSandboxScene,
  doc: PrefabDocument | null,
  prefabApplied: boolean,
  esScreen: ReturnType<typeof createEntertainmentScreen>,
  addDispose: SandboxDisposeCollector,
): {
  shipModel: ReturnType<typeof createShipModel>;
  avatar: ReturnType<typeof createCharacterAvatar>;
  soundScene: ReturnType<typeof createSoundSceneController>;
  footsteps: ReturnType<typeof createFootstepController>;
  boostSfx: ReturnType<typeof createLoopingSfxController>;
  thrustSfx: ReturnType<typeof createLoopingSfxController>;
  ship: FlightBody;
  layout: ReturnType<typeof getShipLayout>;
} {
  const layout = getShipLayout();
  const soundScene = createSoundSceneController();
  const footsteps = createFootstepController();
  const boostSfx = createLoopingSfxController();
  const thrustSfx = createLoopingSfxController();
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
  sandboxScene.scene.add(shipModel.group);
  esScreen.attachTo(shipModel.group);
  window.__claudecitizenShipModel = shipModel;
  if (doc && prefabApplied) {
    attachPrefabParticleSystems(doc, shipModel.group);
    attachPrefabObjectAnimations(doc, shipModel.group);
  }

  // Without an appearance the avatar builds the legacy UAL mannequin, whose GLB
  // is not part of a project — it load-errors and renders nothing, so the
  // playtest looks like it spawned no character at all. Same default the
  // no-auth editor Play path uses.
  const avatar = createCharacterAvatar(
    sandboxScene.scene,
    1,
    clonePlayerCharacterAppearance(DEFAULT_PLAYER_CHARACTER_APPEARANCE),
  );
  const ship: FlightBody = {
    angularVelocity: vec3(0, 0, 0),
    forward: { ...SHIP_FORWARD },
    grounded: true,
    position: { x: 0, y: getShipRestHeightMeters(), z: 0 },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
  addDispose(() => {
    soundScene.dispose();
    footsteps.dispose();
    boostSfx.stop();
    thrustSfx.stop();
    shipModel.group.userData.disposeParticleSystems?.();
    shipModel.group.removeFromParent();
    avatar.dispose();
    if (window.__claudecitizenShipModel === shipModel) {
      delete window.__claudecitizenShipModel;
    }
  });

  return {
    shipModel,
    avatar,
    soundScene,
    footsteps,
    boostSfx,
    thrustSfx,
    ship,
    layout,
  };
}

export function buildShipSandboxSession(options: {
  prefabId: string;
  walkable: boolean;
  doc: PrefabDocument | null;
  prefabApplied: boolean;
  ship: FlightBody;
  rig: ReturnType<typeof createShipRigState>;
  layout: ReturnType<typeof getShipLayout>;
  shipPhysics: Awaited<ReturnType<typeof createShipPhysics>> | null;
  sandboxScene: ShipSandboxScene;
  overlays: ReturnType<typeof createSandboxHudOverlays>;
  visuals: ReturnType<typeof createSandboxShipVisuals>;
  spawnLocal: { right: number; forward: number };
  spawnFloorUp: number;
  spawnRig: ShipColliderRigState;
}): ShipSandboxSession {
  const { overlays, visuals, sandboxScene } = options;
  return {
    prefabId: options.prefabId,
    walkable: options.walkable,
    doc: options.doc,
    prefabApplied: options.prefabApplied,
    mode: options.walkable ? 'deck' : 'ground',
    ship: options.ship,
    character: options.walkable
      ? createDeckCharacterState(
        options.ship,
        options.spawnLocal,
        undefined,
        options.spawnRig,
        options.spawnFloorUp,
      )
      : groundCharacterAt({ x: 12, y: 0, z: -16 }, { x: -0.5, y: 0, z: 0.65 }),
    rig: options.rig,
    shipPhysics: options.shipPhysics,
    prompt: '',
    activeBedId: null,
    ladderClimb: null,
    transition: null,
    autoRestPending: options.layout.restHeightMeters === null,
    controls: createPlayerControls(overlays.canvas),
    renderer: sandboxScene.renderer,
    scene: sandboxScene.scene,
    camera: sandboxScene.camera,
    cameraTarget: sandboxScene.cameraTarget,
    composer: sandboxScene.composer,
    n8aoPass: sandboxScene.n8aoPass,
    shipModel: visuals.shipModel,
    avatar: visuals.avatar,
    flightReticle: overlays.flightReticle,
    cockpitGazeHud: overlays.cockpitGazeHud,
    cockpitSpeedHud: overlays.cockpitSpeedHud,
    entertainmentSystem: overlays.entertainmentSystem,
    esScreen: overlays.esScreen,
    esCameraState: createEntertainmentCameraState(),
    gameMenu: overlays.gameMenu,
    soundScene: visuals.soundScene,
    footsteps: visuals.footsteps,
    boostSfx: visuals.boostSfx,
    thrustSfx: visuals.thrustSfx,
    idleQuantum: createQuantumTravelState(),
    flightCameraFeelState: createFlightCameraFeelState(),
    flightCameraFeelFrame: null,
    fpsEl: overlays.fpsEl,
    interactPromptEl: overlays.interactPromptEl,
    running: false,
    externallyPaused: false,
    frameHandle: 0,
    lastMs: 0,
    fpsAccum: 0,
    fpsFrames: 0,
    fpsLastUpdate: 0,
  };
}
