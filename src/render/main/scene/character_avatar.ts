import * as THREE from 'three';
import { createCharacterAvatarInstance } from './character_avatar_model';
import type { CharacterRenderState, Vec3 } from '../../../types';

interface CharacterAvatar {
  dispose: () => void;
  update: (
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
    firstPerson?: boolean,
  ) => void;
}

export function createCharacterAvatar(scene: THREE.Scene, renderScale: number): CharacterAvatar {
  const instance = createCharacterAvatarInstance(renderScale);
  instance.root.visible = false;
  scene.add(instance.root);

  function update(
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
    firstPerson = false,
  ): void {
    if (!character || instance.hasLoadError()) {
      instance.root.visible = false;
      return;
    }
    instance.root.visible = true;
    instance.setPose(character, focusPosition, renderScale);
    instance.setAnimation(character.animation);
    instance.updateMixer(nowSeconds);
    const headBone = instance.getHeadBone();
    if (headBone) {
      headBone.scale.setScalar(firstPerson ? 0.001 : 1);
    }
  }

  function dispose(): void {
    instance.dispose();
    scene.remove(instance.root);
  }

  return {
    dispose,
    update,
  };
}
