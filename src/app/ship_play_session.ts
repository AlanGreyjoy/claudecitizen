import { createPlayerControls } from '../input/player_controls';
import { loadCurrentDefaultAnimationController } from '../player/animation';
import { loadCurrentCharacterSettings } from '../player/character_settings';
import {
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  getSandboxDeckSpawn,
} from '../player/ship_deck';
import {
  getShipLayout,
  getShipRestHeightMeters,
  usesColliderDeck,
} from '../player/ship_layout';
import { createShipPhysics, syncShipArticulationColliders } from '../physics/ship_physics';
import type { ShipColliderRigState } from '../physics/colliders';
import { createShipRigState, doorBlends } from '../player/ship_rig';
import { createCharacterAvatar } from '../render/main/scene/character_avatar';
import { createShipModel } from '../render/main/scene/ship_model';
import { attachPrefabParticleSystems } from '../render/particles';
import { attachPrefabObjectAnimations } from '../render/prefabs/object_animation';
import { vec3 } from '../math/vec3';
import type { FlightBody } from '../types';
import { createUiIcon, UiIcons } from '../ui/icons';
import { createSoundSceneController } from '../audio/sound_scene';
import { createFootstepController } from '../audio/footsteps';
import { createLoopingSfxController } from '../audio/sfx';
import { createFlightReticle } from '../render/effects/hud/flight_reticle';
import { createCockpitGazeHud } from '../render/effects/hud/cockpit_gaze_hud';
import { createCockpitSpeedHud } from '../render/effects/hud/cockpit_speed_hud';
import { createGameMenu } from '../render/effects/hud/game_menu';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment_system';
import { createEntertainmentScreen } from '../render/effects/entertainment_screen';
import { createEntertainmentCameraState } from '../player/entertainment_camera';
import { createFlightCameraFeelState } from '../player/flight_camera_feel';
import { createQuantumTravelState } from '../flight/quantum_travel';
import { playShipGearToggleSfx } from '../player/ship_articulation_sfx';
import { loadShipSandboxPrefab } from './ship_sandbox/setup';
import { createShipSandboxScene, resizeShipSandboxScene } from './ship_sandbox/scene';
import { groundCharacterAt } from './ship_sandbox/ground';
import { startShipSandboxLoop } from './ship_sandbox/frame';
import type { ShipSandboxSession } from './ship_sandbox/types';
import { PAD_RADIUS_METERS, SHIP_FORWARD, WORLD_UP } from './ship_sandbox/types';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function mountBanner(prefabId: string, hintText: string, isWarning: boolean): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.title =
    'Return to the editor with this prefab loaded (Esc opens the menu and unlocks the mouse)';
  button.append(
    createUiIcon(UiIcons.chevronLeft, { className: 'sc-ui-icon', size: 14, strokeWidth: 2 }),
    document.createTextNode(` Back to Editor (${prefabId})`),
  );
  Object.assign(button.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '250',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '9px 18px',
    border: '1px solid rgba(255, 206, 111, 0.5)',
    background: 'rgba(6, 12, 26, 0.88)',
    color: 'var(--accent-2, #ffce6f)',
    font: "600 13px/1 'Rajdhani', sans-serif",
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('click', () => {
    window.location.href = `/?boot=editor&prefab=${encodeURIComponent(prefabId)}`;
  });
  document.body.appendChild(button);

  const hint = document.createElement('div');
  hint.textContent = hintText;
  Object.assign(hint.style, {
    position: 'fixed',
    bottom: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '250',
    padding: '8px 16px',
    border: '1px solid rgba(90, 190, 255, 0.35)',
    background: 'rgba(6, 12, 26, 0.82)',
    color: isWarning ? 'var(--accent-2, #ffce6f)' : 'var(--muted, #8fa3c9)',
    font: "500 12px/1.4 'Rajdhani', sans-serif",
    letterSpacing: '0.08em',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(hint);
}

function hideFullGameHudChrome(): void {
  for (const selector of [
    '.sc-hud-chat',
    '.sc-hud-debug-wrap',
    '#hud-build-btn',
    '#weapon-crosshair',
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = 'none';
  }
}

function configureSandboxGameMenu(gameMenuEl: HTMLElement, gameMenuExitBtn: HTMLButtonElement): void {
  const exitCopyEl = gameMenuEl.querySelector<HTMLElement>('.sc-game-menu-exit-copy');
  const exitPanelTitleEl = gameMenuEl.querySelector<HTMLElement>(
    '#game-menu-panel-exit .sc-game-menu-panel-title',
  );
  const exitNavBtn = gameMenuEl.querySelector<HTMLButtonElement>(
    '[data-game-menu-tab="exit"]',
  );
  if (exitCopyEl) {
    exitCopyEl.textContent =
      'Leave ship preview and return to the prefab editor with this ship loaded.';
  }
  if (exitPanelTitleEl) exitPanelTitleEl.textContent = 'Back to Editor';
  if (exitNavBtn) exitNavBtn.textContent = 'Back to Editor';
  gameMenuExitBtn.textContent = 'Back to Editor';
}

async function createShipSandboxPhysics(
  walkable: boolean,
  spawnLocal: { right: number; forward: number },
  spawnFloorHint: number,
  spawnRig: ShipColliderRigState,
  padRestHeightMeters: number,
) {
  if (!walkable || !usesColliderDeck()) return null;
  try {
    const shipPhysics = await createShipPhysics(
      {
        right: spawnLocal.right,
        up: spawnFloorHint + DECK_FLOOR_OFFSET_METERS,
        forward: spawnLocal.forward,
      },
      getShipLayout().colliders,
      {
        pad: {
          restHeightMeters: padRestHeightMeters,
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
      `Ship sandbox: Rapier deck+pad with ${getShipLayout().colliders.length} colliders; spawn (${spawnLocal.right.toFixed(2)}, ${spawnFloorHint.toFixed(2)}, ${spawnLocal.forward.toFixed(2)})${testSpawn ? ' from Test Spawn' : ''}.`,
    );
    return shipPhysics;
  } catch (error) {
    console.warn('Ship sandbox: failed to create Rapier deck physics.', error);
    return null;
  }
}

let started = false;

export async function startShipPlaySession(prefabId: string): Promise<void> {
  if (started) return;
  started = true;

  await Promise.all([
    loadCurrentCharacterSettings(),
    loadCurrentDefaultAnimationController(),
  ]);

  const { doc, prefabApplied, walkable, hint } = await loadShipSandboxPrefab(prefabId);
  const editorReturnUrl = `/?boot=editor&prefab=${encodeURIComponent(prefabId)}`;

  document.getElementById('title-screen')?.classList.add('is-hidden');
  requireElement<HTMLElement>('app').classList.remove('is-hidden');
  mountBanner(prefabId, hint, !walkable);
  hideFullGameHudChrome();

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
  window.addEventListener('pagehide', () => {
    entertainmentSystem.dispose();
    window.removeEventListener('resize', onEsResize);
    esScreen.dispose();
  }, { once: true });

  const gameMenuEl = requireElement<HTMLElement>('game-menu');
  configureSandboxGameMenu(gameMenuEl, requireElement<HTMLButtonElement>('game-menu-exit-btn'));
  const gameMenu = createGameMenu(
    {
      rootEl: gameMenuEl,
      resumeBtnEl: requireElement<HTMLButtonElement>('game-menu-resume-btn'),
      exitBtnEl: requireElement<HTMLButtonElement>('game-menu-exit-btn'),
      chatInputEl: requireElement<HTMLInputElement>('hud-chat-input'),
      masterVolumeEl: requireElement<HTMLInputElement>('game-menu-master-volume'),
      sfxVolumeEl: requireElement<HTMLInputElement>('game-menu-sfx-volume'),
      musicVolumeEl: requireElement<HTMLInputElement>('game-menu-music-volume'),
      masterValueEl: requireElement<HTMLElement>('game-menu-master-value'),
      sfxValueEl: requireElement<HTMLElement>('game-menu-sfx-value'),
      musicValueEl: requireElement<HTMLElement>('game-menu-music-value'),
    },
    { onExitGame: () => { window.location.href = editorReturnUrl; } },
  );
  window.addEventListener('pagehide', () => gameMenu.dispose(), { once: true });

  const sandboxScene = createShipSandboxScene(canvas);
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

  const avatar = createCharacterAvatar(sandboxScene.scene, 1);
  const ship: FlightBody = {
    angularVelocity: vec3(0, 0, 0),
    forward: { ...SHIP_FORWARD },
    grounded: true,
    position: { x: 0, y: getShipRestHeightMeters(), z: 0 },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
  window.addEventListener('pagehide', () => {
    soundScene.dispose();
    footsteps.dispose();
    boostSfx.stop();
    thrustSfx.stop();
    shipModel.group.userData.disposeParticleSystems?.();
  }, { once: true });

  const rig = createShipRigState({ gearDown: true, rampDown: true });
  rig.ramp01 = 1;
  const spawnRig = { gear01: rig.gear01, ramp01: rig.ramp01, doors: doorBlends(rig) };
  const sandboxSpawn = getSandboxDeckSpawn(spawnRig);
  const padRestHeight = Math.max(0.3, ship.position.y - 0.05);
  const shipPhysics = await createShipSandboxPhysics(
    walkable,
    sandboxSpawn.local,
    sandboxSpawn.floorUp,
    spawnRig,
    padRestHeight,
  );
  window.addEventListener('pagehide', () => shipPhysics?.dispose(), { once: true });

  const session: ShipSandboxSession = {
    prefabId,
    walkable,
    doc,
    prefabApplied,
    mode: walkable ? 'deck' : 'ground',
    ship,
    character: walkable
      ? createDeckCharacterState(ship, sandboxSpawn.local, undefined, spawnRig, sandboxSpawn.floorUp)
      : groundCharacterAt({ x: 12, y: 0, z: -16 }, { x: -0.5, y: 0, z: 0.65 }),
    rig,
    shipPhysics,
    prompt: '',
    activeBedId: null,
    transition: null,
    autoRestPending: layout.restHeightMeters === null,
    controls: createPlayerControls(canvas),
    renderer: sandboxScene.renderer,
    scene: sandboxScene.scene,
    camera: sandboxScene.camera,
    cameraTarget: sandboxScene.cameraTarget,
    composer: sandboxScene.composer,
    n8aoPass: sandboxScene.n8aoPass,
    shipModel,
    avatar,
    flightReticle,
    cockpitGazeHud,
    cockpitSpeedHud,
    entertainmentSystem,
    esScreen,
    esCameraState: createEntertainmentCameraState(),
    gameMenu,
    soundScene,
    footsteps,
    boostSfx,
    thrustSfx,
    idleQuantum: createQuantumTravelState(),
    flightCameraFeelState: createFlightCameraFeelState(),
    flightCameraFeelFrame: null,
    fpsEl,
    interactPromptEl,
    lastMs: 0,
    fpsAccum: 0,
    fpsFrames: 0,
    fpsLastUpdate: 0,
  };
  session.controls.setMode('on-foot');
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyG') {
      session.rig.gearDown = !session.rig.gearDown;
      playShipGearToggleSfx(getShipLayout().spec, session.rig.gearDown);
    }
  });
  window.addEventListener('resize', () => resizeShipSandboxScene(sandboxScene));
  resizeShipSandboxScene(sandboxScene);
  startShipSandboxLoop(session);
}
