import type { WalkGait } from '../../player/character-locomotion';
import type { JumpPhase } from '../../types';
import { setDefaultAnimationController } from '../../player/animation/default-controller';
import { createPlayerControls } from '../../input/player-controls';
import {
  WEAPON_SELECT_SLOT_IDS,
  stanceIdForWeaponSlot,
  type WeaponSelectSlotId,
} from '../../player/inventory/weapon-select';
import { applyPlayTestAnimationLayers, buildPlayTestAnimationStateKey } from './base-character-equipment-play-test';
import {
  PLAY_TEST_DEFAULT_ASSIGNMENTS,
  createPlayTestCharacterState,
  equipDefaultPlayTestLoadout,
  type PlayTestSessionContext,
} from './base-character-equipment-play-session';
import { button, restoreReferencePose } from './base-character-equipment-utils';

export function stopPlayTestControls(ctx: PlayTestSessionContext): void {
  ctx.playTestControls.current?.setCombatInputActive(false);
  ctx.playTestControls.current?.setInputSuppressed(true);
  ctx.playTestControls.current?.dispose();
  ctx.playTestControls.current = null;
  if (document.pointerLockElement === ctx.canvas) {
    document.exitPointerLock();
  }
}

export function restoreAuthoringCamera(ctx: PlayTestSessionContext): void {
  ctx.endFly();
  ctx.camera.up.set(0, 1, 0);
  ctx.camera.position.copy(ctx.playTestCameraPositionBefore);
  ctx.controls.target.copy(ctx.playTestCameraTargetBefore);
  ctx.controls.enabled = true;
  ctx.controls.update();
}

export function resetPlayTestStageTransform(ctx: PlayTestSessionContext): void {
  ctx.previewRoot.position.set(0, 0, 0);
  ctx.previewRoot.rotation.set(0, 0, 0);
  ctx.previewRoot.scale.set(1, 1, 1);
  const avatar = ctx.getAvatar();
  if (!avatar) return;
  avatar.root.position.set(0, 0, 0);
  avatar.root.rotation.set(0, 0, 0);
  avatar.root.scale.set(1, 1, 1);
}

export function renderPlayTestHud(
  ctx: PlayTestSessionContext,
  selectPlayTestWeapon: (slotId: WeaponSelectSlotId | null, toggle?: boolean) => Promise<void>,
): void {
  ctx.playTestHud.hidden = !ctx.getPlayTestActive();
  ctx.stage.classList.toggle('is-play-testing', ctx.getPlayTestActive());
  if (!ctx.getPlayTestActive()) return;
  if (ctx.playTestWeaponButtons.size === 0) {
    for (const entry of PLAY_TEST_DEFAULT_ASSIGNMENTS) {
      if (entry.slotId === 'backpack') continue;
      const slotId = entry.slotId;
      const weaponButton = button(`${WEAPON_SELECT_SLOT_IDS.indexOf(slotId) + 1} ${entry.definition.name}`, () => {
        void selectPlayTestWeapon(slotId);
      });
      weaponButton.className = 'ed-base-playtest-weapon';
      weaponButton.title = `Draw ${entry.definition.name}; press again to holster`;
      ctx.playTestWeaponButtons.set(slotId, weaponButton);
      ctx.playTestHudLoadout.append(weaponButton);
    }
  }
  const assignments = ctx.getAssignments();
  for (const [slotId, weaponButton] of ctx.playTestWeaponButtons) {
    const assignment = assignments.get(slotId);
    const digit = WEAPON_SELECT_SLOT_IDS.indexOf(slotId) + 1;
    weaponButton.textContent = `${digit} ${assignment?.name ?? slotId}`;
    weaponButton.classList.toggle('is-active', slotId === ctx.getPlayTestWeaponSlotId());
  }
  const weaponName = ctx.getPlayTestWeaponSlotId()
    ? assignments.get(ctx.getPlayTestWeaponSlotId()!)?.name ?? ctx.getPlayTestWeaponSlotId()
    : 'Unarmed';
  ctx.playTestHudState.textContent = [
    weaponName,
    stanceIdForWeaponSlot(ctx.getPlayTestWeaponSlotId()),
    ctx.getPlayTestHardAim() ? 'aiming' : null,
    ctx.getAnimation()?.activeClipName || 'loading animation',
  ].filter(Boolean).join(' · ');
}

export async function syncPlayTestAnimation(
  ctx: PlayTestSessionContext,
  renderHud: () => void,
  force = false,
  locomotion?: {
    isMoving?: boolean;
    isCrouching?: boolean;
    gait?: WalkGait;
    jumpPhase?: JumpPhase;
  },
): Promise<void> {
  const animation = ctx.getAnimation();
  const controllerState = ctx.getControllerState();
  if (!ctx.getPlayTestActive() || !animation || !controllerState) return;
  const { stanceId, stateKey, previewLocomotion: nextPreviewLocomotion } =
    buildPlayTestAnimationStateKey({
      playTestWeaponSlotId: ctx.getPlayTestWeaponSlotId(),
      playTestHardAim: ctx.getPlayTestHardAim(),
      locomotion,
    });
  if (!force && stateKey === ctx.getPlayTestAnimationKey()) return;
  ctx.setPlayTestAnimationKey(stateKey);
  ctx.setPreviewLocomotion(nextPreviewLocomotion);
  ctx.setSelectedStanceId(stanceId);
  const generation = ctx.bumpPlayTestAnimationGeneration();
  renderHud();
  try {
    const applied = await applyPlayTestAnimationLayers({
      animation,
      stanceId,
      playTestHardAim: ctx.getPlayTestHardAim(),
      locomotion,
      generation,
      playTestAnimationGeneration: ctx.getPlayTestAnimationGeneration(),
      isPlayTestActive: ctx.getPlayTestActive,
      ensureControllerClipLoaded: ctx.ensureControllerClipLoaded,
      ensureAnimatedPose: ctx.ensureAnimatedPose,
      setStageStatus: ctx.setStageStatus,
    });
    if (!applied) return;
    renderHud();
    ctx.notifyUiChange();
  } catch (error) {
    if (!ctx.getPlayTestActive() || generation !== ctx.getPlayTestAnimationGeneration()) return;
    ctx.setStageStatus(
      error instanceof Error ? error.message : 'Play-test animation failed to load.',
      true,
    );
  }
}

export async function setPlayTestActive(
  ctx: PlayTestSessionContext,
  nextActive: boolean,
  renderHud: () => void,
  syncAnimation: (force?: boolean) => Promise<void>,
): Promise<void> {
  if (nextActive === ctx.getPlayTestActive()) return;
  if (nextActive) {
    try {
      ctx.setAuthoringCameraSuspended(true);
      ctx.endFly();
      await ctx.ensureAvatar();
      const avatar = ctx.getAvatar();
      const documentState = ctx.getDocumentState();
      if (!avatar || !documentState) throw new Error('Base Character is still loading.');
      ctx.setPlayTestPoseBefore(ctx.getPreviewPose());
      ctx.setPlayTestStanceBefore(ctx.getSelectedStanceId());
      ctx.setPlayTestLocomotionBefore(ctx.getPreviewLocomotion());
      ctx.setPlayTestClipBefore(ctx.getAnimation()?.activeClipName || 'Idle_Loop');
      ctx.playTestCameraPositionBefore.copy(ctx.camera.position);
      ctx.playTestCameraTargetBefore.copy(ctx.controls.target);
      ctx.controls.saveState();
      equipDefaultPlayTestLoadout(ctx);
      const controllerState = ctx.getControllerState();
      if (controllerState?.id === 'default') {
        setDefaultAnimationController(controllerState);
      }
      ctx.setPlayTestActive(true);
      ctx.setPlayTestWeaponSlotId(null);
      ctx.setPlayTestCharacter(createPlayTestCharacterState());
      ctx.setPlayTestHardAim(false);
      ctx.setPlayTestAimZoom01(0);
      ctx.setPlayTestAnimationKey('');
      ctx.previewRoot.position.set(0, 0, 0);
      ctx.previewRoot.rotation.set(0, 0, 0);
      ctx.gizmo.detach();
      ctx.controls.enabled = false;
      stopPlayTestControls(ctx);
      ctx.playTestControls.current = createPlayerControls(ctx.canvas);
      ctx.playTestControls.current.setMode('on-foot');
      ctx.playTestControls.current.setOrbitFacing(0, -0.35);
      ctx.playTestControls.current.setCombatInputActive(false);
      ctx.playTestSmoothedCameraPos.set(0, 1.7, 4.4);
      ctx.playTestSmoothedCameraTarget.set(0, 0.95, 0);
      ctx.camera.position.copy(ctx.playTestSmoothedCameraPos);
      ctx.camera.lookAt(ctx.playTestSmoothedCameraTarget);
      renderHud();
      await ctx.setPreviewPose('animated');
      await ctx.rebuildEquipmentPreview();
      ctx.setStageStatus(
        'Play test active — same on-foot camera/controls as the game. Click the stage to look; Esc returns to authoring.',
      );
      await syncAnimation(true);
      ctx.canvas.focus();
      ctx.notifyUiChange();
      ctx.notifyUiChange();
    } catch (error) {
      stopPlayTestControls(ctx);
      ctx.setPlayTestActive(false);
      ctx.setAuthoringCameraSuspended(false);
      restoreAuthoringCamera(ctx);
      renderHud();
      ctx.setStageStatus(
        error instanceof Error ? error.message : 'Could not start Base Character play test.',
        true,
      );
    }
    return;
  }

  ctx.setAuthoringCameraSuspended(true);
  ctx.setPlayTestActive(false);
  ctx.bumpPlayTestAnimationGeneration();
  stopPlayTestControls(ctx);
  ctx.setPlayTestWeaponSlotId(null);
  ctx.setPlayTestCharacter(createPlayTestCharacterState());
  ctx.setPlayTestHardAim(false);
  ctx.setPlayTestAimZoom01(0);
  ctx.setPlayTestAnimationKey('');
  resetPlayTestStageTransform(ctx);
  ctx.getControllerUpperBodyAim()?.setTarget(null);
  ctx.getControllerUpperBodyAim()?.restore();
  const animation = ctx.getAnimation();
  animation?.setUpperBodyAnimation(null, 0);
  animation?.setPlaying(false);
  const avatar = ctx.getAvatar();
  if (avatar) restoreReferencePose(avatar.root);
  restoreAuthoringCamera(ctx);
  ctx.setSelectedStanceId(ctx.getPlayTestStanceBefore());
  ctx.setPreviewLocomotion(ctx.getPlayTestLocomotionBefore());
  renderHud();
  await ctx.rebuildEquipmentPreview();
  if (ctx.getPlayTestPoseBefore() === 'reference') {
    await ctx.setPreviewPose('reference');
  } else {
    animation?.setPlaying(true);
    animation?.setUpperBodyAnimation(null, 0);
    animation?.setAnimation(ctx.getPlayTestClipBefore(), 0.12);
  }
  resetPlayTestStageTransform(ctx);
  restoreAuthoringCamera(ctx);
  ctx.controls.saveState();
  ctx.setAuthoringCameraSuspended(false);
  ctx.setStageStatus('Play test stopped. Authoring controls restored.');
  ctx.notifyUiChange();
  ctx.notifyUiChange();
  ctx.syncGizmo();
}
