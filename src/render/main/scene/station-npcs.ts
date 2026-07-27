import type * as THREE from 'three';
import type { StationNpcRenderState, Vec3 } from '../../../types';
import {
  playerCharacterAppearanceKey,
  type PlayerCharacterAppearanceV1,
} from '../../../player/character_creator/player-character-appearance';
import {
  createCharacterAvatarInstance,
  type CharacterAvatarInstance,
} from './character-avatar-model';

const NPC_RENDER_DISTANCE_METERS = 90;
const NPC_RENDER_DISTANCE_SQUARED = NPC_RENDER_DISTANCE_METERS * NPC_RENDER_DISTANCE_METERS;

interface StationNpcObject {
  avatar: CharacterAvatarInstance;
  /** Identity-compared first; see `ensure`. */
  appearance: PlayerCharacterAppearanceV1;
  appearanceKey: string;
  /** Authored character GLB, or null for the modular Sidekick avatar. */
  modelUrl: string | null;
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
  modelUrl: string | null,
  renderScale: number,
): StationNpcObject {
  const avatar = createCharacterAvatarInstance(renderScale, appearance, modelUrl);
  avatar.root.visible = false;
  return {
    avatar,
    appearance,
    appearanceKey: playerCharacterAppearanceKey(appearance),
    modelUrl,
  };
}

export function createStationNpcRenderer(
  scene: THREE.Scene,
  renderScale: number,
): StationNpcRenderer {
  const objects = new Map<string, StationNpcObject>();
  const present = new Set<string>();

  function remove(id: string, object: StationNpcObject): void {
    scene.remove(object.avatar.root);
    object.avatar.dispose();
    objects.delete(id);
  }

  /**
   * NPC appearances are immutable once spawned and only swap when the
   * population resets, so the identity check carries the steady path. Rebuilding
   * the key string for every visible NPC every frame was pure allocation.
   */
  function ensure(npc: StationNpcRenderState): StationNpcObject {
    const modelUrl = npc.modelUrl ?? null;
    const existing = objects.get(npc.id);
    if (existing) {
      const sameModel = existing.modelUrl === modelUrl;
      // An authored model ignores appearance entirely, so nothing but the url
      // can invalidate it.
      if (sameModel && (modelUrl !== null || existing.appearance === npc.appearance)) {
        return existing;
      }
      const appearanceKey = playerCharacterAppearanceKey(npc.appearance);
      if (sameModel && existing.appearanceKey === appearanceKey) {
        existing.appearance = npc.appearance;
        return existing;
      }
      remove(npc.id, existing);
    }
    const created = createNpcObject(npc.appearance, modelUrl, renderScale);
    objects.set(npc.id, created);
    scene.add(created.avatar.root);
    return created;
  }

  return {
    update(npcs, focusPosition, nowSeconds) {
      present.clear();
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
        avatar.setHeadLook?.(npc.headLook ?? null);
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
