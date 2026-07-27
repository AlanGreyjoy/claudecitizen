import { mountPlayChrome, unmountPlayChrome } from './play-chrome';
import { loadCurrentDefaultAnimationController } from '../player/animation';
import { loadCurrentCharacterSettings } from '../player/character-settings';
import {
  DECK_FLOOR_OFFSET_METERS,
  getSandboxDeckSpawn,
} from '../player/ship-deck';
import {
  getShipLayout,
  usesColliderDeck,
} from '../player/ship-layout';
import { createShipPhysics, syncShipArticulationColliders } from '../physics/ship-physics';
import type { ShipColliderRigState } from '../physics/colliders';
import { createShipRigState, doorBlends } from '../player/ship-rig';
import { createUiIcon, UiIcons } from '../ui/icons';
import { playShipGearToggleSfx } from '../player/ship-articulation-sfx';
import { clearActiveShipPrefab } from '../world/ships';
import type { PrefabDocument } from '../world/prefabs/schema';
import {
  applyShipSandboxDocument,
  loadShipSandboxPrefab,
  type ShipSandboxPrefabLoad,
} from './ship_sandbox/setup';
import {
  createShipSandboxScene,
  disposeShipSandboxScene,
  resizeShipSandboxScene,
} from './ship_sandbox/scene';
import { startShipSandboxLoop, stopShipSandboxLoop } from './ship_sandbox/frame';
import { PAD_RADIUS_METERS } from './ship_sandbox/types';
import {
  buildShipSandboxSession,
  createSandboxHudOverlays,
  createSandboxShipVisuals,
} from './ship-play-session-helpers';

export interface ShipSandboxSessionHandle {
  /** True when the prefab is walkable; false means hull-only preview. */
  walkable: boolean;
  /** True when the hull is boarded from the ground instead of a deck. */
  exteriorEntry: boolean;
  /** One-line status for the caller's banner / bar. */
  hint: string;
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  stop: () => void;
}

export interface ShipSandboxSessionOptions {
  prefabId: string;
  /**
   * In-memory ship document. The editor passes its unsaved document so Test
   * flies what is on screen; omit to fetch the saved prefab by id.
   */
  document?: PrefabDocument | null;
  /** Runs when the player picks Exit in the in-game menu. */
  onExit?: () => void;
}

function mountBanner(prefabId: string, hintText: string, isWarning: boolean): () => void {
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
    window.location.href = `/editor.html?boot=editor&prefab=${encodeURIComponent(prefabId)}`;
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

  return () => {
    button.remove();
    hint.remove();
  };
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

async function resolveSandboxPrefab(
  options: ShipSandboxSessionOptions,
): Promise<ShipSandboxPrefabLoad> {
  if (options.document !== undefined) {
    return applyShipSandboxDocument(options.document, options.prefabId);
  }
  return loadShipSandboxPrefab(options.prefabId);
}

/**
 * Runs a ship on an isolated pad: walk the deck, work the ramp and doors, sit
 * the pilot seat, take off, fly. Everything it creates is owned by the
 * returned handle, so the editor can start and stop it repeatedly without
 * leaking a WebGL context, a Rapier world, or the global ship layout override.
 */
export async function startShipSandboxSession(
  options: ShipSandboxSessionOptions,
): Promise<ShipSandboxSessionHandle> {
  await Promise.all([
    loadCurrentCharacterSettings(),
    loadCurrentDefaultAnimationController(),
  ]);

  const disposers: (() => void)[] = [];
  const addDispose = (dispose: () => void): void => {
    disposers.push(dispose);
  };
  const listeners = new AbortController();

  const { doc, prefabApplied, walkable, exteriorEntry, hint } =
    await resolveSandboxPrefab(options);

  // Editor Play hosts chrome in `#editor-play-host`; a body mount would leave
  // that host as an opaque overlay swallowing clicks.
  const chromeParent = document.getElementById('editor-play-host') ?? document.body;
  mountPlayChrome(chromeParent).classList.remove('is-hidden');
  hideFullGameHudChrome();

  let stopped = false;
  // The in-game Exit button is wired before `stop` exists, so it goes through
  // this indirection rather than a half-built handle.
  let stopSession: (() => void) | null = null;

  const overlays = createSandboxHudOverlays({
    onExit: () => {
      if (options.onExit) options.onExit();
      else stopSession?.();
    },
    addDispose,
  });
  const sandboxScene = createShipSandboxScene(overlays.canvas);
  const visuals = createSandboxShipVisuals(
    sandboxScene,
    doc,
    prefabApplied,
    overlays.esScreen,
    addDispose,
  );

  const rig = createShipRigState({ gearDown: true, rampDown: true });
  rig.ramp01 = 1;
  const spawnRig = { gear01: rig.gear01, ramp01: rig.ramp01, doors: doorBlends(rig) };
  const sandboxSpawn = getSandboxDeckSpawn(spawnRig);
  const padRestHeight = Math.max(0.3, visuals.ship.position.y - 0.05);
  const shipPhysics = await createShipSandboxPhysics(
    walkable,
    sandboxSpawn.local,
    sandboxSpawn.floorUp,
    spawnRig,
    padRestHeight,
  );

  const session = buildShipSandboxSession({
    prefabId: options.prefabId,
    walkable,
    exteriorEntry,
    doc,
    prefabApplied,
    ship: visuals.ship,
    rig,
    layout: visuals.layout,
    shipPhysics,
    sandboxScene,
    overlays,
    visuals,
    spawnLocal: sandboxSpawn.local,
    spawnFloorUp: sandboxSpawn.floorUp,
    spawnRig,
  });
  session.controls.setMode('on-foot');

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'KeyG') return;
      session.rig.gearDown = !session.rig.gearDown;
      playShipGearToggleSfx(getShipLayout().spec, session.rig.gearDown);
    },
    { signal: listeners.signal },
  );
  window.addEventListener('resize', () => resizeShipSandboxScene(sandboxScene), {
    signal: listeners.signal,
  });
  resizeShipSandboxScene(sandboxScene);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    listeners.abort();
    stopShipSandboxLoop(session);
    session.controls.dispose();
    shipPhysics?.dispose();
    // Reverse order: visuals were built on top of the overlays they use.
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]();
    disposeShipSandboxScene(sandboxScene);
    unmountPlayChrome();
    // The layout override is a module global; leaving it set would make the
    // next ship — or a scene Play — fly this hull.
    clearActiveShipPrefab();
  }
  stopSession = stop;
  window.addEventListener('pagehide', stop, { once: true, signal: listeners.signal });

  startShipSandboxLoop(session);
  return {
    walkable,
    exteriorEntry,
    hint,
    setPaused: (paused) => {
      session.externallyPaused = paused;
      if (paused) {
        session.boostSfx.stop();
        session.thrustSfx.stop();
      }
    },
    isPaused: () => session.externallyPaused,
    stop,
  };
}

let urlSessionStarted = false;

/**
 * `?shipPrefab=<id>` boot: the standalone page form of the sandbox. The editor
 * uses `startShipSandboxSession` directly.
 */
export async function startShipPlaySession(prefabId: string): Promise<void> {
  if (urlSessionStarted) return;
  urlSessionStarted = true;

  const editorReturnUrl = `/editor.html?boot=editor&prefab=${encodeURIComponent(prefabId)}`;
  document.getElementById('title-screen')?.classList.add('is-hidden');
  const session = await startShipSandboxSession({
    prefabId,
    onExit: () => {
      window.location.href = editorReturnUrl;
    },
  });
  mountBanner(prefabId, session.hint, !session.walkable && !session.exteriorEntry);
}
