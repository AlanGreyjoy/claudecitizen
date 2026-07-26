import {
  identityCharacterMount,
  type BaseCharacterType,
  type CharacterEquipmentSlotV1,
} from '../../player/equipment/base-character-equipment';
import {
  ANIMATION_LOCOMOTION_KINDS,
  UAL_ANIMATION_SOURCE_ID,
  locomotionStateSlug,
  parseAnimationController,
  type AnimationLocomotionKind,
} from '../../player/animation/schema';
import {
  cloneCharacterSettings,
  DEFAULT_CHARACTER_SETTINGS,
  setCharacterSettings,
} from '../../player/character-settings';
import { collectDrawnGrip } from '../../world/prefabs/item-runtime';
import {
  fetchAnimationControllerList,
  saveAnimationController,
} from '../../editor/api';
import { stanceIdForWeaponSlot } from '../../player/inventory/weapon-select';
import type { SidekickAvatarInstance } from '../characters/sidekick/assemble-avatar';
import type {
  BaseCharacterEditorUiApi,
  BaseCharacterLeftTab,
  BaseCharacterUiSnapshot,
  CharacterPreviewPose,
  EquipmentGizmoMode,
} from './base-character-equipment-ui';
import type { MountEditMode } from './base-character-equipment-transform';
import { DEFAULT_DRAWN_WEAPON_BONE } from '../../player/equipment/base-character-equipment';

const EQUIPMENT_DND_TYPE = 'application/x-claudecitizen-equipment-definition';

export interface BaseCharacterUiApiContext {
  getState: () => BaseCharacterUiApiContext['state'];
  state: {
    documentState: import('./base-character-equipment-ui').BaseCharacterUiSnapshot['documentState'];
    controllerState: BaseCharacterUiSnapshot['controllerState'];
    controllerList: BaseCharacterUiSnapshot['controllerList'];
    selectedControllerId: string;
    controllerDirty: boolean;
    settingsState: BaseCharacterUiSnapshot['settingsState'];
    settingsDirty: boolean;
    leftTab: BaseCharacterLeftTab;
    selectedType: BaseCharacterType;
    previewPose: CharacterPreviewPose;
    selectedStanceId: string;
    previewLocomotion: AnimationLocomotionKind;
    selectedSlotId: string;
    assignments: BaseCharacterUiSnapshot['assignments'];
    mountEditMode: MountEditMode;
    simulateDrawnSlotId: string | null;
    gizmoMode: EquipmentGizmoMode;
    gizmoSpace: 'local' | 'world';
    catalogMessage: string;
    weapons: BaseCharacterUiSnapshot['weapons'];
    backpacks: BaseCharacterUiSnapshot['backpacks'];
    playTestActive: boolean;
    playTestWeaponSlotId: BaseCharacterUiSnapshot['playTestWeaponSlotId'];
    animation: import('../characters/sidekick/animation-runtime').SidekickAnimationRuntime | null;
    lastLoadedSourceId: string;
    animationObjectUrl: string | null;
  };
  hasUnsavedChanges: () => boolean;
  notifyUiChange: () => void;
  markDirty: () => void;
  markControllerDirty: () => void;
  markSettingsDirty: () => void;
  markBackpackPrefabDirty: (prefabId: string) => void;
  markWeaponPrefabDirty: (prefabId: string) => void;
  currentSlot: () => CharacterEquipmentSlotV1 | null;
  currentMount: () => import('../../player/equipment/base-character-equipment').CharacterBoneMountV1 | null;
  currentDrawnMount: () => import('../../player/equipment/base-character-equipment').CharacterBoneMountV1 | null;
  currentTransformTarget: () => import('./base-character-equipment-transform').EquipmentTransformTarget | null;
  displayNumber: (value: number) => string;
  transformEulerDegrees: (
    transform: import('../../world/prefabs/schema').PrefabTransform,
  ) => { x: number; y: number; z: number };
  setTransformEulerDegrees: (
    transform: import('../../world/prefabs/schema').PrefabTransform,
    degrees: { x: number; y: number; z: number },
  ) => void;
  applyTransform: (
    object: import('three').Object3D,
    transform: import('../../world/prefabs/schema').PrefabTransform,
  ) => void;
  gizmo: { setSpace: (space: 'local' | 'world') => void };
  save: () => Promise<void>;
  loadDocument: () => Promise<void>;
  setPreviewPose: (pose: CharacterPreviewPose) => Promise<void>;
  applyCharacterType: () => Promise<void>;
  previewControllerState: () => Promise<void>;
  rebuildEquipmentPreview: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  assignDefinition: (slot: CharacterEquipmentSlotV1, definition: import('./base-character-equipment-ui').CatalogDefinition) => void;
  loadController: (id: string, opts?: { force?: boolean }) => Promise<void>;
  loadAnimationFromAsset: (url: string) => Promise<void>;
  loadWeaponPrefabDraft: (prefabId: string) => Promise<import('../../world/prefabs/schema').PrefabDocument | null>;
  ensureDrawnGripEntity: (doc: import('../../world/prefabs/schema').PrefabDocument) => unknown;
  setPlayTestActive: (active: boolean) => Promise<void>;
  equipDefaultPlayTestLoadout: (overwrite?: boolean) => boolean;
  assignClipToState: (stateId: string, clipName: string) => void;
  ensureAnimatedPose: () => Promise<void>;
  ensureAvatar: () => Promise<void>;
  revokeAnimationObjectUrl: () => void;
  setStageStatus: (message: string, error?: boolean) => void;
  syncGizmo: () => void;
  setGizmoModeInternal: (mode: EquipmentGizmoMode) => void;
  setDefaultAnimationController: (controller: NonNullable<BaseCharacterUiSnapshot['controllerState']>) => void;
  get avatar(): SidekickAvatarInstance | null;
  get defaultDefinition(): import('../../player/character_creator/sidekick-definition').SidekickCharacterDefinitionV2 | null;
}

export function createBaseCharacterEditorUiApi(ctx: BaseCharacterUiApiContext): BaseCharacterEditorUiApi {
  const markTransformDirty = (): void => {
    const target = ctx.currentTransformTarget();
    if (target?.source === 'backpack-socket' && target.prefabId) {
      ctx.markBackpackPrefabDirty(target.prefabId);
    } else if (target?.source === 'weapon-grip' && target.prefabId) {
      ctx.markWeaponPrefabDirty(target.prefabId);
    } else {
      ctx.markDirty();
    }
  };

  const enterDrawnAuthoring = (
    slot: CharacterEquipmentSlotV1,
    mode: 'drawn' | 'weapon-grip',
  ): void => {
    ctx.state.mountEditMode = mode;
    ctx.state.selectedStanceId = stanceIdForWeaponSlot(slot.id);
    ctx.state.simulateDrawnSlotId = slot.id;
    if (!ctx.currentDrawnMount() && ctx.state.documentState) {
      const variant = ctx.state.documentState.variants[String(ctx.state.selectedType) as '1' | '2'];
      variant.drawnMounts ??= {};
      variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
      ctx.markDirty();
    }
    const assignment = ctx.state.assignments.get(slot.id);
    if (mode === 'weapon-grip' && assignment?.prefabId) {
      void ctx.loadWeaponPrefabDraft(assignment.prefabId).then((draft) => {
        if (draft) {
          const hadGrip = Boolean(collectDrawnGrip(draft));
          ctx.ensureDrawnGripEntity(draft);
          if (!hadGrip) ctx.markWeaponPrefabDirty(draft.id);
        }
        void ctx.rebuildEquipmentPreview().then(() => void ctx.previewControllerState());
      });
      return;
    }
    void ctx.rebuildEquipmentPreview().then(() => void ctx.previewControllerState());
  };

  return {
    getSnapshot: (): BaseCharacterUiSnapshot => ({
      hasUnsavedChanges: ctx.hasUnsavedChanges(),
      playTestActive: ctx.state.playTestActive,
      leftTab: ctx.state.leftTab,
      selectedType: ctx.state.selectedType,
      previewPose: ctx.state.previewPose,
      selectedStanceId: ctx.state.selectedStanceId,
      previewLocomotion: ctx.state.previewLocomotion,
      controllerState: ctx.state.controllerState,
      controllerList: ctx.state.controllerList,
      selectedControllerId: ctx.state.selectedControllerId,
      controllerDirty: ctx.state.controllerDirty,
      animation: ctx.state.animation
        ? {
            activeClipName: ctx.state.animation.activeClipName,
            clipNames: ctx.state.animation.clipNames,
            clipPacks: ctx.state.animation.clipPacks,
            playing: ctx.state.animation.playing !== false,
            timeScale: ctx.state.animation.timeScale,
            sourceLabel: ctx.state.animation.sourceLabel,
            available: true,
          }
        : null,
      documentState: ctx.state.documentState,
      settingsState: ctx.state.settingsState,
      settingsDirty: ctx.state.settingsDirty,
      selectedSlotId: ctx.state.selectedSlotId,
      assignments: ctx.state.assignments,
      mountEditMode: ctx.state.mountEditMode,
      simulateDrawnSlotId: ctx.state.simulateDrawnSlotId,
      gizmoMode: ctx.state.gizmoMode,
      gizmoSpace: ctx.state.gizmoSpace,
      catalogMessage: ctx.state.catalogMessage,
      weapons: ctx.state.weapons,
      backpacks: ctx.state.backpacks,
      playTestWeaponSlotId: ctx.state.playTestWeaponSlotId,
      currentSlot: ctx.currentSlot(),
      currentMount: ctx.currentMount(),
      currentDrawnMount: ctx.currentDrawnMount(),
      currentTransformTarget: ctx.currentTransformTarget(),
      stanceIds:
        ctx.state.controllerState?.stances.map((stance) => stance.id)
        ?? ['unarmed', 'rifle', 'pistol'],
    }),
    save: () => ctx.save(),
    reload: () => void ctx.loadDocument(),
    setLeftTab: (tab) => {
      ctx.state.leftTab = tab;
      ctx.notifyUiChange();
    },
    setSelectedType: (type) => {
      ctx.state.selectedType = type;
      ctx.notifyUiChange();
      void ctx.applyCharacterType();
    },
    setPreviewPose: (pose) => ctx.setPreviewPose(pose),
    setSelectedStanceId: (stanceId) => {
      ctx.state.selectedStanceId = stanceId;
      ctx.notifyUiChange();
    },
    setPreviewLocomotion: (locomotion) => {
      ctx.state.previewLocomotion = locomotion;
      ctx.notifyUiChange();
    },
    previewControllerState: () => ctx.previewControllerState(),
    setSelectedSlotId: (slotId) => {
      const slot = ctx.state.documentState?.slots.find((entry) => entry.id === slotId);
      ctx.state.selectedSlotId = slotId;
      if (slot?.kind !== 'weapon') ctx.state.mountEditMode = 'holster';
      ctx.notifyUiChange();
      ctx.syncGizmo();
    },
    setMountEditMode: (mode) => {
      ctx.state.mountEditMode = mode;
      ctx.notifyUiChange();
    },
    setSimulateDrawnSlotId: (slotId) => {
      ctx.state.simulateDrawnSlotId = slotId;
      ctx.notifyUiChange();
    },
    setGizmoMode: (mode) => ctx.setGizmoModeInternal(mode),
    toggleGizmoSpace: () => {
      ctx.state.gizmoSpace = ctx.state.gizmoSpace === 'local' ? 'world' : 'local';
      ctx.gizmo.setSpace(ctx.state.gizmoSpace);
      ctx.notifyUiChange();
    },
    setPlayTestActive: (active) => ctx.setPlayTestActive(active),
    equipDefaultPlayTestLoadout: (overwrite) => ctx.equipDefaultPlayTestLoadout(overwrite),
    rebuildEquipmentPreview: () => ctx.rebuildEquipmentPreview(),
    markDirty: () => ctx.markDirty(),
    markControllerDirty: () => ctx.markControllerDirty(),
    markSettingsDirty: () => ctx.markSettingsDirty(),
    markBackpackPrefabDirty: (prefabId) => ctx.markBackpackPrefabDirty(prefabId),
    markWeaponPrefabDirty: (prefabId) => ctx.markWeaponPrefabDirty(prefabId),
    refreshCatalog: () => ctx.refreshCatalog(),
    assignDefinition: (slot, definition) => ctx.assignDefinition(slot, definition),
    clearAssignment: (slotId) => {
      ctx.state.assignments.delete(slotId);
      if (slotId === 'backpack') ctx.state.assignments.delete('rifle-secondary');
      void ctx.rebuildEquipmentPreview();
    },
    addEquipmentSlot: () => {
      if (!ctx.state.documentState) return;
      const id = window.prompt('New slot id (lowercase slug):')?.trim();
      if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
      if (ctx.state.documentState.slots.some((slot) => slot.id === id)) return;
      const kind = window.prompt('Slot kind: weapon or backpack?', 'weapon') === 'backpack'
        ? 'backpack'
        : 'weapon';
      const newSlot: CharacterEquipmentSlotV1 = kind === 'weapon'
        ? { id, label: id.replace(/-/g, ' '), kind, weaponSlotType: 'rifle' }
        : { id, label: id.replace(/-/g, ' '), kind };
      ctx.state.documentState.slots.push(newSlot);
      ctx.state.documentState.variants['1'].mounts[id] = identityCharacterMount('backAttach');
      ctx.state.documentState.variants['2'].mounts[id] = identityCharacterMount('backAttach');
      ctx.state.selectedSlotId = id;
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    deleteSlot: (slotId) => {
      if (!ctx.state.documentState || ctx.state.documentState.slots.length <= 1) return;
      const slot = ctx.state.documentState.slots.find((entry) => entry.id === slotId);
      if (!slot || !window.confirm(`Delete slot "${slot.label}" from both character types?`)) return;
      ctx.state.documentState.slots = ctx.state.documentState.slots.filter(
        (candidate) => candidate.id !== slotId,
      );
      delete ctx.state.documentState.variants['1'].mounts[slotId];
      delete ctx.state.documentState.variants['2'].mounts[slotId];
      delete ctx.state.documentState.variants['1'].drawnMounts?.[slotId];
      delete ctx.state.documentState.variants['2'].drawnMounts?.[slotId];
      for (const candidate of ctx.state.documentState.slots) {
        if (candidate.requiresSlotId === slotId) delete candidate.requiresSlotId;
        if (candidate.providerSocket?.slotId === slotId) delete candidate.providerSocket;
      }
      ctx.state.assignments.delete(slotId);
      if (ctx.state.simulateDrawnSlotId === slotId) ctx.state.simulateDrawnSlotId = null;
      ctx.state.mountEditMode = 'holster';
      ctx.state.selectedSlotId = ctx.state.documentState.slots[0]?.id ?? '';
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    updateSlot: () => {
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    enterDrawnAuthoring,
    addHandBoneMount: () => {
      if (!ctx.state.documentState) return;
      const slot = ctx.currentSlot();
      if (!slot) return;
      const variant = ctx.state.documentState.variants[String(ctx.state.selectedType) as '1' | '2'];
      variant.drawnMounts ??= {};
      variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    removeHandBoneMount: () => {
      if (!ctx.state.documentState) return;
      const slot = ctx.currentSlot();
      if (!slot) return;
      const variant = ctx.state.documentState.variants[String(ctx.state.selectedType) as '1' | '2'];
      if (variant.drawnMounts) {
        delete variant.drawnMounts[slot.id];
        if (Object.keys(variant.drawnMounts).length === 0) delete variant.drawnMounts;
      }
      if (ctx.state.simulateDrawnSlotId === slot.id) ctx.state.simulateDrawnSlotId = null;
      ctx.state.mountEditMode = 'holster';
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    updateTransformNumber: (targetKind, key, value) => {
      const transformTarget = ctx.currentTransformTarget();
      const number = Number(value);
      if (!Number.isFinite(number) || !transformTarget) return;
      transformTarget.transform[targetKind][key] = number;
      ctx.applyTransform(transformTarget.object, transformTarget.transform);
      markTransformDirty();
    },
    updateTransformRotation: (key, value) => {
      const transformTarget = ctx.currentTransformTarget();
      const number = Number(value);
      if (!Number.isFinite(number) || !transformTarget) return;
      const nextDegrees = ctx.transformEulerDegrees(transformTarget.transform);
      nextDegrees[key] = number;
      ctx.setTransformEulerDegrees(transformTarget.transform, nextDegrees);
      ctx.applyTransform(transformTarget.object, transformTarget.transform);
      markTransformDirty();
      ctx.notifyUiChange();
    },
    updateMountBone: (bone) => {
      const slot = ctx.currentSlot();
      const mount = ctx.currentMount();
      const editingMount =
        ctx.state.mountEditMode === 'drawn' && slot?.kind === 'weapon'
          ? ctx.currentDrawnMount()
          : ctx.state.mountEditMode === 'weapon-grip'
            ? null
            : mount;
      if (!editingMount) return;
      editingMount.bone = bone;
      ctx.markDirty();
      void ctx.rebuildEquipmentPreview();
    },
    loadController: (id) => ctx.loadController(id),
    saveController: async () => {
      if (!ctx.state.controllerState) return;
      try {
        const draft = structuredClone(ctx.state.controllerState);
        const blobSources = draft.sources.filter(
          (source) => source.url.startsWith('blob:') || source.url.startsWith('data:'),
        );
        if (blobSources.length > 0) {
          throw new Error(
            'Controller has clips from a local file picker (blob URL). Load those GLBs from Project → assets/…, reassign, then Save Ctrl.',
          );
        }
        const knownSourceIds = new Set(draft.sources.map((source) => source.id));
        const orphanStates = draft.states.filter(
          (state) =>
            state.clipName
            && state.sourceId === UAL_ANIMATION_SOURCE_ID
            && !knownSourceIds.has(UAL_ANIMATION_SOURCE_ID),
        );
        if (orphanStates.length > 0) {
          throw new Error(
            `${orphanStates.length} stance binding(s) still use legacy source "ual" with no project URL. Re-pick those clips from a loaded project pack, then Save Ctrl.`,
          );
        }
        const parsed = parseAnimationController(draft);
        const path = await saveAnimationController(parsed);
        ctx.state.controllerState = structuredClone(parsed);
        ctx.state.controllerDirty = false;
        ctx.state.controllerList = await fetchAnimationControllerList();
        if (parsed.id === 'default') ctx.setDefaultAnimationController(parsed);
        ctx.setStageStatus(`Saved ${path}`);
        ctx.notifyUiChange();
      } catch (error) {
        ctx.setStageStatus(
          error instanceof Error ? error.message : 'Controller save failed.',
          true,
        );
      }
    },
    addStance: () => {
      if (!ctx.state.controllerState) return;
      const id = window.prompt('New stance id (lowercase slug):')?.trim();
      if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
      if (ctx.state.controllerState.stances.some((stance) => stance.id === id)) return;
      const label = window.prompt('Stance label:', id.replace(/-/g, ' '))?.trim() || id;
      ctx.state.controllerState.stances.push({ id, label });
      for (const locomotion of ANIMATION_LOCOMOTION_KINDS) {
        ctx.state.controllerState.states.push({
          id: `${id}-${locomotionStateSlug(locomotion)}`,
          label: `${label} ${locomotion}`,
          locomotion,
          stanceId: id,
          clipName: '',
          sourceId: UAL_ANIMATION_SOURCE_ID,
        });
      }
      ctx.state.selectedStanceId = id;
      ctx.markControllerDirty();
    },
    renameStance: () => {
      if (!ctx.state.controllerState) return;
      const stance = ctx.state.controllerState.stances.find(
        (entry) => entry.id === ctx.state.selectedStanceId,
      );
      if (!stance) return;
      const next = window.prompt('Stance label:', stance.label)?.trim();
      if (!next) return;
      stance.label = next;
      ctx.markControllerDirty();
    },
    assignClipToState: (stateId, clipName) => ctx.assignClipToState(stateId, clipName),
    assignClipFromDroppedUrl: async (stateId, url) => {
      try {
        await ctx.loadAnimationFromAsset(url);
        const clip = ctx.state.animation?.activeClipName || ctx.state.animation?.clipNames[0] || '';
        if (clip) ctx.assignClipToState(stateId, clip);
        const state = ctx.state.controllerState?.states.find((entry) => entry.id === stateId);
        if (state) {
          ctx.state.selectedStanceId = state.stanceId;
          ctx.state.previewLocomotion = state.locomotion;
        }
        await ctx.previewControllerState();
      } catch (error) {
        ctx.setStageStatus(error instanceof Error ? error.message : 'Drop assign failed.', true);
      }
    },
    setAnimationClip: (clipName) => {
      void ctx.ensureAnimatedPose().then(() => {
        ctx.state.animation?.setAnimation(clipName, 0.12);
        ctx.state.animation?.setPlaying(true);
        ctx.setStageStatus(
          `Playing ${clipName}. Equipment follows animated attachment bones.`,
        );
        ctx.notifyUiChange();
      });
    },
    toggleAnimationPlaying: () => {
      void ctx.ensureAnimatedPose().then(() => {
        const next = !(ctx.state.animation?.playing ?? true);
        ctx.state.animation?.setPlaying(next);
        ctx.setStageStatus(
          next
            ? `Playing ${ctx.state.animation?.activeClipName ?? 'clip'}.`
            : 'Animation paused.',
        );
        ctx.notifyUiChange();
      });
    },
    loadUalLibrary: async () => {
      if (!ctx.state.animation) return;
      try {
        ctx.setStageStatus('Loading optional UAL pack from project…');
        await ctx.state.animation.loadDefaultLibrary();
        ctx.state.lastLoadedSourceId = UAL_ANIMATION_SOURCE_ID;
        await ctx.ensureAnimatedPose();
        ctx.setStageStatus(`UAL loaded · ${ctx.state.animation.clipNames.length} clip(s).`);
      } catch (error) {
        ctx.setStageStatus(
          error instanceof Error
            ? `UAL optional pack missing (${error.message}). Drag project GLBs onto Controllers instead.`
            : 'UAL optional pack missing. Drag project GLBs onto Controllers instead.',
          true,
        );
      }
      ctx.notifyUiChange();
    },
    loadAnimationGlbFile: async (file) => {
      if (!ctx.state.animation) return;
      try {
        ctx.setStageStatus(`Loading ${file.name}…`);
        ctx.revokeAnimationObjectUrl();
        ctx.state.animationObjectUrl = URL.createObjectURL(file);
        await ctx.state.animation.loadAnimationSource(ctx.state.animationObjectUrl, file.name);
        if (ctx.avatar && ctx.defaultDefinition) await ctx.applyCharacterType();
        await ctx.ensureAnimatedPose();
        ctx.state.animation.setAnimation(ctx.state.animation.activeClipName || 'Rifle_Idle', 0);
        ctx.state.animation.setPlaying(true);
        ctx.state.animation.update(0);
        ctx.setStageStatus(
          `Previewing ${file.name} · ${ctx.state.animation.clipNames.length} clip(s). For Save Ctrl, put the GLB under project assets/ and load via Project → Anims.`,
        );
      } catch (error) {
        ctx.setStageStatus(
          error instanceof Error ? error.message : 'Animation GLB load failed.',
          true,
        );
      }
      ctx.notifyUiChange();
    },
    setAnimationTimeScale: (value) => {
      ctx.state.animation?.setTimeScale(value);
    },
    resetSettingsDefaults: () => {
      ctx.state.settingsState = cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
      setCharacterSettings(ctx.state.settingsState);
      ctx.markSettingsDirty();
    },
    updateSettingsSpeed: (key, value) => {
      ctx.state.settingsState = { ...ctx.state.settingsState, [key]: value };
      setCharacterSettings(ctx.state.settingsState);
      ctx.markSettingsDirty();
    },
    displayNumber: (value) => ctx.displayNumber(value),
    getRotationDegrees: (transform) => ctx.transformEulerDegrees(transform),
    equipmentDndType: EQUIPMENT_DND_TYPE,
  };
}
