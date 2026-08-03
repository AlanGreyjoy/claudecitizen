import type { AnimationControllerV1, AnimationLocomotionKind } from '../../player/animation/schema';
import type { BaseCharacterEquipmentV1, BaseCharacterType } from '../../player/equipment/base-character-equipment';
import type { CharacterSettingsV1 } from '../../player/character-settings';
import type { AnimationControllerListEntry } from '../../editor/api';
import type { WeaponSelectSlotId } from '../../player/inventory/weapon-select';
import type { SidekickAnimationRuntime } from '../characters/sidekick/animation-runtime';
import type { SidekickAvatarInstance } from '../characters/sidekick/assemble-avatar';
import type { SidekickCharacterDefinitionV2 } from '../../player/character_creator/sidekick-definition';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { setDefaultAnimationController } from '../../player/animation/default-controller';
import { createBaseCharacterEditorUiApi } from './base-character-equipment-ui-api';
import type {
  BaseCharacterEditorUiApi,
  BaseCharacterLeftTab,
  CharacterPreviewPose,
  EquipmentGizmoMode,
} from './base-character-equipment-ui';
import type { MountEditMode } from './base-character-equipment-transform';
import type { CatalogDefinition } from './base-character-equipment-utils';
import {
  applyTransform,
  displayNumber,
  setTransformEulerDegrees,
  transformEulerDegrees,
} from './base-character-equipment-utils';
import type { EquipmentTransformLookupParams } from './base-character-equipment-transform-lookup';
import { currentTransformTarget } from './base-character-equipment-transform-lookup';
import { currentDrawnMount, currentMount, currentSlot } from './base-character-equipment-avatar';

export interface BaseCharacterUiBindingsState {
  documentState: BaseCharacterEquipmentV1 | null;
  controllerState: AnimationControllerV1 | null;
  controllerList: AnimationControllerListEntry[];
  selectedControllerId: string;
  controllerDirty: boolean;
  settingsState: CharacterSettingsV1;
  settingsDirty: boolean;
  leftTab: BaseCharacterLeftTab;
  selectedType: BaseCharacterType;
  previewPose: CharacterPreviewPose;
  selectedStanceId: string;
  previewLocomotion: AnimationLocomotionKind;
  selectedSlotId: string;
  assignments: Map<string, CatalogDefinition>;
  mountEditMode: MountEditMode;
  simulateDrawnSlotId: string | null;
  gizmoMode: EquipmentGizmoMode;
  gizmoSpace: 'local' | 'world';
  guidesVisible: boolean;
  catalogMessage: string;
  weapons: import('../../net/admin-api').WeaponDefinition[];
  backpacks: import('../../net/admin-api').BackpackDefinition[];
  playTestActive: boolean;
  playTestWeaponSlotId: WeaponSelectSlotId | null;
  animation: SidekickAnimationRuntime | null;
  lastLoadedSourceId: string;
  animationObjectUrl: string | null;
}

export interface BaseCharacterUiBindingsClosure {
  documentState: BaseCharacterEquipmentV1 | null;
  controllerState: AnimationControllerV1 | null;
  controllerList: AnimationControllerListEntry[];
  selectedControllerId: string;
  controllerDirty: boolean;
  settingsState: CharacterSettingsV1;
  settingsDirty: boolean;
  leftTab: BaseCharacterLeftTab;
  selectedType: BaseCharacterType;
  previewPose: CharacterPreviewPose;
  selectedStanceId: string;
  previewLocomotion: AnimationLocomotionKind;
  selectedSlotId: string;
  assignments: Map<string, CatalogDefinition>;
  mountEditMode: MountEditMode;
  simulateDrawnSlotId: string | null;
  gizmoMode: EquipmentGizmoMode;
  gizmoSpace: 'local' | 'world';
  guidesVisible: boolean;
  catalogMessage: string;
  weapons: import('../../net/admin-api').WeaponDefinition[];
  backpacks: import('../../net/admin-api').BackpackDefinition[];
  playTestActive: boolean;
  playTestWeaponSlotId: WeaponSelectSlotId | null;
  animation: SidekickAnimationRuntime | null;
  lastLoadedSourceId: string;
  animationObjectUrl: string | null;
  activeBackpackPrefabId: string | null;
  weaponPreviewRoots: Map<string, import('three').Object3D>;
  weaponGripEntities: Map<string, import('../../world/prefabs/schema').PrefabEntity>;
  drawnPivots: Map<string, import('three').Group>;
  mountPivots: Map<string, import('three').Group>;
  backpackSocketObjects: Map<string, import('three').Object3D>;
  backpackSocketEntities: Map<string, import('../../world/prefabs/schema').PrefabEntity>;
  avatar: SidekickAvatarInstance | null;
  defaultDefinition: SidekickCharacterDefinitionV2 | null;
}

export function createBaseCharacterUiBindings(
  closure: BaseCharacterUiBindingsClosure,
  deps: {
    gizmo: TransformControls;
    hasUnsavedChanges: () => boolean;
    markDirty: () => void;
    markControllerDirty: () => void;
    markSettingsDirty: () => void;
    markBackpackPrefabDirty: (prefabId: string) => void;
    markWeaponPrefabDirty: (prefabId: string) => void;
    save: () => Promise<void>;
    loadDocument: () => Promise<void>;
    setPreviewPose: (pose: CharacterPreviewPose) => Promise<void>;
    applyCharacterType: () => Promise<void>;
    previewControllerState: () => Promise<void>;
    rebuildEquipmentPreview: () => Promise<void>;
    refreshCatalog: () => Promise<void>;
    assignDefinition: (
      slot: import('../../player/equipment/base-character-equipment').CharacterEquipmentSlotV1,
      definition: CatalogDefinition,
    ) => void;
    loadController: (id: string, opts?: { force?: boolean }) => Promise<void>;
    loadAnimationFromAsset: (url: string) => Promise<void>;
    loadWeaponPrefabDraft: (prefabId: string) => Promise<import('../../world/prefabs/schema').PrefabDocument | null>;
    ensureDrawnGripEntity: (doc: import('../../world/prefabs/schema').PrefabDocument) => import('../../world/prefabs/schema').PrefabEntity;
    setPlayTestActive: (next: boolean) => Promise<void>;
    equipDefaultPlayTestLoadout: (overwrite?: boolean) => boolean;
    assignClipToState: (stateId: string, clipName: string) => void;
    ensureAnimatedPose: () => Promise<void>;
    ensureAvatar: () => Promise<void>;
    revokeAnimationObjectUrl: () => void;
    setStageStatus: (message: string, error?: boolean) => void;
    syncGizmo: () => void;
    notifyUiChange: () => void;
  },
): {
  uiState: BaseCharacterUiBindingsState;
  uiApi: BaseCharacterEditorUiApi;
  syncClosureToUiState: () => void;
  syncUiStateToClosure: () => void;
} {
  const uiState: BaseCharacterUiBindingsState = {
    documentState: null,
    controllerState: null,
    controllerList: [],
    selectedControllerId: 'default',
    controllerDirty: false,
    settingsState: closure.settingsState,
    settingsDirty: false,
    leftTab: 'equipment',
    selectedType: 1,
    previewPose: 'reference',
    selectedStanceId: 'unarmed',
    previewLocomotion: 'idle',
    selectedSlotId: 'backpack',
    assignments: closure.assignments,
    mountEditMode: 'holster',
    simulateDrawnSlotId: null,
    gizmoMode: 'translate',
    gizmoSpace: 'local',
    guidesVisible: closure.guidesVisible,
    catalogMessage: closure.catalogMessage,
    weapons: closure.weapons,
    backpacks: closure.backpacks,
    playTestActive: false,
    playTestWeaponSlotId: null,
    animation: null,
    lastLoadedSourceId: closure.lastLoadedSourceId,
    animationObjectUrl: null,
  };

  const transformParams = (): EquipmentTransformLookupParams => ({
    documentState: closure.documentState,
    selectedType: closure.selectedType,
    selectedSlotId: closure.selectedSlotId,
    mountEditMode: closure.mountEditMode,
    assignments: closure.assignments,
    activeBackpackPrefabId: closure.activeBackpackPrefabId,
    weaponPreviewRoots: closure.weaponPreviewRoots,
    weaponGripEntities: closure.weaponGripEntities,
    drawnPivots: closure.drawnPivots,
    mountPivots: closure.mountPivots,
    backpackSocketObjects: closure.backpackSocketObjects,
    backpackSocketEntities: closure.backpackSocketEntities,
  });

  const syncClosureToUiState = (): void => {
    uiState.documentState = closure.documentState;
    uiState.controllerState = closure.controllerState;
    uiState.controllerList = closure.controllerList;
    uiState.selectedControllerId = closure.selectedControllerId;
    uiState.controllerDirty = closure.controllerDirty;
    uiState.settingsState = closure.settingsState;
    uiState.settingsDirty = closure.settingsDirty;
    uiState.leftTab = closure.leftTab;
    uiState.selectedType = closure.selectedType;
    uiState.previewPose = closure.previewPose;
    uiState.selectedStanceId = closure.selectedStanceId;
    uiState.previewLocomotion = closure.previewLocomotion;
    uiState.selectedSlotId = closure.selectedSlotId;
    uiState.assignments = closure.assignments;
    uiState.mountEditMode = closure.mountEditMode;
    uiState.simulateDrawnSlotId = closure.simulateDrawnSlotId;
    uiState.gizmoMode = closure.gizmoMode;
    uiState.gizmoSpace = closure.gizmoSpace;
    uiState.guidesVisible = closure.guidesVisible;
    uiState.catalogMessage = closure.catalogMessage;
    uiState.weapons = closure.weapons;
    uiState.backpacks = closure.backpacks;
    uiState.playTestActive = closure.playTestActive;
    uiState.playTestWeaponSlotId = closure.playTestWeaponSlotId;
    uiState.animation = closure.animation;
    uiState.lastLoadedSourceId = closure.lastLoadedSourceId;
    uiState.animationObjectUrl = closure.animationObjectUrl;
  };

  const syncUiStateToClosure = (): void => {
    closure.documentState = uiState.documentState;
    closure.controllerState = uiState.controllerState;
    closure.controllerList = uiState.controllerList;
    closure.selectedControllerId = uiState.selectedControllerId;
    closure.controllerDirty = uiState.controllerDirty;
    closure.settingsState = uiState.settingsState;
    closure.settingsDirty = uiState.settingsDirty;
    closure.leftTab = uiState.leftTab;
    closure.selectedType = uiState.selectedType;
    closure.previewPose = uiState.previewPose;
    closure.selectedStanceId = uiState.selectedStanceId;
    closure.previewLocomotion = uiState.previewLocomotion;
    closure.selectedSlotId = uiState.selectedSlotId;
    closure.assignments = uiState.assignments;
    closure.mountEditMode = uiState.mountEditMode;
    closure.simulateDrawnSlotId = uiState.simulateDrawnSlotId;
    closure.gizmoMode = uiState.gizmoMode;
    closure.gizmoSpace = uiState.gizmoSpace;
    closure.guidesVisible = uiState.guidesVisible;
    closure.catalogMessage = uiState.catalogMessage;
    closure.weapons = uiState.weapons;
    closure.backpacks = uiState.backpacks;
    closure.playTestActive = uiState.playTestActive;
    closure.playTestWeaponSlotId = uiState.playTestWeaponSlotId;
    closure.animation = uiState.animation;
    closure.lastLoadedSourceId = uiState.lastLoadedSourceId;
    closure.animationObjectUrl = uiState.animationObjectUrl;
  };

  const uiApi = createBaseCharacterEditorUiApi({
    getState: () => uiState,
    state: uiState,
    hasUnsavedChanges: deps.hasUnsavedChanges,
    notifyUiChange: () => {
      // React/UI writes land on uiState; push them into closure before the
      // closure→ui sync in deps.notifyUiChange (otherwise loads get wiped).
      syncUiStateToClosure();
      deps.notifyUiChange();
    },
    markDirty: deps.markDirty,
    markControllerDirty: deps.markControllerDirty,
    markSettingsDirty: deps.markSettingsDirty,
    markBackpackPrefabDirty: deps.markBackpackPrefabDirty,
    markWeaponPrefabDirty: deps.markWeaponPrefabDirty,
    currentSlot: () => currentSlot(closure.documentState, closure.selectedSlotId),
    currentMount: () => currentMount(closure.documentState, closure.selectedType, closure.selectedSlotId),
    currentDrawnMount: () => currentDrawnMount(closure.documentState, closure.selectedType, closure.selectedSlotId),
    currentTransformTarget: () => currentTransformTarget(transformParams()),
    getBackpackSocketEntities: () => closure.backpackSocketEntities,
    displayNumber,
    transformEulerDegrees,
    setTransformEulerDegrees,
    applyTransform,
    gizmo: deps.gizmo,
    save: deps.save,
    loadDocument: deps.loadDocument,
    setPreviewPose: deps.setPreviewPose,
    applyCharacterType: deps.applyCharacterType,
    previewControllerState: deps.previewControllerState,
    rebuildEquipmentPreview: deps.rebuildEquipmentPreview,
    refreshCatalog: deps.refreshCatalog,
    assignDefinition: deps.assignDefinition,
    loadController: deps.loadController,
    loadAnimationFromAsset: deps.loadAnimationFromAsset,
    loadWeaponPrefabDraft: deps.loadWeaponPrefabDraft,
    ensureDrawnGripEntity: deps.ensureDrawnGripEntity,
    setPlayTestActive: deps.setPlayTestActive,
    equipDefaultPlayTestLoadout: deps.equipDefaultPlayTestLoadout,
    assignClipToState: deps.assignClipToState,
    ensureAnimatedPose: deps.ensureAnimatedPose,
    ensureAvatar: deps.ensureAvatar,
    revokeAnimationObjectUrl: deps.revokeAnimationObjectUrl,
    setStageStatus: deps.setStageStatus,
    syncGizmo: deps.syncGizmo,
    setGizmoModeInternal: (mode) => {
      if (closure.playTestActive) return;
      closure.gizmoMode = mode;
      deps.gizmo.setMode(mode);
      deps.notifyUiChange();
    },
    setDefaultAnimationController,
    get avatar() { return closure.avatar; },
    get defaultDefinition() { return closure.defaultDefinition; },
  });

  return { uiState, uiApi, syncClosureToUiState, syncUiStateToClosure };
}
