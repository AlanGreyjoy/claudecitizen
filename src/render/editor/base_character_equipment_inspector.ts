
import * as THREE from "three";
import {
  DEFAULT_DRAWN_WEAPON_BONE,
  identityCharacterMount,
  type BaseCharacterEquipmentV1,
  type CharacterBoneMountV1,
  type CharacterEquipmentSlotV1,
} from "../../player/equipment/base_character_equipment";
import { collectDrawnGrip } from "../../world/prefabs/item_runtime";
import type { PrefabDocument } from "../../world/prefabs/schema";
import type { WeaponSlotType } from "../../types/equipment";
import { stanceIdForWeaponSlot } from "../../player/inventory/weapon_select";
import type { AnimationLocomotionKind } from "../../player/animation/schema";
import type { SidekickAnimationRuntime } from "../characters/sidekick/animation_runtime";
import type {
  EquipmentTransformTarget,
  MountEditMode,
} from "./base_character_equipment_transform";

const ATTACHMENT_BONES = [
  "backAttach",
  "hipAttach_l",
  "hipAttach_r",
  "hipAttachFront",
  "hipAttachBack",
  "hand_l",
  "hand_r",
  "prop_l",
  "prop_r",
];

import {
  type BackpackDefinition,
  type WeaponDefinition,
} from "../../net/admin_api";

export interface EquipmentInspectorHost {
  right: HTMLElement;
  playTestActive: boolean;
  playTestWeaponSlotId: string | null;
  previewLocomotion: AnimationLocomotionKind;
  animation: SidekickAnimationRuntime | null;
  assignments: Map<string, { name: string; prefabId?: string | null }>;
  locomotionLabels: Record<AnimationLocomotionKind, string>;
  currentSlot: () => CharacterEquipmentSlotV1 | null;
  currentMount: () => CharacterBoneMountV1 | null;
  currentDrawnMount: () => CharacterBoneMountV1 | null;
  currentTransformTarget: () => EquipmentTransformTarget | null;
  documentState: BaseCharacterEquipmentV1 | null;
  markDirty: () => void;
  rebuildEquipmentPreview: () => Promise<void>;
  renderLeft: () => void;
  renderInspector: () => void;
  mountEditMode: MountEditMode;
  setMountEditMode: (mode: MountEditMode) => void;
  selectedStanceId: string;
  setSelectedStanceId: (stanceId: string) => void;
  simulateDrawnSlotId: string | null;
  setSimulateDrawnSlotId: (slotId: string | null) => void;
  selectedType: 1 | 2;
  selectedSlotId: string;
  setSelectedSlotId: (slotId: string) => void;
  assignmentsMap: EquipmentInspectorHost["assignments"];
  loadWeaponPrefabDraft: (prefabId: string) => Promise<PrefabDocument | null>;
  ensureDrawnGripEntity: (doc: PrefabDocument) => unknown;
  markWeaponPrefabDirty: (prefabId: string) => void;
  previewControllerState: () => Promise<void>;
  gizmoMode: "translate" | "rotate" | "scale";
  setGizmoMode: (mode: "translate" | "rotate" | "scale") => void;
  gizmoSpace: "local" | "world";
  setGizmoSpace: (space: "local" | "world") => void;
  gizmo: { setSpace: (space: "local" | "world") => void };
  markBackpackPrefabDirty: (prefabId: string) => void;
  catalogMessage: string;
  refreshCatalog: () => Promise<void>;
  backpacks: BackpackDefinition[];
  weapons: WeaponDefinition[];
  assignDefinition: (
    slot: CharacterEquipmentSlotV1,
    definition: WeaponDefinition | BackpackDefinition,
  ) => void;
  equipmentDndType: string;
  button: (label: string, onClick: () => void) => HTMLButtonElement;
  input: (
    value: string,
    onChange: (value: string) => void,
    type?: string,
    step?: number,
  ) => HTMLInputElement;
  field: (label: string, control: HTMLElement) => HTMLLabelElement;
  select: (
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void,
  ) => HTMLSelectElement;
  displayNumber: (value: number) => string;
  applyTransform: (
    object: THREE.Object3D,
    transform: EquipmentTransformTarget["transform"],
  ) => void;
  transformEulerDegrees: (
    transform: EquipmentTransformTarget["transform"],
  ) => { x: number; y: number; z: number };
  setTransformEulerDegrees: (
    transform: EquipmentTransformTarget["transform"],
    degrees: { x: number; y: number; z: number },
  ) => void;
}

function renderPlayTestInspector(host: EquipmentInspectorHost): void {
  const heading = document.createElement("div");
  heading.className = "ed-base-panel-title";
  heading.textContent = "Play Test";
  const section = document.createElement("section");
  section.className = "ed-base-section";
  const state = document.createElement("p");
  state.className = "ed-base-note";
  const weaponName = host.playTestWeaponSlotId
    ? host.assignments.get(host.playTestWeaponSlotId)?.name ?? host.playTestWeaponSlotId
    : "Unarmed";
  state.textContent = `${weaponName} · ${host.locomotionLabels[host.previewLocomotion]} · ${host.animation?.activeClipName || "loading"}`;
  const controlsNote = document.createElement("p");
  controlsNote.className = "ed-base-note";
  controlsNote.textContent =
    "WASD move · Shift sprint · Space jump · 1 Assault 01 · 2 Brown 50 · 3 Twin Horned Pistol";
  section.append(state, controlsNote);
  host.right.append(heading, section);
}

function renderSlotSettingsSection(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
  update: () => void,
): HTMLElement {
  const slotSection = document.createElement('section');
  slotSection.className = 'ed-base-section';
  slotSection.append(
    host.field('Slot ID', Object.assign(document.createElement('code'), { textContent: slot.id })),
    host.field('Label', host.input(slot.label, (value) => { slot.label = value || slot.id; update(); })),
    host.field(
      'Kind',
      host.select(slot.kind, [{ value: 'weapon', label: 'Weapon' }, { value: 'backpack', label: 'Backpack' }], (value) => {
        slot.kind = value === 'backpack' ? 'backpack' : 'weapon';
        if (slot.kind === 'weapon') slot.weaponSlotType ??= 'rifle';
        else delete slot.weaponSlotType;
        host.assignmentsMap.delete(slot.id);
        update();
      }),
    ),
  );
  if (slot.kind === 'weapon') {
    slotSection.append(host.field(
      'Accepts',
      host.select(slot.weaponSlotType ?? 'rifle', ['sword', 'handgun', 'rifle'].map((value) => ({ value, label: value })), (value) => {
        slot.weaponSlotType = value as WeaponSlotType;
        host.assignmentsMap.delete(slot.id);
        update();
      }),
    ));
  }
  const slotOptions = [{ value: '', label: 'Always available' }, ...host.documentState!.slots
    .filter((candidate) => candidate.id !== slot.id)
    .map((candidate) => ({ value: candidate.id, label: candidate.label }))];
  slotSection.append(
    host.field('Requires slot', host.select(slot.requiresSlotId ?? '', slotOptions, (value) => {
      slot.requiresSlotId = value || undefined;
      if (!value) host.assignmentsMap.delete(slot.id);
      update();
    })),
    host.field('Provider slot', host.select(slot.providerSocket?.slotId ?? '', [{ value: '', label: 'Character mount' }, ...slotOptions.slice(1)], (value) => {
      slot.providerSocket = value ? { slotId: value, socketId: slot.providerSocket?.socketId || slot.id } : undefined;
      update();
    })),
  );
  if (slot.providerSocket) {
    slotSection.append(host.field('Provider socket', host.input(slot.providerSocket.socketId, (value) => {
      if (slot.providerSocket) slot.providerSocket.socketId = value;
      update();
    })));
  }
  slotSection.append(host.button('Delete slot', () => {
    if (!host.documentState || host.documentState.slots.length <= 1) return;
    if (!window.confirm(`Delete slot "${slot.label}" from both character types?`)) return;
    host.documentState.slots = host.documentState.slots.filter((candidate) => candidate.id !== slot.id);
    delete host.documentState.variants['1'].mounts[slot.id];
    delete host.documentState.variants['2'].mounts[slot.id];
    delete host.documentState.variants['1'].drawnMounts?.[slot.id];
    delete host.documentState.variants['2'].drawnMounts?.[slot.id];
    for (const candidate of host.documentState.slots) {
      if (candidate.requiresSlotId === slot.id) delete candidate.requiresSlotId;
      if (candidate.providerSocket?.slotId === slot.id) delete candidate.providerSocket;
    }
    host.assignmentsMap.delete(slot.id);
    if (host.simulateDrawnSlotId === slot.id) host.setSimulateDrawnSlotId(null);
    host.setMountEditMode('holster');
    host.setSelectedSlotId(host.documentState.slots[0]?.id ?? '');
    update();
    host.renderLeft();
  }));
  return slotSection;
}

function enterDrawnAuthoring(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
  mode: 'drawn' | 'weapon-grip',
): void {
  host.setMountEditMode(mode);
  host.setSelectedStanceId(stanceIdForWeaponSlot(slot.id));
  host.setSimulateDrawnSlotId(slot.id);
  if (!host.currentDrawnMount() && host.documentState) {
    const variant = host.documentState.variants[String(host.selectedType) as '1' | '2'];
    variant.drawnMounts ??= {};
    variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
    host.markDirty();
  }
  const assignment = host.assignmentsMap.get(slot.id);
  if (mode === 'weapon-grip' && assignment?.prefabId) {
    void host.loadWeaponPrefabDraft(assignment.prefabId).then((draft) => {
      if (draft) {
        const hadGrip = Boolean(collectDrawnGrip(draft));
        host.ensureDrawnGripEntity(draft);
        if (!hadGrip) host.markWeaponPrefabDirty(draft.id);
      }
      void host.rebuildEquipmentPreview().then(() => {
        void host.previewControllerState();
      });
    });
    return;
  }
  void host.rebuildEquipmentPreview().then(() => {
    void host.previewControllerState();
  });
}

function renderWeaponMountModeSection(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
  update: () => void,
): HTMLElement {
  const mountModeSection = document.createElement('section');
  mountModeSection.className = 'ed-base-section';
  const mountModeTitle = document.createElement('h3');
  mountModeTitle.textContent = 'Mount target';
  mountModeSection.append(mountModeTitle);
  const modeRow = document.createElement('div');
  modeRow.className = 'ed-base-actions';
  for (const [label, mode] of [
    ['Holster', 'holster'],
    ['Hand bone', 'drawn'],
    ['Weapon grip', 'weapon-grip'],
  ] as const) {
    const modeButton = host.button(label, () => {
      if (mode === 'holster') {
        host.setMountEditMode('holster');
        if (host.simulateDrawnSlotId === slot.id) host.setSimulateDrawnSlotId(null);
        void host.rebuildEquipmentPreview();
        return;
      }
      enterDrawnAuthoring(host, slot, mode);
    });
    modeButton.classList.toggle('is-active', host.mountEditMode === mode);
    if (mode === 'weapon-grip' && !host.assignmentsMap.has(slot.id)) {
      modeButton.disabled = true;
      modeButton.title = 'Assign a weapon from the catalog first';
    }
    modeRow.append(modeButton);
  }
  mountModeSection.append(modeRow);
  const drawn = host.currentDrawnMount();
  if (host.mountEditMode !== 'drawn' && host.mountEditMode !== 'weapon-grip') {
    return mountModeSection;
  }
  const hint = document.createElement('p');
  hint.className = 'ed-base-note';
  hint.textContent = host.mountEditMode === 'weapon-grip'
    ? 'Per-gun rotation/offset saved on this weapon prefab’s drawn-grip marker.'
    : 'Shared hand bone for this loadout slot (usually prop_r). Prefer Weapon grip for mesh-specific aim.';
  mountModeSection.append(hint);
  const simulateLabel = document.createElement('label');
  simulateLabel.className = 'ed-base-note';
  simulateLabel.style.display = 'flex';
  simulateLabel.style.gap = '0.4rem';
  simulateLabel.style.alignItems = 'center';
  const simulate = document.createElement('input');
  simulate.type = 'checkbox';
  simulate.checked = host.simulateDrawnSlotId === slot.id;
  simulate.addEventListener('change', () => {
    host.setSimulateDrawnSlotId(simulate.checked ? slot.id : null);
    void host.rebuildEquipmentPreview();
  });
  simulateLabel.append(simulate, document.createTextNode('Simulate drawn (mesh in hand)'));
  mountModeSection.append(simulateLabel);
  if (host.mountEditMode !== 'drawn') return mountModeSection;
  if (drawn) {
    mountModeSection.append(host.button('Remove hand bone mount', () => {
      if (!host.documentState) return;
      const variant = host.documentState.variants[String(host.selectedType) as '1' | '2'];
      if (variant.drawnMounts) {
        delete variant.drawnMounts[slot.id];
        if (Object.keys(variant.drawnMounts).length === 0) delete variant.drawnMounts;
      }
      if (host.simulateDrawnSlotId === slot.id) host.setSimulateDrawnSlotId(null);
      host.setMountEditMode('holster');
      update();
    }));
  } else {
    mountModeSection.append(host.button('Add hand bone mount', () => {
      if (!host.documentState) return;
      const variant = host.documentState.variants[String(host.selectedType) as '1' | '2'];
      variant.drawnMounts ??= {};
      variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
      update();
    }));
  }
  return mountModeSection;
}

function transformUnavailableMessage(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
): string {
  if (host.mountEditMode === 'weapon-grip' && slot.kind === 'weapon') {
    return 'Assign a weapon and enable Simulate drawn to edit that gun’s grip.';
  }
  if (host.mountEditMode === 'drawn' && slot.kind === 'weapon') {
    return 'Add a hand bone mount to edit the shared character attach bone.';
  }
  if (slot.requiresSlotId) {
    return `Equip a valid ${slot.requiresSlotId} to edit this provider socket.`;
  }
  return 'The selected transform target is unavailable.';
}

function appendTransformVectorRow(
  host: EquipmentInspectorHost,
  section: HTMLElement,
  label: string,
  target: { x: number; y: number; z: number },
  step: number,
  onValue: (key: 'x' | 'y' | 'z', value: string) => void,
): void {
  const row = document.createElement('div');
  row.className = 'ed-base-vector';
  const rowLabel = document.createElement('span');
  rowLabel.textContent = label;
  row.append(rowLabel);
  for (const key of ['x', 'y', 'z'] as const) {
    const valueInput = host.input(host.displayNumber(target[key]), (value) => onValue(key, value), 'number', step);
    valueInput.title = key.toUpperCase();
    row.append(valueInput);
  }
  section.append(row);
}

function renderTransformInspectorSection(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
  mount: CharacterBoneMountV1,
  update: () => void,
): HTMLElement {
  const transformSection = document.createElement('section');
  transformSection.className = 'ed-base-section';
  const transformTitle = document.createElement('h3');
  const transformTarget = host.currentTransformTarget();
  const editingMount = host.mountEditMode === 'drawn' && slot.kind === 'weapon'
    ? host.currentDrawnMount()
    : host.mountEditMode === 'weapon-grip'
      ? null
      : mount;
  transformTitle.textContent = transformTarget?.label ?? 'Transform unavailable';
  transformSection.append(transformTitle);
  if (!transformTarget) {
    const unavailable = document.createElement('p');
    unavailable.className = 'ed-base-warning';
    unavailable.textContent = transformUnavailableMessage(host, slot);
    transformSection.append(unavailable);
  }
  const modes = document.createElement('div');
  modes.className = 'ed-base-actions';
  for (const [label, mode] of [['Move', 'translate'], ['Rotate', 'rotate'], ['Scale', 'scale']] as const) {
    const modeButton = host.button(label, () => host.setGizmoMode(mode));
    modeButton.classList.toggle('is-active', host.gizmoMode === mode);
    modes.append(modeButton);
  }
  const spaceButton = host.button(host.gizmoSpace === 'local' ? 'Local' : 'World', () => {
    const nextSpace = host.gizmoSpace === 'local' ? 'world' : 'local';
    host.setGizmoSpace(nextSpace);
    host.gizmo.setSpace(nextSpace);
    host.renderInspector();
  });
  spaceButton.title = 'Toggle local/world gizmo orientation';
  modes.append(spaceButton);
  if (transformTarget) transformSection.append(modes);
  const markTransformDirty = (): void => {
    if (transformTarget?.source === 'backpack-socket' && transformTarget.prefabId) {
      host.markBackpackPrefabDirty(transformTarget.prefabId);
    } else if (transformTarget?.source === 'weapon-grip' && transformTarget.prefabId) {
      host.markWeaponPrefabDirty(transformTarget.prefabId);
    } else {
      host.markDirty();
    }
  };
  const updateNumber = (target: { x: number; y: number; z: number }, key: 'x' | 'y' | 'z', value: string): void => {
    const number = Number(value);
    if (!Number.isFinite(number) || !transformTarget) return;
    target[key] = number;
    host.applyTransform(transformTarget.object, transformTarget.transform);
    markTransformDirty();
  };
  if (transformTarget?.source === 'character' && editingMount) {
    transformSection.append(host.field('Bone', host.select(editingMount.bone, ATTACHMENT_BONES.map((bone) => ({ value: bone, label: bone })), (value) => {
      editingMount.bone = value;
      update();
    })));
  } else if (transformTarget?.source === 'backpack-socket') {
    const note = document.createElement('p');
    note.className = 'ed-base-note';
    note.textContent = 'Editing the backpack item prefab. Saving will persist this resting weapon position for every character using this backpack.';
    transformSection.append(note);
  } else if (transformTarget?.source === 'weapon-grip') {
    const note = document.createElement('p');
    note.className = 'ed-base-note';
    note.textContent = 'Editing this weapon prefab’s drawn-grip. Each gun keeps its own rotation/offset when drawn.';
    transformSection.append(note);
  }
  if (transformTarget) {
    const transform = transformTarget.transform;
    appendTransformVectorRow(host, transformSection, 'Position', transform.position, 0.01, (key, value) =>
      updateNumber(transform.position, key, value));
    const rotationDegrees = host.transformEulerDegrees(transform);
    appendTransformVectorRow(host, transformSection, 'Rotation°', rotationDegrees, 5, (key, value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      const nextDegrees = host.transformEulerDegrees(transform);
      nextDegrees[key] = number;
      host.setTransformEulerDegrees(transform, nextDegrees);
      host.applyTransform(transformTarget.object, transform);
      markTransformDirty();
      host.renderInspector();
    });
    appendTransformVectorRow(host, transformSection, 'Scale', transform.scale, 0.05, (key, value) =>
      updateNumber(transform.scale, key, value));
  }
  return transformSection;
}

function renderEquipmentCatalogSection(
  host: EquipmentInspectorHost,
  slot: CharacterEquipmentSlotV1,
): HTMLElement {
  const catalogSection = document.createElement('section');
  catalogSection.className = 'ed-base-section ed-base-catalog';
  const catalogTitle = document.createElement('h3');
  catalogTitle.textContent = 'Synchronized catalog';
  const refresh = host.button('Refresh', () => void host.refreshCatalog());
  const adminLink = document.createElement('a');
  adminLink.className = 'ed-btn';
  adminLink.href = '/?boot=admin';
  adminLink.target = '_blank';
  adminLink.textContent = 'Open Admin';
  const message = document.createElement('p');
  message.className = 'ed-base-note';
  message.textContent = host.catalogMessage;
  catalogSection.append(catalogTitle, refresh, adminLink, message);
  const available = slot.kind === 'backpack'
    ? host.backpacks
    : host.weapons.filter((weapon) => weapon.weaponSlotType === slot.weaponSlotType);
  const slotUnavailable = Boolean(slot.requiresSlotId && !host.assignmentsMap.has(slot.requiresSlotId));
  if (slotUnavailable) {
    const warning = document.createElement('p');
    warning.className = 'ed-base-warning';
    warning.textContent = `Equip ${slot.requiresSlotId} to unlock this slot.`;
    catalogSection.append(warning);
  } else {
    for (const definition of available) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ed-base-catalog-item';
      card.draggable = true;
      card.textContent = `${definition.name} · ${definition.prefabId ?? 'missing prefab'}`;
      card.addEventListener('dragstart', (event) => event.dataTransfer?.setData(host.equipmentDndType, definition.id));
      card.addEventListener('click', () => host.assignDefinition(slot, definition));
      catalogSection.append(card);
    }
  }
  catalogSection.append(host.button('Clear preview assignment', () => {
    host.assignmentsMap.delete(slot.id);
    if (slot.id === 'backpack') host.assignmentsMap.delete('rifle-secondary');
    void host.rebuildEquipmentPreview();
  }));
  return catalogSection;
}

function renderEquipmentSlotInspector(host: EquipmentInspectorHost): void {
  host.right.replaceChildren();
  const slot = host.currentSlot();
  const mount = host.currentMount();
  const heading = document.createElement('div');
  heading.className = 'ed-base-panel-title';
  heading.textContent = slot ? slot.label : 'Equipment slot';
  host.right.append(heading);
  if (!slot || !mount || !host.documentState) return;
  const update = (): void => {
    host.markDirty();
    void host.rebuildEquipmentPreview();
  };
  const mountModeSection = slot.kind === 'weapon'
    ? renderWeaponMountModeSection(host, slot, update)
    : null;
  host.right.append(
    renderSlotSettingsSection(host, slot, update),
    ...(mountModeSection ? [mountModeSection] : []),
    renderTransformInspectorSection(host, slot, mount, update),
    renderEquipmentCatalogSection(host, slot),
  );
}


export function renderEquipmentInspector(host: EquipmentInspectorHost): void {
  host.right.replaceChildren();
  if (host.playTestActive) {
    renderPlayTestInspector(host);
    return;
  }
  renderEquipmentSlotInspector(host);
}
