import * as THREE from 'three';
import { CHARACTER_GROUND_OFFSET_METERS } from '../../../player/character_controller';
import {
  buildPlayerSidekickDefinition,
  type PlayerCharacterAppearanceV1,
} from '../../../player/character_creator/player_character_appearance';
import { loadSidekickCatalog } from '../../../player/character_creator/sidekick_catalog';
import type { CharacterRenderState, Vec3 } from '../../../types';
import type { CharacterAvatarInstance } from '../../main/scene/character_avatar_model';
import { assembleSidekickCharacter } from './assemble_avatar';
import {
  createSidekickAnimationRuntime,
  type SidekickAnimationRuntime,
} from './animation_runtime';

const GAMEPLAY_ANIMATION_TIME_SCALE = 1.35;

function geometryBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds.isEmpty() ? new THREE.Box3().setFromObject(root) : bounds;
}

export function createSidekickGameplayAvatar(
  renderScale: number,
  appearance: PlayerCharacterAppearanceV1,
  createFallback: () => CharacterAvatarInstance,
): CharacterAvatarInstance {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.add(modelOffset);
  root.frustumCulled = false;

  let avatar: Awaited<ReturnType<typeof assembleSidekickCharacter>> | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let fallback: CharacterAvatarInstance | null = null;
  let ready = false;
  let disposed = false;
  let desiredAnimation = 'Idle_Loop';
  let lastNowSeconds: number | null = null;
  let headBone: THREE.Object3D | null = null;
  const modelOffsetPosition = new THREE.Vector3();

  void (async () => {
    try {
      const catalog = await loadSidekickCatalog();
      if (disposed) return;
      const definition = buildPlayerSidekickDefinition(catalog, appearance);
      avatar = await assembleSidekickCharacter(catalog, definition);
      if (disposed) {
        avatar.dispose();
        avatar = null;
        return;
      }
      // Retarget while the skeleton is still at its native scale. Skeleton.pose()
      // restores bind-world transforms while clips are baked; running it below a
      // render-scaled parent makes the root bone compensate with 1 / renderScale
      // (500x in the planet renderer), which cancels the avatar's render scale.
      animation = await createSidekickAnimationRuntime(avatar.root);
      if (disposed) {
        animation.dispose();
        animation = null;
        avatar.dispose();
        avatar = null;
        return;
      }
      avatar.root.scale.setScalar(renderScale);
      // Measure before parenting beneath the gameplay root. That root may already
      // be rotated into a planet/station frame while assets load; world-aligned
      // bounds from that frame cannot be reused as this model's local offset.
      const bounds = geometryBounds(avatar.root);
      const center = bounds.getCenter(new THREE.Vector3());
      modelOffsetPosition.set(
        -center.x,
        -bounds.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale,
        -center.z,
      );
      modelOffset.add(avatar.root);
      headBone = avatar.root.getObjectByName('Head') ?? avatar.root.getObjectByName('head') ?? null;
      animation.setAnimation(desiredAnimation, 0);
      ready = true;
    } catch (error) {
      console.warn('ClaudeCitizen Sidekick avatar failed; using fallback avatar.', error);
      avatar?.dispose();
      avatar = null;
      animation?.dispose();
      animation = null;
      modelOffset.clear();
      if (disposed) return;
      fallback = createFallback();
      fallback.root.visible = true;
      root.add(fallback.root);
      fallback.setAnimation(desiredAnimation);
      ready = true;
    }
  })();

  return {
    root,
    dispose: () => {
      disposed = true;
      animation?.dispose();
      avatar?.dispose();
      fallback?.dispose();
      root.clear();
    },
    getHeadBone: () => fallback?.getHeadBone() ?? headBone,
    hasLoadError: () => fallback?.hasLoadError() ?? false,
    isReady: () => fallback?.isReady() ?? ready,
    setAnimation: (name) => {
      desiredAnimation = name;
      animation?.setAnimation(name);
      fallback?.setAnimation(name);
    },
    setPose: (character: CharacterRenderState, focusPosition: Vec3, scale: number) => {
      if (fallback) {
        fallback.setPose(character, focusPosition, scale);
        return;
      }
      root.position.set(
        (character.position.x - focusPosition.x) * scale,
        (character.position.y - focusPosition.y) * scale,
        (character.position.z - focusPosition.z) * scale,
      );
      root.up.set(character.up.x, character.up.y, character.up.z);
      root.lookAt(
        root.position.x + character.forward.x * 8 * scale,
        root.position.y + character.forward.y * 8 * scale,
        root.position.z + character.forward.z * 8 * scale,
      );
      modelOffset.position.copy(modelOffsetPosition);
    },
    updateMixer: (nowSeconds, timeScale = GAMEPLAY_ANIMATION_TIME_SCALE) => {
      if (fallback) {
        fallback.updateMixer(nowSeconds, timeScale);
        return;
      }
      const delta = lastNowSeconds === null ? 0 : nowSeconds - lastNowSeconds;
      animation?.update(delta * timeScale);
      lastNowSeconds = nowSeconds;
    },
  };
}
