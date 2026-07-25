import * as THREE from 'three';
import type { BackpackDefinition, WeaponDefinition } from '../../net/admin-api';
import type { AnimationControllerV1, AnimationLocomotionKind } from '../../player/animation/schema';
import type { BaseCharacterEquipmentV1 } from '../../player/equipment/base-character-equipment';
import type { CharacterSettingsV1 } from '../../player/character-settings';
import type { WeaponSelectSlotId } from '../../player/inventory/weapon-select';
import { createPlayerControls } from '../../input/player-controls';
import type { AnimationControllerListEntry } from '../../editor/api';
import type { PrefabDocument, PrefabEntity } from '../../world/prefabs/schema';
import type { ControllerClipContext } from './base-character-equipment-controller';
import type { AvatarPreviewContext, DocumentPersistenceContext } from './base-character-equipment-avatar';
import type { BaseCharacterStageDom } from './base-character-equipment-stage';
import type { MountEditMode } from './base-character-equipment-transform';
import type { CharacterPreviewPose } from './base-character-equipment-ui';
import type { CatalogDefinition } from './base-character-equipment-utils';
import type { PlayTestSessionContext } from './base-character-equipment-play-session';
import type { SidekickUpperBodyAimController } from '../characters/sidekick/upper-body-aim';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import type { CharacterState } from '../../types';

export interface EditorRuntimeState {
  closure: {
    documentState: BaseCharacterEquipmentV1 | null;
    controllerState: AnimationControllerV1 | null;
    controllerList: AnimationControllerListEntry[];
    selectedControllerId: string;
    controllerDirty: boolean;
    settingsState: CharacterSettingsV1;
    settingsDirty: boolean;
    leftTab: string;
    selectedType: 1 | 2;
    previewPose: CharacterPreviewPose;
    selectedStanceId: string;
    previewLocomotion: AnimationLocomotionKind;
    selectedSlotId: string;
    assignments: Map<string, CatalogDefinition>;
    mountEditMode: MountEditMode;
    simulateDrawnSlotId: string | null;
    gizmoMode: string;
    gizmoSpace: 'local' | 'world';
    catalogMessage: string;
    weapons: WeaponDefinition[];
    backpacks: BackpackDefinition[];
    playTestActive: boolean;
    playTestWeaponSlotId: WeaponSelectSlotId | null;
    animation: import('../characters/sidekick/animation-runtime').SidekickAnimationRuntime | null;
    lastLoadedSourceId: string;
    animationObjectUrl: string | null;
    activeBackpackPrefabId: string | null;
    weaponPreviewRoots: Map<string, THREE.Object3D>;
    weaponGripEntities: Map<string, PrefabEntity>;
    drawnPivots: Map<string, THREE.Group>;
    mountPivots: Map<string, THREE.Group>;
    backpackSocketObjects: Map<string, THREE.Object3D>;
    backpackSocketEntities: Map<string, PrefabEntity>;
    avatar: import('../characters/sidekick/assemble-avatar').SidekickAvatarInstance | null;
    defaultDefinition: import('../../player/character_creator/sidekick-definition').SidekickCharacterDefinitionV2 | null;
  };
  dirty: { value: boolean };
  previewGeneration: { value: number };
  controllerUpperBodyAim: { current: SidekickUpperBodyAimController | null };
  playTestCharacter: { current: CharacterState };
  playTestHardAim: { value: boolean };
  playTestAimZoom01: { value: number };
  playTestAnimationKey: { value: string };
  playTestAnimationGeneration: { value: number };
  playTestPoseBefore: { value: CharacterPreviewPose };
  playTestStanceBefore: { value: string };
  playTestLocomotionBefore: { value: AnimationLocomotionKind };
  playTestClipBefore: { value: string };
  authoringCameraSuspended: { value: boolean };
  backpackPrefabDrafts: Map<string, PrefabDocument>;
  weaponPrefabDrafts: Map<string, PrefabDocument>;
  dirtyBackpackPrefabIds: Set<string>;
  dirtyWeaponPrefabIds: Set<string>;
  playTestControls: { current: ReturnType<typeof createPlayerControls> | null };
  playTestWeaponButtons: Map<WeaponSelectSlotId, HTMLButtonElement>;
  playTestCameraPositionBefore: THREE.Vector3;
  playTestCameraTargetBefore: THREE.Vector3;
  playTestDesiredCameraPos: THREE.Vector3;
  playTestDesiredCameraTarget: THREE.Vector3;
  playTestSmoothedCameraPos: THREE.Vector3;
  playTestSmoothedCameraTarget: THREE.Vector3;
  playTestUpperAimView: THREE.Vector3;
  playTestUpperAimUp: THREE.Vector3;
  playTestUpperAimForward: THREE.Vector3;
  playTestUpperAimPlanarView: THREE.Vector3;
  playTestUpperAimCross: THREE.Vector3;
  controllerSourceLoads: Map<string, Promise<void>>;
}

export function createControllerClipContext(
  runtime: EditorRuntimeState,
  deps: Pick<ControllerClipContext, 'markControllerDirty' | 'notifyUiChange' | 'setStageStatus' | 'ensureAnimatedPose'>,
): ControllerClipContext {
  const { closure } = runtime;
  return {
    getControllerState: () => closure.controllerState,
    setControllerState: (value) => { closure.controllerState = value; },
    getControllerList: () => closure.controllerList,
    setControllerList: (value) => { closure.controllerList = value; },
    getSelectedControllerId: () => closure.selectedControllerId,
    setSelectedControllerId: (value) => { closure.selectedControllerId = value; },
    getSelectedStanceId: () => closure.selectedStanceId,
    setSelectedStanceId: (value) => { closure.selectedStanceId = value; },
    getPreviewLocomotion: () => closure.previewLocomotion,
    setPreviewLocomotion: (value) => { closure.previewLocomotion = value; },
    getLastLoadedSourceId: () => closure.lastLoadedSourceId,
    setLastLoadedSourceId: (value) => { closure.lastLoadedSourceId = value; },
    getControllerDirty: () => closure.controllerDirty,
    setControllerDirty: (value) => { closure.controllerDirty = value; },
    getAnimation: () => closure.animation,
    getPreviewPose: () => closure.previewPose,
    ...deps,
    controllerSourceLoads: runtime.controllerSourceLoads,
  };
}

export function createAvatarPreviewContext(
  runtime: EditorRuntimeState,
  stage: {
    previewRoot: THREE.Group;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    gizmo: TransformControls;
  },
  deps: Pick<AvatarPreviewContext, 'setStageStatus' | 'setPackMissing' | 'notifyUiChange' | 'syncGizmo' | 'renderPlayTestHud'>,
): AvatarPreviewContext {
  const { closure } = runtime;
  return {
    previewRoot: stage.previewRoot,
    camera: stage.camera,
    controls: stage.controls,
    getDocumentState: () => closure.documentState,
    setDocumentState: (value) => { closure.documentState = value; },
    getSelectedType: () => closure.selectedType,
    getPreviewPose: () => closure.previewPose,
    getSelectedSlotId: () => closure.selectedSlotId,
    getMountEditMode: () => closure.mountEditMode,
    getSimulateDrawnSlotId: () => closure.simulateDrawnSlotId,
    getPlayTestActive: () => closure.playTestActive,
    getPlayTestWeaponSlotId: () => closure.playTestWeaponSlotId,
    getAssignments: () => closure.assignments,
    getWeapons: () => closure.weapons,
    getBackpacks: () => closure.backpacks,
    setWeapons: (value) => { closure.weapons = value; },
    setBackpacks: (value) => { closure.backpacks = value; },
    setCatalogMessage: (value) => { closure.catalogMessage = value; },
    getAvatar: () => closure.avatar,
    setAvatar: (value) => { closure.avatar = value; },
    getAnimation: () => closure.animation,
    setAnimation: (value) => { closure.animation = value; },
    getControllerUpperBodyAim: () => runtime.controllerUpperBodyAim.current,
    setControllerUpperBodyAim: (value) => { runtime.controllerUpperBodyAim.current = value; },
    getDefaultDefinition: () => closure.defaultDefinition,
    setDefaultDefinition: (value) => { closure.defaultDefinition = value; },
    getMountPivots: () => closure.mountPivots,
    setMountPivots: (value) => { closure.mountPivots = value; },
    getDrawnPivots: () => closure.drawnPivots,
    setDrawnPivots: (value) => { closure.drawnPivots = value; },
    getWeaponPreviewRoots: () => closure.weaponPreviewRoots,
    setWeaponPreviewRoots: (value) => { closure.weaponPreviewRoots = value; },
    getWeaponGripEntities: () => closure.weaponGripEntities,
    setWeaponGripEntities: (value) => { closure.weaponGripEntities = value; },
    getActiveBackpackPrefabId: () => closure.activeBackpackPrefabId,
    setActiveBackpackPrefabId: (value) => { closure.activeBackpackPrefabId = value; },
    getBackpackSocketObjects: () => closure.backpackSocketObjects,
    setBackpackSocketObjects: (value) => { closure.backpackSocketObjects = value; },
    getBackpackSocketEntities: () => closure.backpackSocketEntities,
    setBackpackSocketEntities: (value) => { closure.backpackSocketEntities = value; },
    backpackPrefabDrafts: runtime.backpackPrefabDrafts,
    weaponPrefabDrafts: runtime.weaponPrefabDrafts,
    getPreviewGeneration: () => runtime.previewGeneration.value,
    bumpPreviewGeneration: () => {
      runtime.previewGeneration.value += 1;
      return runtime.previewGeneration.value;
    },
    gizmo: stage.gizmo,
    ...deps,
  };
}

export function createPlayTestSessionContext(
  runtime: EditorRuntimeState,
  dom: BaseCharacterStageDom,
  stage: {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    gizmo: TransformControls;
    previewRoot: THREE.Group;
  },
  deps: Pick<
    PlayTestSessionContext,
    | 'endFly'
    | 'ensureAvatar'
    | 'setPreviewPose'
    | 'rebuildEquipmentPreview'
    | 'ensureControllerClipLoaded'
    | 'ensureAnimatedPose'
    | 'setStageStatus'
    | 'notifyUiChange'
    | 'syncGizmo'
  >,
): PlayTestSessionContext {
  const { closure } = runtime;
  return {
    ...dom,
    ...stage,
    getPlayTestActive: () => closure.playTestActive,
    setPlayTestActive: (value) => { closure.playTestActive = value; },
    getPlayTestWeaponSlotId: () => closure.playTestWeaponSlotId,
    setPlayTestWeaponSlotId: (value) => { closure.playTestWeaponSlotId = value; },
    getPlayTestCharacter: () => runtime.playTestCharacter.current,
    setPlayTestCharacter: (value) => { runtime.playTestCharacter.current = value; },
    getPlayTestHardAim: () => runtime.playTestHardAim.value,
    setPlayTestHardAim: (value) => { runtime.playTestHardAim.value = value; },
    getPlayTestAimZoom01: () => runtime.playTestAimZoom01.value,
    setPlayTestAimZoom01: (value) => { runtime.playTestAimZoom01.value = value; },
    getPlayTestAnimationKey: () => runtime.playTestAnimationKey.value,
    setPlayTestAnimationKey: (value) => { runtime.playTestAnimationKey.value = value; },
    getPlayTestAnimationGeneration: () => runtime.playTestAnimationGeneration.value,
    bumpPlayTestAnimationGeneration: () => {
      runtime.playTestAnimationGeneration.value += 1;
      return runtime.playTestAnimationGeneration.value;
    },
    getPlayTestPoseBefore: () => runtime.playTestPoseBefore.value,
    setPlayTestPoseBefore: (value) => { runtime.playTestPoseBefore.value = value; },
    getPlayTestStanceBefore: () => runtime.playTestStanceBefore.value,
    setPlayTestStanceBefore: (value) => { runtime.playTestStanceBefore.value = value; },
    getPlayTestLocomotionBefore: () => runtime.playTestLocomotionBefore.value,
    setPlayTestLocomotionBefore: (value) => { runtime.playTestLocomotionBefore.value = value; },
    getPlayTestClipBefore: () => runtime.playTestClipBefore.value,
    setPlayTestClipBefore: (value) => { runtime.playTestClipBefore.value = value; },
    getAuthoringCameraSuspended: () => runtime.authoringCameraSuspended.value,
    setAuthoringCameraSuspended: (value) => { runtime.authoringCameraSuspended.value = value; },
    getSelectedStanceId: () => closure.selectedStanceId,
    setSelectedStanceId: (value) => { closure.selectedStanceId = value; },
    getPreviewLocomotion: () => closure.previewLocomotion,
    setPreviewLocomotion: (value) => { closure.previewLocomotion = value; },
    getControllerState: () => closure.controllerState,
    getAnimation: () => closure.animation,
    getAvatar: () => closure.avatar,
    getDocumentState: () => closure.documentState,
    getAssignments: () => closure.assignments,
    getPreviewPose: () => closure.previewPose,
    getWeapons: () => closure.weapons,
    getBackpacks: () => closure.backpacks,
    playTestControls: runtime.playTestControls,
    playTestWeaponButtons: runtime.playTestWeaponButtons,
    playTestCameraPositionBefore: runtime.playTestCameraPositionBefore,
    playTestCameraTargetBefore: runtime.playTestCameraTargetBefore,
    playTestDesiredCameraPos: runtime.playTestDesiredCameraPos,
    playTestDesiredCameraTarget: runtime.playTestDesiredCameraTarget,
    playTestSmoothedCameraPos: runtime.playTestSmoothedCameraPos,
    playTestSmoothedCameraTarget: runtime.playTestSmoothedCameraTarget,
    playTestUpperAimView: runtime.playTestUpperAimView,
    playTestUpperAimUp: runtime.playTestUpperAimUp,
    playTestUpperAimForward: runtime.playTestUpperAimForward,
    playTestUpperAimPlanarView: runtime.playTestUpperAimPlanarView,
    playTestUpperAimCross: runtime.playTestUpperAimCross,
    getControllerUpperBodyAim: () => runtime.controllerUpperBodyAim.current,
    ...deps,
  };
}

export function createDocumentPersistenceContext(
  runtime: EditorRuntimeState,
  deps: Omit<
    DocumentPersistenceContext,
    | 'getDocumentState'
    | 'setDocumentState'
    | 'getControllerState'
    | 'setControllerState'
    | 'getControllerList'
    | 'setControllerList'
    | 'getSelectedControllerId'
    | 'setSelectedControllerId'
    | 'getSelectedSlotId'
    | 'setSelectedSlotId'
    | 'getMountEditMode'
    | 'setMountEditMode'
    | 'getSimulateDrawnSlotId'
    | 'setSimulateDrawnSlotId'
    | 'getAssignments'
    | 'setAssignments'
    | 'getWeapons'
    | 'getBackpacks'
    | 'getSettingsState'
    | 'setSettingsState'
    | 'getDirty'
    | 'setDirty'
    | 'getControllerDirty'
    | 'setControllerDirty'
    | 'getSettingsDirty'
    | 'setSettingsDirty'
    | 'dirtyBackpackPrefabIds'
    | 'dirtyWeaponPrefabIds'
    | 'backpackPrefabDrafts'
    | 'weaponPrefabDrafts'
  >,
): DocumentPersistenceContext {
  const { closure } = runtime;
  return {
    getDocumentState: () => closure.documentState,
    setDocumentState: (value) => { closure.documentState = value; },
    getControllerState: () => closure.controllerState,
    setControllerState: (value) => { closure.controllerState = value; },
    getControllerList: () => closure.controllerList,
    setControllerList: (value) => { closure.controllerList = value; },
    getSelectedControllerId: () => closure.selectedControllerId,
    setSelectedControllerId: (value) => { closure.selectedControllerId = value; },
    getSelectedSlotId: () => closure.selectedSlotId,
    setSelectedSlotId: (value) => { closure.selectedSlotId = value; },
    getMountEditMode: () => closure.mountEditMode,
    setMountEditMode: (value) => { closure.mountEditMode = value; },
    getSimulateDrawnSlotId: () => closure.simulateDrawnSlotId,
    setSimulateDrawnSlotId: (value) => { closure.simulateDrawnSlotId = value; },
    getAssignments: () => closure.assignments,
    setAssignments: (value) => { closure.assignments = value; },
    getWeapons: () => closure.weapons,
    getBackpacks: () => closure.backpacks,
    getSettingsState: () => closure.settingsState,
    setSettingsState: (value) => { closure.settingsState = value; },
    getDirty: () => runtime.dirty.value,
    setDirty: (value) => { runtime.dirty.value = value; },
    getControllerDirty: () => closure.controllerDirty,
    setControllerDirty: (value) => { closure.controllerDirty = value; },
    getSettingsDirty: () => closure.settingsDirty,
    setSettingsDirty: (value) => { closure.settingsDirty = value; },
    dirtyBackpackPrefabIds: runtime.dirtyBackpackPrefabIds,
    dirtyWeaponPrefabIds: runtime.dirtyWeaponPrefabIds,
    backpackPrefabDrafts: runtime.backpackPrefabDrafts,
    weaponPrefabDrafts: runtime.weaponPrefabDrafts,
    ...deps,
  };
}
