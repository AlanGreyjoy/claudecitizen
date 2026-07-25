import * as THREE from 'three';
import {
  integrateCharacterLocomotion,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
} from '../../player/character-controller';
import {
  animationLayersFromState,
  resolveWalkAiming,
  resolveWalkFacing,
  resolveWalkInputIntent,
  shouldLockFacingToCamera,
  type WalkGait,
} from '../../player/character-locomotion';
import { resolveDeckCameraOrbit } from '../../flight/flight-aim';
import { add, normalize, scale, vec3 } from '../../math/vec3';
import type { JumpPhase, Vec3 } from '../../types';
import {
  stanceIdForWeaponSlot,
  WEAPON_SELECT_SLOT_IDS,
  type WeaponSelectSlotId,
} from '../../player/inventory/weapon-select';
import type { PlayTestSessionContext } from './base-character-equipment-play-session';

const PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED = 9.8;
const PLAY_TEST_STAGE_RADIUS_METERS = 9;
const PLAY_TEST_WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const PLAY_TEST_STAGE_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
const PLAY_TEST_WEAPON_AIM_ZOOM_SCALE = 0.86;
const PLAY_TEST_WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS = 0.07;
const PLAY_TEST_MAX_UPPER_BODY_AIM_YAW = THREE.MathUtils.degToRad(80);
const PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH = THREE.MathUtils.degToRad(55);

function clampPlayTestToStage(position: Vec3): Vec3 {
  const radial = Math.hypot(position.x, position.z);
  if (radial <= PLAY_TEST_STAGE_RADIUS_METERS) return position;
  const pull = PLAY_TEST_STAGE_RADIUS_METERS / radial;
  return { x: position.x * pull, y: position.y, z: position.z * pull };
}

function smoothPlayTestVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dt: number,
  halfLife: number,
): void {
  if (halfLife <= 1e-6) {
    current.copy(target);
    return;
  }
  const blend = 1 - Math.exp((-Math.LN2 * dt) / halfLife);
  current.lerp(target, blend);
}

export function resolvePlayTestUpperBodyAim(ctx: PlayTestSessionContext): {
  pitchRadians: number;
  yawRadians: number;
} | null {
  if (!ctx.getPlayTestHardAim()) return null;
  const playTestCharacter = ctx.getPlayTestCharacter();
  ctx.camera.getWorldDirection(ctx.playTestUpperAimView).normalize();
  ctx.playTestUpperAimUp
    .set(playTestCharacter.up.x, playTestCharacter.up.y, playTestCharacter.up.z)
    .normalize();
  ctx.playTestUpperAimForward
    .set(
      playTestCharacter.forward.x,
      playTestCharacter.forward.y,
      playTestCharacter.forward.z,
    )
    .addScaledVector(ctx.playTestUpperAimUp, -ctx.playTestUpperAimForward.dot(ctx.playTestUpperAimUp))
    .normalize();
  ctx.playTestUpperAimPlanarView
    .copy(ctx.playTestUpperAimView)
    .addScaledVector(ctx.playTestUpperAimUp, -ctx.playTestUpperAimView.dot(ctx.playTestUpperAimUp));

  let yawRadians = 0;
  if (
    ctx.playTestUpperAimPlanarView.lengthSq() > 1e-8
    && ctx.playTestUpperAimForward.lengthSq() > 1e-8
  ) {
    ctx.playTestUpperAimPlanarView.normalize();
    yawRadians = Math.atan2(
      ctx.playTestUpperAimUp.dot(
        ctx.playTestUpperAimCross.crossVectors(
          ctx.playTestUpperAimForward,
          ctx.playTestUpperAimPlanarView,
        ),
      ),
      THREE.MathUtils.clamp(
        ctx.playTestUpperAimForward.dot(ctx.playTestUpperAimPlanarView),
        -1,
        1,
      ),
    );
  }

  return {
    pitchRadians: THREE.MathUtils.clamp(
      Math.asin(
        THREE.MathUtils.clamp(ctx.playTestUpperAimView.dot(ctx.playTestUpperAimUp), -1, 1),
      ),
      -PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH,
      PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH,
    ),
    yawRadians: THREE.MathUtils.clamp(
      yawRadians,
      -PLAY_TEST_MAX_UPPER_BODY_AIM_YAW,
      PLAY_TEST_MAX_UPPER_BODY_AIM_YAW,
    ),
  };
}

export function updatePlayTestFrame(
  ctx: PlayTestSessionContext,
  deltaSeconds: number,
  selectPlayTestWeapon: (slotId: WeaponSelectSlotId | null, toggle?: boolean) => Promise<void>,
  syncPlayTestAnimation: (
    force?: boolean,
    locomotion?: {
      isMoving?: boolean;
      isCrouching?: boolean;
      gait?: WalkGait;
      jumpPhase?: JumpPhase;
    },
  ) => Promise<void>,
): void {
  const playTestControls = ctx.playTestControls.current;
  const controllerState = ctx.getControllerState();
  if (!playTestControls || !controllerState) return;
  playTestControls.setMode('on-foot');
  const actions = playTestControls.consumeActions();
  if (actions.weaponSlotPress) {
    const slotId = WEAPON_SELECT_SLOT_IDS[actions.weaponSlotPress - 1] ?? null;
    if (slotId) void selectPlayTestWeapon(slotId);
  }
  const cameraState = playTestControls.sampleCameraState(deltaSeconds);
  const input = playTestControls.sampleCharacterInput();
  const stanceId = stanceIdForWeaponSlot(ctx.getPlayTestWeaponSlotId());

  const intent = resolveWalkInputIntent({
    ...input,
    jumpPressed: actions.jumpPressed,
  });
  const playTestHardAim = resolveWalkAiming(
    ctx.getPlayTestWeaponSlotId() !== null && playTestControls.isSecondaryClickHeld(),
    intent,
  );
  ctx.setPlayTestHardAim(playTestHardAim);
  const poseAiming = playTestHardAim;
  const flatOrbit = resolveDeckCameraOrbit(
    PLAY_TEST_STAGE_FORWARD,
    PLAY_TEST_WORLD_UP,
    cameraState.yawRadians,
    0,
    ORBIT_PITCH_LIMIT,
  );
  const moveDir = add(
    scale(flatOrbit.right, intent.moveX),
    scale(flatOrbit.forward, intent.moveY),
  );
  const desiredDirection = intent.isMoving && Math.hypot(moveDir.x, moveDir.z) > 1e-4
    ? normalize({ x: moveDir.x, y: 0, z: moveDir.z })
    : vec3(0, 0, 0);
  const cameraForward = normalize({
    x: flatOrbit.forward.x,
    y: 0,
    z: flatOrbit.forward.z,
  });

  let playTestCharacter = ctx.getPlayTestCharacter();
  const motion = integrateCharacterLocomotion(
    playTestCharacter,
    {
      wantsJump: intent.wantsJump,
      wantsSprint: intent.isSprinting,
      isMoving: intent.isMoving,
      desiredDirection,
      moveSpeed: intent.moveSpeedMetersPerSecond,
    },
    deltaSeconds,
    PLAY_TEST_WORLD_UP,
    PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED,
    {
      onGroundedStep: () => {
        let position = playTestCharacter.position;
        if (intent.isMoving) {
          position = clampPlayTestToStage(
            add(position, scale(desiredDirection, intent.moveSpeedMetersPerSecond * deltaSeconds)),
          );
        }
        return {
          position: { x: position.x, y: 0, z: position.z },
          up: PLAY_TEST_WORLD_UP,
        };
      },
      tryLand: (candidate) => {
        if (candidate.y > 0) return null;
        const clamped = clampPlayTestToStage(candidate);
        return {
          position: { x: clamped.x, y: 0, z: clamped.z },
          up: PLAY_TEST_WORLD_UP,
        };
      },
    },
  );

  const forward = resolveWalkFacing(
    {
      currentForward: playTestCharacter.forward,
      moveDirection: desiredDirection,
      cameraForward,
      up: PLAY_TEST_WORLD_UP,
      aiming: poseAiming,
      lockFacingToCamera: shouldLockFacingToCamera(poseAiming),
    },
    deltaSeconds,
  );
  const layers = animationLayersFromState({
    stanceId,
    aiming: poseAiming,
    isMoving: intent.isMoving,
    isCrouching: intent.isCrouching,
    gait: intent.gait,
    jumpPhase: motion.jumpPhase,
  });
  playTestCharacter = {
    ...playTestCharacter,
    animation: layers.baseClip,
    upperBodyAnimation: layers.upperClip,
    forward,
    grounded: motion.grounded,
    jumpPhase: motion.jumpPhase,
    jumpPhaseTime: motion.jumpPhaseTime,
    position: motion.position,
    up: motion.up,
    velocity: motion.velocity,
  };
  ctx.setPlayTestCharacter(playTestCharacter);

  ctx.previewRoot.position.set(
    playTestCharacter.position.x,
    playTestCharacter.position.y,
    playTestCharacter.position.z,
  );
  ctx.previewRoot.rotation.y = Math.atan2(
    playTestCharacter.forward.x,
    playTestCharacter.forward.z,
  );

  let playTestAimZoom01 = ctx.getPlayTestAimZoom01();
  const aimZoomTarget = playTestHardAim ? 1 : 0;
  playTestAimZoom01 += (aimZoomTarget - playTestAimZoom01)
    * (1 - Math.exp(
      (-Math.LN2 * deltaSeconds) / PLAY_TEST_WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS,
    ));
  ctx.setPlayTestAimZoom01(playTestAimZoom01);
  const orbit = resolveDeckCameraOrbit(
    PLAY_TEST_STAGE_FORWARD,
    PLAY_TEST_WORLD_UP,
    cameraState.yawRadians,
    cameraState.pitchRadians,
    ORBIT_PITCH_LIMIT,
  );
  const zoomDistance = cameraState.zoomDistance
    * (1 - (1 - PLAY_TEST_WEAPON_AIM_ZOOM_SCALE) * playTestAimZoom01);
  const rig = resolveCharacterCameraRig(orbit, zoomDistance);
  ctx.playTestDesiredCameraPos.set(
    playTestCharacter.position.x + rig.positionOffset.x,
    playTestCharacter.position.y + rig.positionOffset.y,
    playTestCharacter.position.z + rig.positionOffset.z,
  );
  ctx.playTestDesiredCameraTarget.set(
    playTestCharacter.position.x + rig.targetOffset.x,
    playTestCharacter.position.y + rig.targetOffset.y,
    playTestCharacter.position.z + rig.targetOffset.z,
  );
  smoothPlayTestVector(ctx.playTestSmoothedCameraPos, ctx.playTestDesiredCameraPos, deltaSeconds, 0.05);
  smoothPlayTestVector(
    ctx.playTestSmoothedCameraTarget,
    ctx.playTestDesiredCameraTarget,
    deltaSeconds,
    0.04,
  );
  ctx.camera.position.copy(ctx.playTestSmoothedCameraPos);
  ctx.camera.up.set(
    PLAY_TEST_WORLD_UP.x,
    PLAY_TEST_WORLD_UP.y,
    PLAY_TEST_WORLD_UP.z,
  );
  ctx.camera.lookAt(ctx.playTestSmoothedCameraTarget);

  ctx.getControllerUpperBodyAim()?.setTarget(resolvePlayTestUpperBodyAim(ctx));
  void syncPlayTestAnimation(false, {
    isMoving: intent.isMoving,
    isCrouching: intent.isCrouching,
    gait: intent.gait,
    jumpPhase: motion.jumpPhase,
  });
}
