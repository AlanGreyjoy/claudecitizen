import type * as THREE from 'three';
import type { StationNpcRenderState, Vec3 } from '../../../types';
import {
  playerCharacterAppearanceKey,
  type PlayerCharacterAppearanceV1,
} from '../../../player/character_creator/player_character_appearance';
import {
  createCharacterAvatarInstance,
  type CharacterAvatarInstance,
} from './character_avatar_model';

const NPC_RENDER_DISTANCE_METERS = 90;
const NPC_RENDER_DISTANCE_SQUARED = NPC_RENDER_DISTANCE_METERS * NPC_RENDER_DISTANCE_METERS;

interface StationNpcObject {
  avatar: CharacterAvatarInstance;
  appearanceKey: string;
}

export interface StationNpcRenderer {
  update(
    npcs: readonly StationNpcRenderState[],
    focusPosition: Vec3,
    nowSeconds: number,
  ): void;
  dispose(): void;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

function createNpcObject(
  appearance: PlayerCharacterAppearanceV1,
  renderScale: number,
): StationNpcObject {
  const avatar = createCharacterAvatarInstance(renderScale, appearance);
  avatar.root.visible = false;
  return {
    avatar,
    appearanceKey: playerCharacterAppearanceKey(appearance),
  };
}

export function createStationNpcRenderer(
  scene: THREE.Scene,
  renderScale: number,
): StationNpcRenderer {
  const objects = new Map<string, StationNpcObject>();

  function remove(id: string, object: StationNpcObject): void {
    scene.remove(object.avatar.root);
    object.avatar.dispose();
    objects.delete(id);
  }

  function ensure(npc: StationNpcRenderState): StationNpcObject {
    const appearanceKey = playerCharacterAppearanceKey(npc.appearance);
    const existing = objects.get(npc.id);
    if (existing?.appearanceKey === appearanceKey) return existing;
    if (existing) remove(npc.id, existing);
    const created = createNpcObject(npc.appearance, renderScale);
    objects.set(npc.id, created);
    scene.add(created.avatar.root);
    return created;
  }

  return {
    update(npcs, focusPosition, nowSeconds) {
      const present = new Set<string>();
      for (const npc of npcs) {
        present.add(npc.id);
        if (distanceSquared(npc.position, focusPosition) > NPC_RENDER_DISTANCE_SQUARED) {
          const pooled = objects.get(npc.id);
          if (pooled) pooled.avatar.root.visible = false;
          continue;
        }
        const object = ensure(npc);
        const { avatar } = object;
        if (avatar.hasLoadError()) {
          avatar.root.visible = false;
          continue;
        }
        avatar.root.visible = true;
        avatar.setPose(npc, focusPosition, renderScale);
        avatar.setAnimation(npc.animation);
        avatar.updateMixer(nowSeconds);
      }

      for (const [id, object] of objects) {
        if (!present.has(id)) remove(id, object);
      }
    },
    dispose() {
      for (const [id, object] of [...objects]) remove(id, object);
    },
  };
}
