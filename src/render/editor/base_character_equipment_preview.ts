import * as THREE from "three";
import type {
  BaseCharacterEquipmentV1,
  BaseCharacterType,
} from "../../player/equipment/base_character_equipment";
import type { PrefabDocument, PrefabEntity, PrefabTransform } from "../../world/prefabs/schema";
import type { SidekickAvatarInstance } from "../characters/sidekick/assemble_avatar";
import { createPropInstanceGroup } from "../prefabs/prefab_renderer";
import {
  collectEquipmentSockets,
  identityDrawnGripTransform,
  validateBackpackPrefab,
} from "../../world/prefabs/item_runtime";
import type { MountEditMode } from "./base_character_equipment_transform";

export interface EquipmentPreviewContext {
  documentState: BaseCharacterEquipmentV1;
  selectedType: BaseCharacterType;
  avatar: SidekickAvatarInstance;
  previewRoot: THREE.Group;
  assignments: Map<string, { itemType: string; prefabId?: string | null; name: string }>;
  playTestActive: boolean;
  playTestWeaponSlotId: string | null;
  simulateDrawnSlotId: string | null;
  mountEditMode: MountEditMode;
  loadBackpackPrefabDraft: (prefabId: string) => Promise<PrefabDocument | null>;
  loadWeaponPrefabDraft: (prefabId: string) => Promise<PrefabDocument | null>;
  ensureDrawnGripEntity: (doc: PrefabDocument) => PrefabEntity;
  applyTransform: (object: THREE.Object3D, transform: PrefabTransform) => void;
  setStageStatus: (message: string, isWarning?: boolean) => void;
  findEntityObject: (root: THREE.Object3D, entityId: string) => THREE.Object3D | null;
  findPrefabEntity: (root: PrefabEntity, entityId: string) => PrefabEntity | null;
  placeholder: (color: number) => THREE.Group;
}

export interface EquipmentPreviewState {
  mountPivots: Map<string, THREE.Group>;
  drawnPivots: Map<string, THREE.Group>;
  weaponPreviewRoots: Map<string, THREE.Group>;
  weaponGripEntities: Map<string, PrefabEntity>;
  activeBackpackPrefabId: string | null;
  backpackSocketObjects: Map<string, THREE.Object3D>;
  backpackSocketEntities: Map<string, PrefabEntity>;
}

export function createEquipmentPreviewState(): EquipmentPreviewState {
  return {
    mountPivots: new Map(),
    drawnPivots: new Map(),
    weaponPreviewRoots: new Map(),
    weaponGripEntities: new Map(),
    activeBackpackPrefabId: null,
    backpackSocketObjects: new Map(),
    backpackSocketEntities: new Map(),
  };
}

export function setupEquipmentMountPivots(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
): void {
  const variant = ctx.documentState.variants[String(ctx.selectedType) as "1" | "2"];
  for (const slot of ctx.documentState.slots) {
    const mount = variant.mounts[slot.id];
    const bone = ctx.avatar.root.getObjectByName(mount.bone);
    const pivot = new THREE.Group();
    pivot.name = `equipment-mount:${slot.id}`;
    ctx.applyTransform(pivot, mount);
    (bone ?? ctx.previewRoot).add(pivot);
    state.mountPivots.set(slot.id, pivot);
    if (!bone) {
      ctx.setStageStatus(`Missing character bone "${mount.bone}" for ${slot.label}.`, true);
    }
  }
}

export function setupEquipmentDrawnPivots(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
): void {
  const variant = ctx.documentState.variants[String(ctx.selectedType) as "1" | "2"];
  for (const [slotId, mount] of Object.entries(variant.drawnMounts ?? {})) {
    const bone = ctx.avatar.root.getObjectByName(mount.bone);
    const pivot = new THREE.Group();
    pivot.name = `equipment-drawn:${slotId}`;
    ctx.applyTransform(pivot, mount);
    (bone ?? ctx.previewRoot).add(pivot);
    state.drawnPivots.set(slotId, pivot);
    if (!bone) {
      ctx.setStageStatus(`Missing drawn-mount bone "${mount.bone}" for ${slotId}.`, true);
    }
  }
}

async function loadBackpackPrefabPreview(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
  backpackAssignment: { itemType: string; prefabId?: string | null; name: string },
): Promise<{ backpackRoot: THREE.Group | null; backpackSockets: Map<string, THREE.Object3D> }> {
  const backpackSockets = new Map<string, THREE.Object3D>();
  const prefab = backpackAssignment.prefabId
    ? await ctx.loadBackpackPrefabDraft(backpackAssignment.prefabId)
    : null;
  const errors = prefab ? validateBackpackPrefab(prefab) : ["Backpack prefab is missing."];
  if (!prefab || errors.length > 0) {
    state.mountPivots.get("backpack")?.add(ctx.placeholder(0xffa832));
    ctx.assignments.delete("rifle-secondary");
    ctx.setStageStatus(`Backpack warning: ${errors.join(" ")}`, true);
    return { backpackRoot: null, backpackSockets };
  }
  state.activeBackpackPrefabId = prefab.id;
  const backpackRoot = createPropInstanceGroup(prefab);
  state.mountPivots.get("backpack")?.add(backpackRoot);
  for (const socket of collectEquipmentSockets(prefab)) {
    const object = ctx.findEntityObject(backpackRoot, socket.entityId);
    const entity = ctx.findPrefabEntity(prefab.root, socket.entityId);
    if (object) {
      backpackSockets.set(socket.id, object);
      state.backpackSocketObjects.set(socket.id, object);
    }
    if (entity) state.backpackSocketEntities.set(socket.id, entity);
  }
  ctx.setStageStatus("Backpack sockets valid. Both rifle slots are available.");
  return { backpackRoot, backpackSockets };
}

export async function loadBackpackEquipmentPreview(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
  generation: number,
  previewGeneration: number,
): Promise<{ backpackRoot: THREE.Group | null; backpackSockets: Map<string, THREE.Object3D> }> {
  const backpackAssignment = ctx.assignments.get("backpack");
  if (backpackAssignment?.itemType !== "backpack") {
    ctx.assignments.delete("rifle-secondary");
    ctx.setStageStatus("No backpack equipped. One rifle uses the character backAttach fallback.");
    return { backpackRoot: null, backpackSockets: new Map() };
  }
  const result = await loadBackpackPrefabPreview(ctx, state, backpackAssignment);
  if (generation !== previewGeneration) {
    return { backpackRoot: null, backpackSockets: new Map() };
  }
  return result;
}

async function attachWeaponPreviewForSlot(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
  slot: EquipmentPreviewContext["documentState"]["slots"][number],
  backpackRoot: THREE.Group | null,
  backpackSockets: Map<string, THREE.Object3D>,
): Promise<void> {
  const definition = ctx.assignments.get(slot.id);
  if (!definition || definition.itemType !== "weapon") return;
  if (slot.requiresSlotId && !ctx.assignments.has(slot.requiresSlotId)) return;
  if (!definition.prefabId) return;
  const draft = await ctx.loadWeaponPrefabDraft(definition.prefabId);
  if (!draft) return;
  const gripEntity = ctx.ensureDrawnGripEntity(draft);
  const item = createPropInstanceGroup(draft);
  state.weaponPreviewRoots.set(slot.id, item);
  state.weaponGripEntities.set(slot.id, gripEntity);
  const drawnSlotId = ctx.playTestActive ? ctx.playTestWeaponSlotId : ctx.simulateDrawnSlotId;
  const drawnParent = drawnSlotId === slot.id ? state.drawnPivots.get(slot.id) ?? null : null;
  if (drawnParent) {
    ctx.applyTransform(item, gripEntity.transform);
    drawnParent.add(item);
    return;
  }
  ctx.applyTransform(item, identityDrawnGripTransform());
  const socket = slot.providerSocket
    ? backpackSockets.get(slot.providerSocket.socketId)
    : null;
  if (socket && backpackRoot) socket.add(item);
  else if (!slot.requiresSlotId) state.mountPivots.get(slot.id)?.add(item);
}

export async function attachWeaponEquipmentPreviews(
  ctx: EquipmentPreviewContext,
  state: EquipmentPreviewState,
  backpackRoot: THREE.Group | null,
  backpackSockets: Map<string, THREE.Object3D>,
  generation: number,
  previewGeneration: number,
): Promise<boolean> {
  let stale = false;
  for (const slot of ctx.documentState.slots) {
    if (slot.kind !== "weapon") continue;
    await attachWeaponPreviewForSlot(ctx, state, slot, backpackRoot, backpackSockets);
    if (generation !== previewGeneration) {
      stale = true;
      break;
    }
  }
  return stale;
}

export function reportDrawnAuthoringStatus(ctx: EquipmentPreviewContext): void {
  if (
    ctx.playTestActive
    || !ctx.simulateDrawnSlotId
    || (ctx.mountEditMode !== "drawn" && ctx.mountEditMode !== "weapon-grip")
  ) {
    return;
  }
  ctx.setStageStatus(
    ctx.mountEditMode === "weapon-grip"
      ? "Editing this weapon’s drawn-grip. Save writes the weapon prefab."
      : "Editing character hand bone. Switch to Weapon grip for per-gun rotation.",
  );
}
