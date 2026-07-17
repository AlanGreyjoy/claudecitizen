/**
 * Runtime backpack / weapon attachment on the Sidekick gameplay avatar.
 * Mirrors base_character_equipment_editor rebuildEquipmentPreview (mounts + sockets).
 */

import * as THREE from 'three';
import baseCharactersJson from '../../../player/equipment/data/base-characters.json';
import {
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
  type BaseCharacterType,
  type CharacterBoneMountV1,
} from '../../../player/equipment/base_character_equipment';
import {
  findItemDefinition,
  type InventoryState,
  type LoadoutState,
} from '../../../player/inventory/types';
import { PLAY_LOADOUT_SLOTS } from '../../../player/inventory/loadout_slots';
import { collectEquipmentSockets, validateBackpackPrefab } from '../../../world/prefabs/item_runtime';
import { loadPrefabDocument } from '../../../world/prefabs/loader';
import { createPropInstanceGroup } from '../../prefabs/prefab_renderer';

const BUNDLED_EQUIPMENT_DOC = parseBaseCharacterEquipment(baseCharactersJson);

async function loadEquipmentDocument(): Promise<BaseCharacterEquipmentV1> {
  if (!import.meta.env.DEV) return BUNDLED_EQUIPMENT_DOC;

  try {
    const response = await fetch('/__editor/base-characters', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Editor equipment request failed (${response.status}).`);
    }
    const payload = await response.json() as { document?: unknown };
    return parseBaseCharacterEquipment(payload.document);
  } catch (error) {
    console.warn('Could not load current Base Character equipment; using the bundled document.', error);
    return BUNDLED_EQUIPMENT_DOC;
  }
}

function applyMount(object: THREE.Object3D, mount: CharacterBoneMountV1): void {
  object.position.set(mount.position.x, mount.position.y, mount.position.z);
  object.quaternion
    .set(mount.rotation.x, mount.rotation.y, mount.rotation.z, mount.rotation.w)
    .normalize();
  object.scale.set(mount.scale.x, mount.scale.y, mount.scale.z);
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material?.dispose();
      }
    }
  });
  root.clear();
}

function findEntityObject(root: THREE.Object3D, entityId: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.userData.entityId === entityId) match = object;
  });
  return match;
}

function loadoutKey(loadout: LoadoutState): string {
  return PLAY_LOADOUT_SLOTS.map((slot) => `${slot.id}:${loadout[slot.id] ?? ''}`).join('|');
}

export interface EquipmentAttachmentController {
  /** Rebuild attachments when avatar root / loadout / catalog change. */
  sync: (
    avatarRoot: THREE.Object3D | null,
    characterType: BaseCharacterType,
    inventory: InventoryState | null,
  ) => void;
  dispose: () => void;
}

export function createEquipmentAttachmentController(): EquipmentAttachmentController {
  let generation = 0;
  let lastKey = '';
  const mountPivots = new Map<string, THREE.Group>();

  function clearMounts(): void {
    for (const pivot of mountPivots.values()) {
      disposeObject3D(pivot);
      pivot.removeFromParent();
    }
    mountPivots.clear();
  }

  async function rebuild(
    avatarRoot: THREE.Object3D,
    characterType: BaseCharacterType,
    inventory: InventoryState,
    key: string,
  ): Promise<void> {
    const gen = ++generation;
    const equipmentDoc = await loadEquipmentDocument();
    if (gen !== generation || key !== lastKey) return;
    clearMounts();

    const variant = equipmentDoc.variants[String(characterType) as '1' | '2'];
    for (const slot of PLAY_LOADOUT_SLOTS) {
      const mount = variant.mounts[slot.id];
      if (!mount) continue;
      const bone = avatarRoot.getObjectByName(mount.bone) ?? avatarRoot;
      const pivot = new THREE.Group();
      pivot.name = `equipment-mount:${slot.id}`;
      applyMount(pivot, mount);
      bone.add(pivot);
      mountPivots.set(slot.id, pivot);
    }

    const loadout = inventory.loadout;
    let backpackSockets = new Map<string, THREE.Object3D>();
    const backpackId = loadout.backpack;
    if (backpackId) {
      const backpackDef = findItemDefinition(inventory.catalog, backpackId);
      if (backpackDef?.prefabId) {
        const prefab = await loadPrefabDocument(backpackDef.prefabId);
        if (gen !== generation || key !== lastKey) return;
        if (prefab && validateBackpackPrefab(prefab).length === 0) {
          const backpackRoot = createPropInstanceGroup(prefab);
          mountPivots.get('backpack')?.add(backpackRoot);
          backpackSockets = new Map();
          for (const socket of collectEquipmentSockets(prefab)) {
            const object = findEntityObject(backpackRoot, socket.entityId);
            if (object) backpackSockets.set(socket.id, object);
          }
        }
      }
    }

    for (const slot of PLAY_LOADOUT_SLOTS) {
      if (slot.kind !== 'weapon') continue;
      const itemId = loadout[slot.id];
      if (!itemId) continue;
      if (slot.requiresSlotId && !loadout[slot.requiresSlotId]) continue;
      const definition = findItemDefinition(inventory.catalog, itemId);
      if (!definition?.prefabId) continue;
      const prefab = await loadPrefabDocument(definition.prefabId);
      if (gen !== generation || key !== lastKey) return;
      if (!prefab) continue;
      const item = createPropInstanceGroup(prefab);
      const socket = slot.providerSocket
        ? backpackSockets.get(slot.providerSocket.socketId)
        : null;
      if (socket) socket.add(item);
      else if (!slot.requiresSlotId) mountPivots.get(slot.id)?.add(item);
    }
  }

  return {
    sync(avatarRoot, characterType, inventory) {
      if (!avatarRoot || !inventory) {
        lastKey = '';
        clearMounts();
        generation += 1;
        return;
      }
      const key = `${characterType}|${loadoutKey(inventory.loadout)}`;
      if (key === lastKey) return;
      lastKey = key;
      void rebuild(avatarRoot, characterType, inventory, key);
    },
    dispose() {
      generation += 1;
      lastKey = '';
      clearMounts();
    },
  };
}
