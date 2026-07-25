import * as THREE from 'three';
import type { BackpackDefinition, WeaponDefinition } from '../../net/admin-api';
import { UAL_ANIMATION_SOURCE_ID } from '../../player/animation/schema';
import { cloneCharacterSettings, getCharacterSettings } from '../../player/character-settings';
import { setDefaultAnimationController } from '../../player/animation/default-controller';
import type { CharacterEquipmentSlotV1 } from '../../player/equipment/base-character-equipment';
import type { WeaponSelectSlotId } from '../../player/inventory/weapon-select';
import { createPlayerControls } from '../../input/player-controls';
import type { PrefabDocument, PrefabEntity } from '../../world/prefabs/schema';
import {
  assignClipToState,
  ensureControllerClipLoaded,
  ensureSourceForUrl,
  loadController,
  previewControllerState,
} from './base-character-equipment-controller';
import { createBaseCharacterFlyCamera } from './base-character-equipment-fly';
import {
  applyCharacterType as applyCharacterTypePreview,
  assignDefinition as assignCatalogDefinition,
  disposeAvatarPreview,
  ensureAvatar as ensureAvatarPreview,
  ensureDrawnGripEntity,
  loadDocument as loadEquipmentDocument,
  loadWeaponPrefabDraft,
  reloadSidekickPack as reloadSidekickPackPreview,
  refreshCatalog as refreshCatalogPreview,
  rebuildEquipmentPreview,
  saveDocument,
  setPreviewPose as setPreviewPosePreview,
} from './base-character-equipment-avatar';
import {
  createAvatarPreviewContext,
  createControllerClipContext,
  createDocumentPersistenceContext,
  createPlayTestSessionContext,
  type EditorRuntimeState,
} from './base-character-equipment-editor-wiring';
import {
  createPlayTestCharacterState,
  createPlayTestSession,
  equipDefaultPlayTestLoadout,
} from './base-character-equipment-play-session';
import {
  createBaseCharacterStageDom,
  createBaseCharacterStageThree,
} from './base-character-equipment-stage';
import { currentTransformTarget } from './base-character-equipment-transform-lookup';
import type {
  BaseCharacterEquipmentEditorOptions,
  EquipmentGizmoMode,
} from './base-character-equipment-ui';
import {
  createBaseCharacterUiBindings,
  type BaseCharacterUiBindingsClosure,
} from './base-character-equipment-ui-bindings';
import type { CatalogDefinition } from './base-character-equipment-utils';
import { copyObjectToTransform, labelFromUrl } from './base-character-equipment-utils';

export interface BaseCharacterEquipmentEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  setGizmoMode: (mode: EquipmentGizmoMode) => void;
  save: () => Promise<void>;
  loadAnimationFromAsset: (url: string) => Promise<void>;
  reloadSidekickPack: () => Promise<void>;
  getLeftPanel: () => HTMLElement;
  getRightPanel: () => HTMLElement;
  getUiApi: () => ReturnType<typeof createBaseCharacterUiBindings>['uiApi'];
  dispose: () => void;
}

export type { BaseCharacterEquipmentEditorOptions } from './base-character-equipment-ui';

export function createBaseCharacterEquipmentEditor(
  options: BaseCharacterEquipmentEditorOptions,
): BaseCharacterEquipmentEditor {
  const { stageHost, leftHost, rightHost, onUiChange } = options;
  const dom = createBaseCharacterStageDom(stageHost);
  const { stage, canvas, stageStatus, packMissingBanner } = dom;

  const closure: BaseCharacterUiBindingsClosure = {
    documentState: null,
    controllerState: null,
    controllerList: [],
    selectedControllerId: 'default',
    controllerDirty: false,
    settingsState: cloneCharacterSettings(getCharacterSettings()),
    settingsDirty: false,
    leftTab: 'equipment',
    selectedType: 1,
    previewPose: 'reference',
    selectedStanceId: 'unarmed',
    previewLocomotion: 'idle',
    selectedSlotId: 'backpack',
    assignments: new Map<string, CatalogDefinition>(),
    mountEditMode: 'holster',
    simulateDrawnSlotId: null,
    gizmoMode: 'translate',
    gizmoSpace: 'local',
    catalogMessage: 'Catalog not loaded.',
    weapons: [] as WeaponDefinition[],
    backpacks: [] as BackpackDefinition[],
    playTestActive: false,
    playTestWeaponSlotId: null,
    animation: null,
    lastLoadedSourceId: UAL_ANIMATION_SOURCE_ID,
    animationObjectUrl: null,
    activeBackpackPrefabId: null,
    weaponPreviewRoots: new Map<string, THREE.Object3D>(),
    weaponGripEntities: new Map<string, PrefabEntity>(),
    drawnPivots: new Map<string, THREE.Group>(),
    mountPivots: new Map<string, THREE.Group>(),
    backpackSocketObjects: new Map<string, THREE.Object3D>(),
    backpackSocketEntities: new Map<string, PrefabEntity>(),
    avatar: null,
    defaultDefinition: null,
  };

  const runtime: EditorRuntimeState = {
    closure,
    dirty: { value: false },
    previewGeneration: { value: 0 },
    controllerUpperBodyAim: { current: null },
    playTestCharacter: { current: createPlayTestCharacterState() },
    playTestHardAim: { value: false },
    playTestAimZoom01: { value: 0 },
    playTestAnimationKey: { value: '' },
    playTestAnimationGeneration: { value: 0 },
    playTestPoseBefore: { value: 'reference' },
    playTestStanceBefore: { value: 'unarmed' },
    playTestLocomotionBefore: { value: 'idle' },
    playTestClipBefore: { value: 'Idle_Loop' },
    authoringCameraSuspended: { value: false },
    backpackPrefabDrafts: new Map<string, PrefabDocument>(),
    weaponPrefabDrafts: new Map<string, PrefabDocument>(),
    dirtyBackpackPrefabIds: new Set<string>(),
    dirtyWeaponPrefabIds: new Set<string>(),
    playTestControls: { current: null as ReturnType<typeof createPlayerControls> | null },
    playTestWeaponButtons: new Map<WeaponSelectSlotId, HTMLButtonElement>(),
    playTestCameraPositionBefore: new THREE.Vector3(),
    playTestCameraTargetBefore: new THREE.Vector3(),
    playTestDesiredCameraPos: new THREE.Vector3(),
    playTestDesiredCameraTarget: new THREE.Vector3(),
    playTestSmoothedCameraPos: new THREE.Vector3(),
    playTestSmoothedCameraTarget: new THREE.Vector3(),
    playTestUpperAimView: new THREE.Vector3(),
    playTestUpperAimUp: new THREE.Vector3(),
    playTestUpperAimForward: new THREE.Vector3(),
    playTestUpperAimPlanarView: new THREE.Vector3(),
    playTestUpperAimCross: new THREE.Vector3(),
    controllerSourceLoads: new Map<string, Promise<void>>(),
  };

  let active = false;
  let disposed = false;
  let readyPromise: Promise<void> | null = null;
  let animationObjectUrl: string | null = null;
  const notifyUiChangeRef = { current: (): void => { onUiChange(); } };
  const notifyUiChange = (): void => notifyUiChangeRef.current();

  const setStageStatus = (message: string, error = false): void => {
    stageStatus.textContent = message;
    stageStatus.classList.toggle('is-error', error);
  };
  const setPackMissing = (missing: boolean, detail?: string): void => {
    packMissingBanner.classList.toggle('is-hidden', !missing);
    if (missing) setStageStatus(detail ?? 'Sidekick pack missing or invalid. Use Tools → Locate Synty Sidekick Pack…', true);
  };
  const markDirty = (): void => { runtime.dirty.value = true; notifyUiChange(); };
  const markControllerDirty = (): void => {
    closure.controllerDirty = true;
    if (closure.controllerState?.id === 'default') setDefaultAnimationController(closure.controllerState);
    notifyUiChange();
  };
  const markSettingsDirty = (): void => { closure.settingsDirty = true; notifyUiChange(); };
  const markBackpackPrefabDirty = (prefabId: string): void => { runtime.dirtyBackpackPrefabIds.add(prefabId); notifyUiChange(); };
  const markWeaponPrefabDirty = (prefabId: string): void => { runtime.dirtyWeaponPrefabIds.add(prefabId); notifyUiChange(); };
  const hasUnsavedChanges = (): boolean =>
    runtime.dirty.value || closure.controllerDirty || closure.settingsDirty
    || runtime.dirtyBackpackPrefabIds.size > 0 || runtime.dirtyWeaponPrefabIds.size > 0;

  const stageThree = createBaseCharacterStageThree(dom, (dragging) => {
    if (!closure.playTestActive && !flyCamera.isFlying()) controls.enabled = !dragging;
  });
  const {
    renderer, scene, camera, controls, gizmo, previewRoot, environmentTarget,
    resize, updateAuthoringClipPlanes, clock, resizeObserver,
  } = stageThree;

  const flyCamera = createBaseCharacterFlyCamera({
    camera, canvas, controls,
    isPlayTestActive: () => closure.playTestActive,
    getAuthoringCameraSuspended: () => runtime.authoringCameraSuspended.value,
    setAuthoringCameraSuspended: (value) => { runtime.authoringCameraSuspended.value = value; },
    isDisposed: () => disposed,
    isActive: () => active,
  });

  const transformLookup = () => currentTransformTarget({
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
  const syncGizmo = (): void => {
    const target = transformLookup();
    if (target) gizmo.attach(target.object);
    else gizmo.detach();
  };

  const sessions = {
    playTest: null as ReturnType<typeof createPlayTestSession> | null,
  };
  const avatarCtx = createAvatarPreviewContext(runtime, { previewRoot, camera, controls, gizmo }, {
    setStageStatus, setPackMissing, notifyUiChange, syncGizmo,
    renderPlayTestHud: () => sessions.playTest!.renderPlayTestHud(),
  });
  const controllerCtx = createControllerClipContext(runtime, {
    markControllerDirty, notifyUiChange, setStageStatus, ensureAnimatedPose: () => ensureAnimatedPose(),
  });
  sessions.playTest = createPlayTestSession(createPlayTestSessionContext(runtime, dom, {
    camera, controls, gizmo, previewRoot,
  }, {
    endFly: () => flyCamera.endFly(),
    ensureAvatar: () => ensureAvatarPreview(avatarCtx),
    setPreviewPose: (pose) => setPreviewPosePreview(avatarCtx, pose, (next) => { closure.previewPose = next; }),
    rebuildEquipmentPreview: () => rebuildEquipmentPreview(avatarCtx),
    ensureControllerClipLoaded: (clip) => ensureControllerClipLoaded(controllerCtx, clip),
    ensureAnimatedPose: () => ensureAnimatedPose(),
    setStageStatus, notifyUiChange, syncGizmo,
  }));
  const playTestSession = sessions.playTest;

  gizmo.addEventListener('objectChange', () => {
    const target = transformLookup();
    if (!target || gizmo.object !== target.object) return;
    copyObjectToTransform(target.object, target.transform);
    if (target.source === 'backpack-socket' && target.prefabId) runtime.dirtyBackpackPrefabIds.add(target.prefabId);
    else if (target.source === 'weapon-grip' && target.prefabId) runtime.dirtyWeaponPrefabIds.add(target.prefabId);
    else runtime.dirty.value = true;
    notifyUiChange();
    notifyUiChange();
  });

  const renderFrame = (): void => {
    if (disposed) return;
    requestAnimationFrame(renderFrame);
    if (!active) return;
    resize();
    const deltaSeconds = Math.min(clock.getDelta(), 0.05);
    if (closure.playTestActive) playTestSession.updatePlayTest(deltaSeconds);
    else if (flyCamera.isFlying()) flyCamera.updateFly(deltaSeconds);
    else controls.update();
    if (!closure.playTestActive) updateAuthoringClipPlanes();
    if (closure.previewPose === 'animated') {
      runtime.controllerUpperBodyAim.current?.restore();
      closure.animation?.update(deltaSeconds);
      runtime.controllerUpperBodyAim.current?.update(deltaSeconds);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(renderFrame);

  async function ensureAnimatedPose(): Promise<void> {
    if (closure.previewPose !== 'animated') {
      await setPreviewPosePreview(avatarCtx, 'animated', (next) => { closure.previewPose = next; });
    }
  }
  const refreshCatalog = (): Promise<void> => refreshCatalogPreview(avatarCtx);
  const assignDefinition = (slot: CharacterEquipmentSlotV1, definition: CatalogDefinition): void =>
    assignCatalogDefinition(avatarCtx, slot, definition);
  const loadControllerFn = (id: string, opts?: { force?: boolean }): Promise<void> =>
    loadController(controllerCtx, id, opts);
  const previewControllerStateFn = (): Promise<void> => previewControllerState(controllerCtx);

  const documentCtx = createDocumentPersistenceContext(runtime, {
    hasUnsavedChanges, setStageStatus, setPackMissing, notifyUiChange,
    ensureAvatar: () => ensureAvatarPreview(avatarCtx),
    applyCharacterType: () => applyCharacterTypePreview(avatarCtx),
    loadController: loadControllerFn,
    getReadyPromise: () => readyPromise,
    setReadyPromise: (value) => { readyPromise = value; },
    disposeAvatarPreview: () => disposeAvatarPreview(avatarCtx),
  });

  async function loadDocument(): Promise<void> { return loadEquipmentDocument(documentCtx); }
  const revokeAnimationObjectUrl = (): void => {
    if (!animationObjectUrl) return;
    URL.revokeObjectURL(animationObjectUrl);
    animationObjectUrl = null;
  };
  const ensureReady = (): Promise<void> => {
    active = true;
    clock.start();
    resize();
    readyPromise ??= Promise.all([loadDocument(), refreshCatalog()]).then(() => undefined);
    return readyPromise;
  };
  const loadAnimationFromAsset = async (url: string): Promise<void> => {
    await ensureReady();
    await ensureAvatarPreview(avatarCtx);
    if (!closure.animation) throw new Error('Animation runtime unavailable.');
    closure.leftTab = 'controllers';
    setStageStatus(`Loading ${labelFromUrl(url)}…`);
    await closure.animation.loadAnimationSource(url, labelFromUrl(url));
    if (closure.avatar && closure.defaultDefinition) await applyCharacterTypePreview(avatarCtx);
    ensureSourceForUrl(controllerCtx, url);
    await ensureAnimatedPose();
    closure.animation.setAnimation(closure.animation.activeClipName || closure.animation.clipNames[0] || 'Idle_Loop', 0);
    closure.animation.setPlaying(true);
    closure.animation.update(0);
    setStageStatus(`Loaded ${labelFromUrl(url)} · ${closure.animation.clipNames.length} clip(s). Assign via Controllers.`);
    notifyUiChange();
  };
  async function reloadSidekickPack(): Promise<void> {
    await reloadSidekickPackPreview(documentCtx);
    await ensureReady();
  }
  async function save(): Promise<void> { return saveDocument(documentCtx); }
  const setGizmoMode = (mode: EquipmentGizmoMode): void => {
    if (closure.playTestActive) return;
    closure.gizmoMode = mode;
    gizmo.setMode(mode);
    notifyUiChange();
  };

  const { uiApi, syncClosureToUiState, syncUiStateToClosure } = createBaseCharacterUiBindings(closure, {
    gizmo, hasUnsavedChanges, markDirty, markControllerDirty, markSettingsDirty,
    markBackpackPrefabDirty, markWeaponPrefabDirty, save, loadDocument,
    setPreviewPose: (pose) => setPreviewPosePreview(avatarCtx, pose, (next) => { closure.previewPose = next; }),
    applyCharacterType: () => applyCharacterTypePreview(avatarCtx),
    previewControllerState: previewControllerStateFn,
    rebuildEquipmentPreview: () => rebuildEquipmentPreview(avatarCtx),
    refreshCatalog, assignDefinition, loadController: loadControllerFn, loadAnimationFromAsset,
    loadWeaponPrefabDraft: (prefabId) => loadWeaponPrefabDraft(avatarCtx, prefabId),
    ensureDrawnGripEntity,
    setPlayTestActive: (next) => playTestSession.setPlayTestActive(next),
    equipDefaultPlayTestLoadout: (overwrite) => equipDefaultPlayTestLoadout(
      { getAssignments: () => closure.assignments, getWeapons: () => closure.weapons, getBackpacks: () => closure.backpacks },
      overwrite,
    ),
    assignClipToState: (stateId, clipName) => assignClipToState(controllerCtx, stateId, clipName),
    ensureAnimatedPose, ensureAvatar: () => ensureAvatarPreview(avatarCtx),
    revokeAnimationObjectUrl, setStageStatus, syncGizmo, notifyUiChange,
  });
  // Closure is the imperative source of truth (loadController, avatar, etc.).
  // UI mutations push into closure first via uiApi.notifyUiChange, then land here.
  notifyUiChangeRef.current = (): void => {
    syncClosureToUiState();
    onUiChange();
  };
  window.addEventListener('keydown', playTestSession.onPlayTestKeyDown);
  canvas.addEventListener('pointerdown', () => { if (closure.playTestActive) canvas.focus(); });

  return {
    activate: () => { void ensureReady(); },
    deactivate: () => { active = false; if (closure.playTestActive) void playTestSession.setPlayTestActive(false); },
    canLeave: () => !hasUnsavedChanges() || window.confirm(
      'Leave Base Characters with unsaved character, controller, settings, backpack, or weapon grip changes?',
    ),
    isDirty: hasUnsavedChanges,
    setGizmoMode, save, loadAnimationFromAsset, reloadSidekickPack,
    getLeftPanel: () => leftHost, getRightPanel: () => rightHost, getUiApi: () => uiApi,
    dispose: () => {
      disposed = true;
      flyCamera.endFly();
      flyCamera.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', playTestSession.onPlayTestKeyDown);
      playTestSession.stopPlayTestControls();
      runtime.controllerSourceLoads.clear();
      gizmo.detach();
      controls.dispose();
      gizmo.dispose();
      closure.animation?.dispose();
      runtime.controllerUpperBodyAim.current?.dispose();
      revokeAnimationObjectUrl();
      closure.avatar?.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      stage.remove();
    },
  };
}
