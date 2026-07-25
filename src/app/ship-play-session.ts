import { mountPlayChrome } from './play-chrome';
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
import { loadShipSandboxPrefab } from './ship_sandbox/setup';
import { createShipSandboxScene, resizeShipSandboxScene } from './ship_sandbox/scene';
import { startShipSandboxLoop } from './ship_sandbox/frame';
import { PAD_RADIUS_METERS } from './ship_sandbox/types';
import {
  buildShipSandboxSession,
  createSandboxHudOverlays,
  createSandboxShipVisuals,
} from './ship-play-session-helpers';

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

let started = false;

export async function startShipPlaySession(prefabId: string): Promise<void> {
  if (started) return;
  started = true;

  await Promise.all([
    loadCurrentCharacterSettings(),
    loadCurrentDefaultAnimationController(),
  ]);

  const { doc, prefabApplied, walkable, hint } = await loadShipSandboxPrefab(prefabId);
  const editorReturnUrl = `/editor.html?boot=editor&prefab=${encodeURIComponent(prefabId)}`;

  document.getElementById('title-screen')?.classList.add('is-hidden');
  mountPlayChrome(document.body).classList.remove('is-hidden');
  mountBanner(prefabId, hint, !walkable);
  hideFullGameHudChrome();

  const overlays = createSandboxHudOverlays(editorReturnUrl);
  const sandboxScene = createShipSandboxScene(overlays.canvas);
  const visuals = createSandboxShipVisuals(
    sandboxScene,
    doc,
    prefabApplied,
    overlays.esScreen,
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
  window.addEventListener('pagehide', () => shipPhysics?.dispose(), { once: true });

  const session = buildShipSandboxSession({
    prefabId,
    walkable,
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
