import type {
  BackpackDefinition,
  WeaponDefinition,
} from '../../net/admin-api';
import type {
  AnimationControllerV1,
  AnimationLocomotionKind,
} from '../../player/animation/schema';
import type { AnimationControllerListEntry } from '../../editor/api';
import type {
  BaseCharacterEquipmentV1,
  BaseCharacterType,
  CharacterBoneMountV1,
  CharacterEquipmentSlotV1,
} from '../../player/equipment/base-character-equipment';
import type { CharacterSettingsV1 } from '../../player/character-settings';
import type { WeaponSelectSlotId } from '../../player/inventory/weapon-select';
import type { PrefabTransform } from '../../world/prefabs/schema';
import type {
  EquipmentTransformTarget,
  MountEditMode,
} from './base-character-equipment-transform';

export type BaseCharacterLeftTab = 'equipment' | 'animation' | 'controllers' | 'settings';
export type CharacterPreviewPose = 'reference' | 'animated';
export type EquipmentGizmoMode = 'translate' | 'rotate' | 'scale';

export type CatalogDefinition = WeaponDefinition | BackpackDefinition;

export interface BaseCharacterAnimationSnapshot {
  activeClipName: string;
  clipNames: string[];
  /** Loaded packs with their clip names — Controllers select groups by these. */
  clipPacks: Array<{ label: string; clipNames: string[] }>;
  playing: boolean;
  timeScale: number;
  sourceLabel: string;
  available: boolean;
}

export interface BaseCharacterUiSnapshot {
  hasUnsavedChanges: boolean;
  playTestActive: boolean;
  leftTab: BaseCharacterLeftTab;
  selectedType: BaseCharacterType;
  previewPose: CharacterPreviewPose;
  selectedStanceId: string;
  previewLocomotion: AnimationLocomotionKind;
  controllerState: AnimationControllerV1 | null;
  controllerList: AnimationControllerListEntry[];
  selectedControllerId: string;
  controllerDirty: boolean;
  animation: BaseCharacterAnimationSnapshot | null;
  documentState: BaseCharacterEquipmentV1 | null;
  settingsState: CharacterSettingsV1;
  settingsDirty: boolean;
  selectedSlotId: string;
  assignments: Map<string, CatalogDefinition>;
  mountEditMode: MountEditMode;
  simulateDrawnSlotId: string | null;
  gizmoMode: EquipmentGizmoMode;
  gizmoSpace: 'local' | 'world';
  catalogMessage: string;
  weapons: WeaponDefinition[];
  backpacks: BackpackDefinition[];
  playTestWeaponSlotId: WeaponSelectSlotId | null;
  currentSlot: CharacterEquipmentSlotV1 | null;
  currentMount: CharacterBoneMountV1 | null;
  currentDrawnMount: CharacterBoneMountV1 | null;
  currentTransformTarget: EquipmentTransformTarget | null;
  stanceIds: string[];
}

export interface BaseCharacterEditorUiApi {
  getSnapshot: () => BaseCharacterUiSnapshot;
  save: () => Promise<void>;
  reload: () => void;
  setLeftTab: (tab: BaseCharacterLeftTab) => void;
  setSelectedType: (type: BaseCharacterType) => void;
  setPreviewPose: (pose: CharacterPreviewPose) => Promise<void>;
  setSelectedStanceId: (stanceId: string) => void;
  setPreviewLocomotion: (locomotion: AnimationLocomotionKind) => void;
  previewControllerState: () => Promise<void>;
  setSelectedSlotId: (slotId: string) => void;
  setMountEditMode: (mode: MountEditMode) => void;
  setSimulateDrawnSlotId: (slotId: string | null) => void;
  setGizmoMode: (mode: EquipmentGizmoMode) => void;
  toggleGizmoSpace: () => void;
  setPlayTestActive: (active: boolean) => Promise<void>;
  equipDefaultPlayTestLoadout: (overwrite?: boolean) => boolean;
  rebuildEquipmentPreview: () => Promise<void>;
  markDirty: () => void;
  markControllerDirty: () => void;
  markSettingsDirty: () => void;
  markBackpackPrefabDirty: (prefabId: string) => void;
  markWeaponPrefabDirty: (prefabId: string) => void;
  refreshCatalog: () => Promise<void>;
  assignDefinition: (slot: CharacterEquipmentSlotV1, definition: CatalogDefinition) => void;
  clearAssignment: (slotId: string) => void;
  addEquipmentSlot: () => void;
  deleteSlot: (slotId: string) => void;
  updateSlot: () => void;
  enterDrawnAuthoring: (slot: CharacterEquipmentSlotV1, mode: 'drawn' | 'weapon-grip') => void;
  addHandBoneMount: () => void;
  removeHandBoneMount: () => void;
  updateTransformNumber: (
    target: 'position' | 'scale',
    key: 'x' | 'y' | 'z',
    value: string,
  ) => void;
  updateTransformRotation: (key: 'x' | 'y' | 'z', value: string) => void;
  updateMountBone: (bone: string) => void;
  loadController: (id: string) => Promise<void>;
  saveController: () => Promise<void>;
  addStance: () => void;
  renameStance: () => void;
  assignClipToState: (stateId: string, clipName: string) => void;
  assignClipFromDroppedUrl: (stateId: string, url: string) => Promise<void>;
  setAnimationClip: (clipName: string) => void;
  toggleAnimationPlaying: () => void;
  loadUalLibrary: () => Promise<void>;
  loadAnimationGlbFile: (file: File) => Promise<void>;
  setAnimationTimeScale: (value: number) => void;
  resetSettingsDefaults: () => void;
  updateSettingsSpeed: (
    key:
      | 'walkSpeedMetersPerSecond'
      | 'runSpeedMetersPerSecond'
      | 'sprintSpeedMetersPerSecond'
      | 'jumpSpeedMetersPerSecond',
    value: number,
  ) => void;
  displayNumber: (value: number) => string;
  getRotationDegrees: (transform: PrefabTransform) => { x: number; y: number; z: number };
  equipmentDndType: string;
}

export interface BaseCharacterEquipmentEditorOptions {
  stageHost: HTMLElement;
  leftHost: HTMLElement;
  rightHost: HTMLElement;
  onUiChange: () => void;
}
