import { add, normalize, scale, vec3 } from '../../math/vec3';
import {
  integrateCharacterLocomotion,
  ORBIT_PITCH_LIMIT,
} from '../../player/character_controller';
import {
  animationFromState,
  resolveWalkInputIntent,
} from '../../player/character_locomotion';
import type { CharacterState, Vec3 } from '../../types';
import type { ShipSandboxSession, SandboxWalkActions } from './types';
import { PAD_RADIUS_METERS, SANDBOX_GROUND_Y_METERS, SANDBOX_GRAVITY, WORLD_UP } from './types';
import { resolveSandboxOrbit, clamp } from './camera_math';

const TURN_SPEED = 10;

function clampToSandboxPad(position: Vec3): Vec3 {
  const radial = Math.hypot(position.x, position.z);
  if (radial <= PAD_RADIUS_METERS - 1) return position;
  const pull = (PAD_RADIUS_METERS - 1) / radial;
  return { x: position.x * pull, y: position.y, z: position.z * pull };
}

export function groundCharacterAt(position: Vec3, forward: Vec3): CharacterState {
  return {
    animation: 'Idle_Loop',
    forward: normalize({ x: forward.x, y: 0, z: forward.z }),
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: { x: position.x, y: SANDBOX_GROUND_Y_METERS, z: position.z },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
}

export function updateShipSandboxGroundFallback(
  session: ShipSandboxSession,
  dt: number,
  actions: SandboxWalkActions,
): void {
  const input = session.controls.sampleCharacterInput();
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
    session.character,
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
        let position = session.character.position;
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
  let forward = session.character.forward;
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

  session.character = {
    ...session.character,
    animation: animationFromState({
      isMoving,
      isCrouching: intent.isCrouching,
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
  session.prompt = '';
}
