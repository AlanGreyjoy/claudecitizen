/**
 * Runtime backpack / weapon attachment on the Sidekick gameplay avatar.
 * Holster: backpack sockets / character mounts.
 * Drawn: character drawnMount bone + per-weapon prefab drawn-grip local TRS.
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
import {
  collectBarrelEnd,
  collectDrawnGrip,
  collectEquipmentSockets,
  collectMuzzleFlash,
  collectWeaponCombat,
  identityDrawnGripTransform,
  type WeaponCombatLayout,
  validateBackpackPrefab,
} from '../../../world/prefabs/item_runtime';
import { loadPrefabDocument } from '../../../world/prefabs/loader';
import type { PrefabTransform } from '../../../world/prefabs/schema';
import { createPropInstanceGroup } from '../../prefabs/prefab_renderer';

const BUNDLED_EQUIPMENT_DOC = parseBaseCharacterEquipment(baseCharactersJson);
const IDENTITY_GRIP = identityDrawnGripTransform();

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

function applyTransform(object: THREE.Object3D, transform: PrefabTransform | CharacterBoneMountV1): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.quaternion
    .set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w)
    .normalize();
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
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

async function collectWeaponGrips(
  inventory: InventoryState,
): Promise<Map<string, PrefabTransform>> {
  const grips = new Map<string, PrefabTransform>();
  for (const slot of PLAY_LOADOUT_SLOTS) {
    if (slot.kind !== 'weapon') continue;
    const itemId = inventory.loadout[slot.id];
    if (!itemId) continue;
    const definition = findItemDefinition(inventory.catalog, itemId);
    if (!definition?.prefabId) continue;
    const prefab = await loadPrefabDocument(definition.prefabId);
    if (!prefab) continue;
    const grip = collectDrawnGrip(prefab);
    grips.set(slot.id, grip ? structuredClone(grip.transform) : identityDrawnGripTransform());
  }
  return grips;
}

function attachmentFingerprint(
  doc: BaseCharacterEquipmentV1,
  characterType: BaseCharacterType,
  grips: Map<string, PrefabTransform>,
): string {
  const variant = doc.variants[String(characterType) as '1' | '2'];
  const gripPayload: Record<string, PrefabTransform> = {};
  for (const [slotId, transform] of grips) gripPayload[slotId] = transform;
  return JSON.stringify({
    mounts: variant.mounts,
    drawnMounts: variant.drawnMounts ?? {},
    weaponGrips: gripPayload,
  });
}

export interface EquipmentAttachmentController {
  /** Rebuild attachments when avatar root / loadout / catalog / drawn slot / mounts change. */
  sync: (
    avatarRoot: THREE.Object3D | null,
    characterType: BaseCharacterType,
    inventory: InventoryState | null,
    activeWeaponSlotId?: string | null,
  ) => void;
  getActiveWeaponAttachment: () => ActiveWeaponAttachment | null;
  dispose: () => void;
}

export interface ActiveWeaponAttachment {
  barrelEnd: THREE.Object3D | null;
  combat: WeaponCombatLayout | null;
  muzzleFlash: THREE.Object3D | null;
}

export function createEquipmentAttachmentController(): EquipmentAttachmentController {
  let generation = 0;
  let lastLoadoutKey = '';
  let lastMountFingerprint = '';
  let pendingDrawnSlotId: string | null = null;
  let appliedDrawnSlotId: string | null = null;
  let syncEpoch = 0;
  const mountPivots = new Map<string, THREE.Group>();
  const drawnPivots = new Map<string, THREE.Group>();
  const weaponRoots = new Map<string, THREE.Object3D>();
  const barrelEnds = new Map<string, THREE.Object3D>();
  const muzzleFlashes = new Map<string, THREE.Object3D>();
  const weaponCombat = new Map<string, WeaponCombatLayout>();
  const holsterParents = new Map<string, THREE.Object3D>();
  const weaponGrips = new Map<string, PrefabTransform>();
  const missingDrawnBoneWarned = new Set<string>();

  function clearMounts(): void {
    for (const pivot of mountPivots.values()) {
      disposeObject3D(pivot);
      pivot.removeFromParent();
    }
    for (const pivot of drawnPivots.values()) {
      disposeObject3D(pivot);
      pivot.removeFromParent();
    }
    mountPivots.clear();
    drawnPivots.clear();
    weaponRoots.clear();
    barrelEnds.clear();
    muzzleFlashes.clear();
    weaponCombat.clear();
    holsterParents.clear();
    weaponGrips.clear();
  }

  function createPivot(
    avatarRoot: THREE.Object3D,
    name: string,
    mount: CharacterBoneMountV1,
  ): THREE.Group | null {
    const bone = avatarRoot.getObjectByName(mount.bone);
    if (!bone) return null;
    const pivot = new THREE.Group();
    pivot.name = name;
    applyTransform(pivot, mount);
    bone.add(pivot);
    return pivot;
  }

  function applyWeaponLocalTransform(slotId: string, drawn: boolean): void {
    const weapon = weaponRoots.get(slotId);
    if (!weapon) return;
    if (drawn) {
      applyTransform(weapon, weaponGrips.get(slotId) ?? IDENTITY_GRIP);
    } else {
      applyTransform(weapon, IDENTITY_GRIP);
    }
  }

  function applyDrawnParents(): void {
    const activeWeaponSlotId = pendingDrawnSlotId;
    for (const [slotId, weapon] of weaponRoots) {
      const holster = holsterParents.get(slotId);
      if (!holster) continue;
      const drawnPivot = drawnPivots.get(slotId);
      const useDrawn = Boolean(activeWeaponSlotId && slotId === activeWeaponSlotId && drawnPivot);
      const parent = useDrawn && drawnPivot ? drawnPivot : holster;
      if (weapon.parent !== parent) parent.add(weapon);
      applyWeaponLocalTransform(slotId, useDrawn);
    }
    appliedDrawnSlotId = activeWeaponSlotId;
  }

  async function rebuild(
    avatarRoot: THREE.Object3D,
    characterType: BaseCharacterType,
    inventory: InventoryState,
    loadoutKeyValue: string,
    mountFingerprint: string,
    equipmentDoc: BaseCharacterEquipmentV1,
    grips: Map<string, PrefabTransform>,
  ): Promise<void> {
    const gen = ++generation;
    if (
      gen !== generation
      || loadoutKeyValue !== lastLoadoutKey
      || mountFingerprint !== lastMountFingerprint
    ) {
      return;
    }
    clearMounts();
    for (const [slotId, transform] of grips) {
      weaponGrips.set(slotId, structuredClone(transform));
    }

    const variant = equipmentDoc.variants[String(characterType) as '1' | '2'];
    for (const slot of PLAY_LOADOUT_SLOTS) {
      const mount = variant.mounts[slot.id];
      if (!mount) continue;
      const pivot = createPivot(avatarRoot, `equipment-mount:${slot.id}`, mount);
      if (pivot) mountPivots.set(slot.id, pivot);
      else if (import.meta.env.DEV) {
        console.warn(`Missing character bone "${mount.bone}" for equipment slot "${slot.id}".`);
      }
    }

    for (const [slotId, mount] of Object.entries(variant.drawnMounts ?? {})) {
      const pivot = createPivot(avatarRoot, `equipment-drawn:${slotId}`, mount);
      if (pivot) {
        drawnPivots.set(slotId, pivot);
      } else if (import.meta.env.DEV && !missingDrawnBoneWarned.has(`${characterType}:${slotId}:${mount.bone}`)) {
        missingDrawnBoneWarned.add(`${characterType}:${slotId}:${mount.bone}`);
        console.warn(
          `Missing drawn-mount bone "${mount.bone}" for slot "${slotId}"; weapon stays holstered when drawn.`,
        );
      }
    }

    const loadout = inventory.loadout;
    let backpackSockets = new Map<string, THREE.Object3D>();
    const backpackId = loadout.backpack;
    if (backpackId) {
      const backpackDef = findItemDefinition(inventory.catalog, backpackId);
      if (backpackDef?.prefabId) {
        const prefab = await loadPrefabDocument(backpackDef.prefabId);
        if (
          gen !== generation
          || loadoutKeyValue !== lastLoadoutKey
          || mountFingerprint !== lastMountFingerprint
        ) {
          return;
        }
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
      if (
        gen !== generation
        || loadoutKeyValue !== lastLoadoutKey
        || mountFingerprint !== lastMountFingerprint
      ) {
        return;
      }
      if (!prefab) continue;
      const item = createPropInstanceGroup(prefab);
      const socket = slot.providerSocket
        ? backpackSockets.get(slot.providerSocket.socketId)
        : null;
      const holster = socket ?? (!slot.requiresSlotId ? mountPivots.get(slot.id) ?? null : null);
      if (!holster) continue;
      holsterParents.set(slot.id, holster);
      weaponRoots.set(slot.id, item);
      const barrelEnd = collectBarrelEnd(prefab);
      const muzzleFlash = collectMuzzleFlash(prefab);
      const combat = collectWeaponCombat(prefab);
      if (barrelEnd) {
        const object = findEntityObject(item, barrelEnd.entityId);
        if (object) barrelEnds.set(slot.id, object);
      }
      if (muzzleFlash) {
        const object = findEntityObject(item, muzzleFlash.entityId);
        if (object) muzzleFlashes.set(slot.id, object);
      }
      if (combat) weaponCombat.set(slot.id, structuredClone(combat));
      applyTransform(item, IDENTITY_GRIP);
      holster.add(item);
    }

    applyDrawnParents();
  }

  async function reconcile(
    avatarRoot: THREE.Object3D,
    characterType: BaseCharacterType,
    inventory: InventoryState,
    epoch: number,
  ): Promise<void> {
    const nextLoadoutKey = `${characterType}|${loadoutKey(inventory.loadout)}`;
    const equipmentDoc = await loadEquipmentDocument();
    if (epoch !== syncEpoch) return;
    const grips = await collectWeaponGrips(inventory);
    if (epoch !== syncEpoch) return;
    const mountFingerprint = attachmentFingerprint(equipmentDoc, characterType, grips);
    const needsRebuild =
      nextLoadoutKey !== lastLoadoutKey || mountFingerprint !== lastMountFingerprint;
    if (needsRebuild) {
      lastLoadoutKey = nextLoadoutKey;
      lastMountFingerprint = mountFingerprint;
      await rebuild(
        avatarRoot,
        characterType,
        inventory,
        nextLoadoutKey,
        mountFingerprint,
        equipmentDoc,
        grips,
      );
      return;
    }
    if (pendingDrawnSlotId !== appliedDrawnSlotId) {
      applyDrawnParents();
    }
  }

  return {
    getActiveWeaponAttachment() {
      if (!appliedDrawnSlotId || !weaponRoots.has(appliedDrawnSlotId)) return null;
      return {
        barrelEnd: barrelEnds.get(appliedDrawnSlotId) ?? null,
        combat: weaponCombat.get(appliedDrawnSlotId) ?? null,
        muzzleFlash: muzzleFlashes.get(appliedDrawnSlotId) ?? null,
      };
    },
    sync(avatarRoot, characterType, inventory, activeWeaponSlotId = null) {
      if (!avatarRoot || !inventory) {
        lastLoadoutKey = '';
        lastMountFingerprint = '';
        pendingDrawnSlotId = null;
        appliedDrawnSlotId = null;
        clearMounts();
        generation += 1;
        syncEpoch += 1;
        return;
      }
      pendingDrawnSlotId = activeWeaponSlotId ?? null;
      const epoch = ++syncEpoch;
      if (lastLoadoutKey && lastMountFingerprint && pendingDrawnSlotId !== appliedDrawnSlotId) {
        const nextLoadoutKey = `${characterType}|${loadoutKey(inventory.loadout)}`;
        if (nextLoadoutKey === lastLoadoutKey) {
          applyDrawnParents();
        }
      }
      void reconcile(avatarRoot, characterType, inventory, epoch);
    },
    dispose() {
      generation += 1;
      syncEpoch += 1;
      lastLoadoutKey = '';
      lastMountFingerprint = '';
      pendingDrawnSlotId = null;
      appliedDrawnSlotId = null;
      clearMounts();
    },
  };
}
