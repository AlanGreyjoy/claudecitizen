import type * as THREE from 'three';
import { createCharacterAvatarInstance } from './character_avatar_model';
import type { InventoryState } from '../../../player/inventory/types';
import type { CharacterRenderState, Vec3 } from '../../../types';
import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player_character_appearance';

interface CharacterAvatar {
  dispose: () => void;
  update: (
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
  ) => void;
  setEquippedInventory: (inventory: InventoryState | null) => void;
}

export function createCharacterAvatar(
  scene: THREE.Scene,
  renderScale: number,
  appearance: PlayerCharacterAppearanceV1 | null = null,
): CharacterAvatar {
  const instance = createCharacterAvatarInstance(renderScale, appearance);
  instance.root.visible = false;
  scene.add(instance.root);

  function update(
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
  ): void {
    if (!character || instance.hasLoadError()) {
      instance.root.visible = false;
      return;
    }
    instance.root.visible = true;
    instance.setPose(character, focusPosition, renderScale);
    instance.setAnimation(character.animation);
    instance.updateMixer(nowSeconds);
  }

  function dispose(): void {
    instance.dispose();
    scene.remove(instance.root);
  }

  return {
    dispose,
    update,
    setEquippedInventory: (inventory) => {
      instance.setEquippedInventory?.(inventory);
    },
  };
}
