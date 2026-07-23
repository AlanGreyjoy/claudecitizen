import { dot, length, normalize, vec3 } from '../../math/vec3';
import type { SoundListenerPose } from '../../audio/sound_scene';
import { footstepGaitFromIntent } from '../../audio/footsteps';
import { getCharacterSettings } from '../../player/character_settings';
import { WALK_MOVE_THRESHOLD } from '../../player/character_locomotion';
import { doorBlends, updateShipRig } from '../../player/ship_rig';
import { getShipLayout } from '../../player/ship_layout';
import { getShipRight, worldToShipLocal } from '../../player/ship_interaction';
import { updateShipPlacement } from '../../render/main/update/sun_system';
import { MODE_IN_SHIP, MODE_ON_FOOT } from '../../player/modes';
import { updateShipSandboxWalk } from './walk';
import { updateShipSandboxPilot } from './pilot';
import { updateShipSandboxInBed } from './bed';
import { updateShipSandboxTransition } from './transition';
import { updateShipSandboxGroundFallback } from './ground';
import { updateShipSandboxCamera } from './camera';
import type { ShipSandboxSession } from './types';

function tryAutoRest(session: ShipSandboxSession): void {
  if (!session.autoRestPending) return;
  const measured = session.shipModel.measure() as {
    ship?: { min?: { up?: number } };
  } | null;
  const lowestUp = measured?.ship?.min?.up;
  if (typeof lowestUp !== 'number') return;
  session.ship.position = {
    ...session.ship.position,
    y: Math.min(30, Math.max(0.3, -lowestUp)),
  };
  session.shipPhysics?.setPadRestHeight(
    Math.max(0.3, session.ship.position.y - 0.05),
  );
  session.autoRestPending = false;
}

function updateSandboxSimulation(session: ShipSandboxSession, dt: number): void {
  const actions = session.controls.consumeActions();
  if (session.mode === 'deck' || session.mode === 'ground') {
    if (session.shipPhysics && session.walkable) {
      updateShipSandboxWalk(session, dt, actions);
    } else {
      updateShipSandboxGroundFallback(session, dt, actions);
    }
  } else if (session.mode === 'pilot') {
    updateShipSandboxPilot(session, dt, actions);
  } else if (session.mode === 'in-bed') {
    updateShipSandboxInBed(session, actions);
  } else {
    updateShipSandboxTransition(session, dt);
  }
}

function updateOffPilotHud(session: ShipSandboxSession): void {
  if (session.mode === 'pilot') return;
  session.boostSfx.stop();
  session.thrustSfx.stop();
  session.flightReticle.update({
    mode: MODE_ON_FOOT,
    flightMode: 'traverse',
    quantum: session.idleQuantum,
  });
  if (session.mode !== 'in-bed') {
    session.cockpitGazeHud.update({ visible: false });
  }
  session.cockpitSpeedHud.update({ visible: false });
}

function updateSandboxScene(session: ShipSandboxSession, dt: number, nowMs: number): void {
  updateShipRig(session.rig, dt);
  session.shipModel.setArticulation({
    gear01: session.rig.gear01,
    ramp01: session.rig.ramp01,
    doors: doorBlends(session.rig),
  });
  updateShipPlacement(session.shipModel.group, session.ship, vec3(0, 0, 0), 1);
  session.shipModel.group.userData.updateParticles?.(dt);
  session.shipModel.group.userData.updateObjectAnimations?.(dt);
  session.avatar.update(
    session.mode === 'pilot' || session.mode === 'in-bed'
      ? null
      : {
          animation: session.character.animation,
          upperBodyAnimation: session.character.upperBodyAnimation ?? null,
          forward: session.character.forward,
          position: session.character.position,
          up: session.character.up,
        },
    vec3(0, 0, 0),
    nowMs / 1000,
  );
  updateShipSandboxCamera(session, dt);
  session.camera.updateMatrixWorld();
}

function resolveFootstepAudio(
  session: ShipSandboxSession,
): { listenerPose: SoundListenerPose; footstepPosition: { x: number; y: number; z: number } } {
  const matrix = session.camera.matrixWorld.elements;
  const worldForward = { x: -matrix[8], y: -matrix[9], z: -matrix[10] };
  const worldUp = { x: matrix[4], y: matrix[5], z: matrix[6] };
  if (session.mode === 'ground') {
    return {
      listenerPose: {
        position: {
          x: session.camera.position.x,
          y: session.camera.position.y,
          z: session.camera.position.z,
        },
        forward: worldForward,
        up: worldUp,
      },
      footstepPosition: session.character.position,
    };
  }
  const local = worldToShipLocal(session.ship, {
    x: session.camera.position.x,
    y: session.camera.position.y,
    z: session.camera.position.z,
  });
  const shipRight = getShipRight(session.ship);
  const shipForward = normalize(session.ship.forward);
  const toSceneVector = (vector: { x: number; y: number; z: number }) => ({
    x: -dot(vector, shipRight),
    y: dot(vector, session.ship.up),
    z: dot(vector, shipForward),
  });
  const characterLocal = worldToShipLocal(session.ship, session.character.position);
  return {
    listenerPose: {
      position: { x: -local.right, y: local.up, z: local.forward },
      forward: toSceneVector(worldForward),
      up: toSceneVector(worldUp),
    },
    footstepPosition: {
      x: -characterLocal.right,
      y: characterLocal.up,
      z: characterLocal.forward,
    },
  };
}

function updateSandboxAudio(session: ShipSandboxSession, dt: number): void {
  const { listenerPose, footstepPosition } = resolveFootstepAudio(session);
  if (session.mode === 'ground') {
    session.soundScene.setScene(null, []);
  } else {
    session.soundScene.setScene(`ship-preview:${session.prefabId}`, getShipLayout().sounds);
    session.soundScene.update(listenerPose);
  }
  session.footsteps.update(
    dt,
    listenerPose,
    session.mode === 'deck' || session.mode === 'ground'
      ? [
          {
            id: 'ship-preview-player',
            position: footstepPosition,
            grounded: session.character.grounded,
            gait: footstepGaitFromIntent({
              isMoving: length(session.character.velocity) > WALK_MOVE_THRESHOLD,
              isSprinting:
                length(session.character.velocity)
                >= getCharacterSettings().sprintSpeedMetersPerSecond * 0.85,
            }),
            surface: 'metal',
            spatial: false,
          },
        ]
      : [],
  );
}

function updateSandboxFps(session: ShipSandboxSession, dt: number, nowMs: number): void {
  session.fpsAccum += dt;
  session.fpsFrames += 1;
  if (nowMs - session.fpsLastUpdate > 500 && session.fpsAccum > 0) {
    session.fpsEl.textContent = String(Math.round(session.fpsFrames / session.fpsAccum));
    session.fpsAccum = 0;
    session.fpsFrames = 0;
    session.fpsLastUpdate = nowMs;
  }
}

export function runShipSandboxFrame(session: ShipSandboxSession, nowMs: number): void {
  const paused = session.gameMenu.isPaused() || session.entertainmentSystem.isPaused();
  const frameDt = Math.min((nowMs - session.lastMs) / 1000, 1 / 30);
  const dt = paused ? 0 : frameDt;
  session.lastMs = nowMs;

  if (!paused) {
    tryAutoRest(session);
    session.controls.setMode(
      session.mode === 'pilot' ? MODE_IN_SHIP : session.mode === 'in-bed' ? 'in-bed' : 'on-foot',
    );
    updateSandboxSimulation(session, dt);
    updateOffPilotHud(session);
    updateSandboxScene(session, dt, nowMs);
    updateSandboxAudio(session, dt);
    updateSandboxFps(session, dt, nowMs);
  } else if (session.mode === 'in-bed' || session.entertainmentSystem.isOpen()) {
    updateShipSandboxCamera(session, frameDt);
    session.camera.updateMatrixWorld();
  }

  session.composer.render(dt);

  if (session.mode === 'in-bed' || session.entertainmentSystem.isOpen()) {
    session.esScreen.sync();
    session.esScreen.render(session.camera);
  }

  session.interactPromptEl.textContent = session.prompt;
  session.interactPromptEl.classList.toggle('is-visible', session.prompt.length > 0);
  requestAnimationFrame((nextMs) => runShipSandboxFrame(session, nextMs));
}

export function startShipSandboxLoop(session: ShipSandboxSession): void {
  requestAnimationFrame((now) => {
    session.lastMs = now;
    requestAnimationFrame((nextMs) => runShipSandboxFrame(session, nextMs));
  });
}
