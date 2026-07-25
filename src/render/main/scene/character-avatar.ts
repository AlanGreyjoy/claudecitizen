import type * as THREE from 'three';
import { createCharacterAvatarInstance } from './character_avatar_model';
import type { InventoryState } from '../../../player/inventory/types';
import type {
  CharacterRenderState,
  CharacterUpperBodyAim,
  Vec3,
} from '../../../types';
import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player_character_appearance';
import type { ActiveWeaponAttachment } from '../../characters/sidekick/equipment_attach';

interface CharacterAvatar {
  dispose: () => void;
  update: (
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
    presentation?: {
      headLook?: CharacterUpperBodyAim | null;
    },
  ) => void;
  setEquippedInventory: (
    inventory: InventoryState | null,
    activeWeaponSlotId?: string | null,
  ) => void;
  getActiveWeaponAttachment: () => ActiveWeaponAttachment | null;
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
    presentation: {
      headLook?: CharacterUpperBodyAim | null;
    } = {},
  ): void {
    if (!character || instance.hasLoadError()) {
      instance.setHeadLook?.(null);
      instance.root.visible = false;
      return;
    }
    instance.root.visible = true;
    instance.setPose(character, focusPosition, renderScale);
    // Upper before base so aim-while-moving uses the lower-body mask.
    instance.setUpperBodyAnimation?.(character.upperBodyAnimation ?? null);
    instance.setAnimation(character.animation);
    instance.setHeadLook?.(presentation.headLook ?? null);
    instance.updateMixer(nowSeconds);
  }

  function dispose(): void {
    instance.dispose();
    scene.remove(instance.root);
  }

  return {
    dispose,
    getActiveWeaponAttachment: () => instance.getActiveWeaponAttachment?.() ?? null,
    update,
    setEquippedInventory: (inventory, activeWeaponSlotId = null) => {
      instance.setEquippedInventory?.(inventory, activeWeaponSlotId);
    },
  };
}
