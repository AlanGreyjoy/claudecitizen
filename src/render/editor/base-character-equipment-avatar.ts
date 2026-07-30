import type * as THREE from 'three';
import {
  AdminAuthError,
  listBackpackDefinitions,
  listWeaponDefinitions,
  type BackpackDefinition,
  type WeaponDefinition,
} from '../../net/admin-api';
import {
  cloneBaseCharacterEquipment,
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
  type BaseCharacterType,
  type CharacterBoneMountV1,
  type CharacterEquipmentSlotV1,
} from '../../player/equipment/base-character-equipment';
import {
  cloneCharacterSettings,
  getCharacterSettings,
  parseCharacterSettings,
  setCharacterSettings,
  type CharacterSettingsV1,
} from '../../player/character-settings';
import { setDefaultAnimationController } from '../../player/animation/default-controller';
import {
  cloneAnimationController,
  parseAnimationController,
  type AnimationControllerV1,
} from '../../player/animation/schema';
import {
  fetchAnimationControllerList,
  fetchBaseCharacterEquipment,
  fetchCharacterSettings,
  saveAnimationController,
  saveBaseCharacterEquipment,
  saveCharacterSettings,
  savePrefab,
  type AnimationControllerListEntry,
} from '../../editor/api';
import { buildDefaultDefinition, findPreviewSpecies, invalidateSidekickCatalog, loadSidekickCatalog } from '../../player/character_creator/sidekick-catalog';
import type { SidekickCharacterDefinitionV2 } from '../../player/character_creator/sidekick-definition';
import { assembleSidekickCharacter, type SidekickAvatarInstance } from '../characters/sidekick/assemble-avatar';
import { createSidekickAnimationRuntime, type SidekickAnimationRuntime } from '../characters/sidekick/animation-runtime';
import {
  createSidekickUpperBodyAimController,
  type SidekickUpperBodyAimController,
} from '../characters/sidekick/upper-body-aim';
import { loadPrefabDocument } from '../../world/prefabs/loader';
import {
  collectDrawnGrip,
  identityDrawnGripTransform,
} from '../../world/prefabs/item-runtime';
import {
  parsePrefabDocument,
  type PrefabDocument,
  type PrefabEntity,
} from '../../world/prefabs/schema';
import {
  attachWeaponEquipmentPreviews,
  createEquipmentPreviewState,
  type EquipmentPreviewState,
  loadBackpackEquipmentPreview,
  reportDrawnAuthoringStatus,
  setupEquipmentDrawnPivots,
  setupEquipmentMountPivots,
} from './base-character-equipment-preview';
import { disposeOwnedGpuResources } from '../assets/gpu-dispose';
import { disposeNestedParticleSystems } from '../particles';
import type { CharacterPreviewPose } from './base-character-equipment-ui';
import type { CatalogDefinition } from './base-character-equipment-utils';
import type { MountEditMode } from './base-character-equipment-transform';
import {
  applyTransform,
  compatible,
  findEntityObject,
  findPrefabEntity,
  placeholder,
  restoreReferencePose,
} from './base-character-equipment-utils';
import { equipDefaultPlayTestLoadout } from './base-character-equipment-play-session';

export interface AvatarPreviewContext {
  previewRoot: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update: () => void };
  getDocumentState: () => BaseCharacterEquipmentV1 | null;
  setDocumentState: (value: BaseCharacterEquipmentV1 | null) => void;
  getSelectedType: () => BaseCharacterType;
  getPreviewPose: () => CharacterPreviewPose;
  getSelectedSlotId: () => string;
  getMountEditMode: () => MountEditMode;
  getSimulateDrawnSlotId: () => string | null;
  getPlayTestActive: () => boolean;
  getPlayTestWeaponSlotId: () => string | null;
  getAssignments: () => Map<string, CatalogDefinition>;
  getWeapons: () => WeaponDefinition[];
  getBackpacks: () => BackpackDefinition[];
  setWeapons: (value: WeaponDefinition[]) => void;
  setBackpacks: (value: BackpackDefinition[]) => void;
  setCatalogMessage: (value: string) => void;
  getAvatar: () => SidekickAvatarInstance | null;
  setAvatar: (value: SidekickAvatarInstance | null) => void;
  getAnimation: () => SidekickAnimationRuntime | null;
  setAnimation: (value: SidekickAnimationRuntime | null) => void;
  getControllerUpperBodyAim: () => SidekickUpperBodyAimController | null;
  setControllerUpperBodyAim: (value: SidekickUpperBodyAimController | null) => void;
  getDefaultDefinition: () => SidekickCharacterDefinitionV2 | null;
  setDefaultDefinition: (value: SidekickCharacterDefinitionV2 | null) => void;
  getMountPivots: () => Map<string, THREE.Group>;
  setMountPivots: (value: Map<string, THREE.Group>) => void;
  getDrawnPivots: () => Map<string, THREE.Group>;
  setDrawnPivots: (value: Map<string, THREE.Group>) => void;
  getWeaponPreviewRoots: () => Map<string, THREE.Object3D>;
  setWeaponPreviewRoots: (value: Map<string, THREE.Object3D>) => void;
  getWeaponGripEntities: () => Map<string, PrefabEntity>;
  setWeaponGripEntities: (value: Map<string, PrefabEntity>) => void;
  getActiveBackpackPrefabId: () => string | null;
  setActiveBackpackPrefabId: (value: string | null) => void;
  getBackpackSocketObjects: () => Map<string, THREE.Object3D>;
  setBackpackSocketObjects: (value: Map<string, THREE.Object3D>) => void;
  getBackpackSocketEntities: () => Map<string, PrefabEntity>;
  setBackpackSocketEntities: (value: Map<string, PrefabEntity>) => void;
  backpackPrefabDrafts: Map<string, PrefabDocument>;
  weaponPrefabDrafts: Map<string, PrefabDocument>;
  getPreviewGeneration: () => number;
  bumpPreviewGeneration: () => number;
  isDisposed: () => boolean;
  gizmo: { detach: () => void };
  setStageStatus: (message: string, error?: boolean) => void;
  setPackMissing: (missing: boolean, detail?: string) => void;
  notifyUiChange: () => void;
  syncGizmo: () => void;
  renderPlayTestHud: () => void;
}

function disposePreviewSubtrees(roots: Iterable<THREE.Object3D>): void {
  const uniqueRoots = [...new Set(roots)];
  const ownedRoots: THREE.Object3D[] = [];
  for (const root of uniqueRoots) {
    disposeNestedParticleSystems(root);
    root.traverse((object) => {
      if (object.userData.ownedGpu) ownedRoots.push(object);
    });
  }
  // A weapon can be nested under a backpack socket. Dispose the deepest owner
  // first so clearing the backpack never hides the weapon's owned allocations.
  for (let index = ownedRoots.length - 1; index >= 0; index -= 1) {
    disposeOwnedGpuResources(ownedRoots[index]);
  }
  for (const root of uniqueRoots) {
    root.removeFromParent();
    root.clear();
  }
}

function disposeEquipmentPreviewState(state: EquipmentPreviewState): void {
  disposePreviewSubtrees([
    ...state.mountPivots.values(),
    ...state.drawnPivots.values(),
  ]);
}

function clearEquipmentPreview(ctx: AvatarPreviewContext): void {
  disposePreviewSubtrees([
    ...ctx.getMountPivots().values(),
    ...ctx.getDrawnPivots().values(),
  ]);
  ctx.setMountPivots(new Map());
  ctx.setDrawnPivots(new Map());
  ctx.setWeaponPreviewRoots(new Map());
  ctx.setWeaponGripEntities(new Map());
  ctx.setActiveBackpackPrefabId(null);
  ctx.setBackpackSocketObjects(new Map());
  ctx.setBackpackSocketEntities(new Map());
}

export function disposeAvatarPreview(ctx: AvatarPreviewContext): void {
  ctx.bumpPreviewGeneration();
  clearEquipmentPreview(ctx);
  const avatar = ctx.getAvatar();
  for (const child of [...ctx.previewRoot.children]) {
    if (child !== avatar?.root) disposePreviewSubtrees([child]);
  }
  if (avatar) {
    ctx.previewRoot.remove(avatar.root);
    avatar.dispose();
    ctx.setAvatar(null);
  }
  ctx.getAnimation()?.dispose();
  ctx.setAnimation(null);
  ctx.getControllerUpperBodyAim()?.dispose();
  ctx.setControllerUpperBodyAim(null);
  ctx.setDefaultDefinition(null);
}

export function ensureDrawnGripEntity(doc: PrefabDocument): PrefabEntity {
  const existing = collectDrawnGrip(doc);
  if (existing) {
    const entity = findPrefabEntity(doc.root, existing.entityId);
    if (entity) return entity;
  }
  const entity: PrefabEntity = {
    id: `e-${crypto.randomUUID().slice(0, 8)}`,
    name: 'Drawn Grip',
    transform: identityDrawnGripTransform(),
    components: [{ type: 'drawn-grip' }],
  };
  doc.root.children = [...(doc.root.children ?? []), entity];
  return entity;
}

export async function loadBackpackPrefabDraft(
  ctx: AvatarPreviewContext,
  prefabId: string,
  isCurrent: () => boolean = () => true,
): Promise<PrefabDocument | null> {
  const existing = ctx.backpackPrefabDrafts.get(prefabId);
  if (existing) return existing;
  const loaded = await loadPrefabDocument(prefabId);
  if (!isCurrent() || !loaded) return null;
  const draft = structuredClone(loaded);
  ctx.backpackPrefabDrafts.set(prefabId, draft);
  return draft;
}

export async function loadWeaponPrefabDraft(
  ctx: AvatarPreviewContext,
  prefabId: string,
  isCurrent: () => boolean = () => true,
): Promise<PrefabDocument | null> {
  const existing = ctx.weaponPrefabDrafts.get(prefabId);
  if (existing) return existing;
  const loaded = await loadPrefabDocument(prefabId);
  if (!isCurrent() || !loaded) return null;
  const draft = structuredClone(loaded);
  ctx.weaponPrefabDrafts.set(prefabId, draft);
  return draft;
}

export async function rebuildEquipmentPreview(ctx: AvatarPreviewContext): Promise<void> {
  const documentState = ctx.getDocumentState();
  const avatar = ctx.getAvatar();
  if (!documentState || !avatar) return;
  const generation = ctx.bumpPreviewGeneration();
  ctx.gizmo.detach();
  clearEquipmentPreview(ctx);
  for (const child of [...ctx.previewRoot.children]) {
    if (child !== avatar.root) disposePreviewSubtrees([child]);
  }
  const previewState = createEquipmentPreviewState();
  ctx.setMountPivots(previewState.mountPivots);
  ctx.setDrawnPivots(previewState.drawnPivots);
  ctx.setWeaponPreviewRoots(previewState.weaponPreviewRoots);
  ctx.setWeaponGripEntities(previewState.weaponGripEntities);
  ctx.setActiveBackpackPrefabId(previewState.activeBackpackPrefabId);
  ctx.setBackpackSocketObjects(previewState.backpackSocketObjects);
  ctx.setBackpackSocketEntities(previewState.backpackSocketEntities);

  const isCurrent = (): boolean =>
    generation === ctx.getPreviewGeneration() && !ctx.isDisposed();
  const previewCtx = {
    documentState,
    selectedType: ctx.getSelectedType(),
    avatar,
    previewRoot: ctx.previewRoot,
    assignments: ctx.getAssignments(),
    playTestActive: ctx.getPlayTestActive(),
    playTestWeaponSlotId: ctx.getPlayTestWeaponSlotId(),
    simulateDrawnSlotId: ctx.getSimulateDrawnSlotId(),
    mountEditMode: ctx.getMountEditMode(),
    loadBackpackPrefabDraft: (prefabId: string) =>
      loadBackpackPrefabDraft(ctx, prefabId, isCurrent),
    loadWeaponPrefabDraft: (prefabId: string) =>
      loadWeaponPrefabDraft(ctx, prefabId, isCurrent),
    isCurrent,
    ensureDrawnGripEntity,
    applyTransform,
    setStageStatus: ctx.setStageStatus,
    findEntityObject,
    findPrefabEntity,
    placeholder,
  };
  setupEquipmentMountPivots(previewCtx, previewState);
  setupEquipmentDrawnPivots(previewCtx, previewState);
  const { backpackRoot, backpackSockets } = await loadBackpackEquipmentPreview(
    previewCtx,
    previewState,
  );
  if (!isCurrent()) {
    disposeEquipmentPreviewState(previewState);
    return;
  }
  const stale = await attachWeaponEquipmentPreviews(
    previewCtx,
    previewState,
    backpackRoot,
    backpackSockets,
  );
  if (stale || !isCurrent()) {
    disposeEquipmentPreviewState(previewState);
    return;
  }
  reportDrawnAuthoringStatus(previewCtx);
  if (ctx.getPlayTestActive()) ctx.gizmo.detach();
  else ctx.syncGizmo();
  ctx.renderPlayTestHud();
  ctx.notifyUiChange();
  ctx.notifyUiChange();
}

export async function applyCharacterType(ctx: AvatarPreviewContext): Promise<void> {
  const avatar = ctx.getAvatar();
  const defaultDefinition = ctx.getDefaultDefinition();
  if (!avatar || !defaultDefinition) return;
  const definition = structuredClone(defaultDefinition);
  const selectedType = ctx.getSelectedType();
  definition.name = `Base Character Type ${selectedType}`;
  definition.blendShapes.bodyTypeValue = selectedType === 1 ? -100 : 100;
  definition.blendShapes.bodySizeValue = 0;
  definition.blendShapes.muscleValue = -100;
  if (ctx.getPreviewPose() === 'reference') restoreReferencePose(avatar.root);
  await avatar.applyDefinition(definition);
  if (ctx.isDisposed()) return;
  await rebuildEquipmentPreview(ctx);
}

export async function ensureAvatar(ctx: AvatarPreviewContext): Promise<void> {
  if (ctx.getAvatar() || ctx.isDisposed()) return;
  ctx.setStageStatus('Loading default Synty character…');
  try {
    const catalog = await loadSidekickCatalog();
    if (ctx.isDisposed()) return;
    const species = findPreviewSpecies(catalog);
    if (!species) throw new Error('No playable Synty species is available.');
    const defaultDefinition = buildDefaultDefinition(catalog, species);
    defaultDefinition.blendShapes.bodyTypeValue = -100;
    defaultDefinition.blendShapes.bodySizeValue = 0;
    defaultDefinition.blendShapes.muscleValue = -100;
    ctx.setDefaultDefinition(defaultDefinition);
    const avatar = await assembleSidekickCharacter(catalog, defaultDefinition);
    if (ctx.isDisposed()) {
      avatar.dispose();
      return;
    }
    const animation = await createSidekickAnimationRuntime(avatar.root);
    if (ctx.isDisposed()) {
      animation.dispose();
      avatar.dispose();
      return;
    }
    ctx.previewRoot.add(avatar.root);
    ctx.setAvatar(avatar);
    ctx.setAnimation(animation);
    ctx.setControllerUpperBodyAim(createSidekickUpperBodyAimController(ctx.previewRoot, avatar.root));
    // No bundled idle — clips load from project when Controllers / Preview / Play Test asks.
    if (animation.clipNames[0]) {
      animation.setAnimation(animation.clipNames[0], 0);
    }
    ctx.controls.target.set(0, 0.95, 0);
    ctx.camera.position.set(0, 1.05, 4.2);
    ctx.controls.update();
    ctx.setPackMissing(false);
    ctx.setStageStatus('Synty Sidekick ready. Assign project animation GLBs on Controllers.');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Sidekick pack load failed.';
    ctx.setPackMissing(
      true,
      `Sidekick pack missing or invalid (${detail}). Use Tools → Locate Synty Sidekick Pack…`,
    );
    throw error;
  }
}

export async function setPreviewPose(
  ctx: AvatarPreviewContext,
  nextPose: CharacterPreviewPose,
  setPreviewPoseState: (pose: CharacterPreviewPose) => void,
): Promise<void> {
  if (ctx.getPreviewPose() === nextPose) return;
  setPreviewPoseState(nextPose);
  ctx.notifyUiChange();
  const avatar = ctx.getAvatar();
  if (!avatar) return;
  if (nextPose === 'reference') {
    ctx.getControllerUpperBodyAim()?.restore();
    ctx.getAnimation()?.setPlaying(false);
    ctx.setStageStatus('Reference pose active. Character mounts now use a stable bind-pose basis.');
    await applyCharacterType(ctx);
    return;
  }
  const animation = ctx.getAnimation();
  animation?.setPlaying(true);
  const clip = animation?.activeClipName || animation?.clipNames[0] || 'Idle_Loop';
  animation?.setAnimation(clip, 0);
  animation?.update(0);
  ctx.setStageStatus(
    `Animation preview · ${clip}. Equipment follows animated attachment bones.`,
  );
}

export async function refreshCatalog(ctx: AvatarPreviewContext): Promise<void> {
  ctx.setCatalogMessage('Refreshing Admin catalog…');
  ctx.notifyUiChange();
  try {
    const [weapons, backpacks] = await Promise.all([listWeaponDefinitions(), listBackpackDefinitions()]);
    ctx.setWeapons(weapons);
    ctx.setBackpacks(backpacks);
    ctx.setCatalogMessage(`${weapons.length} weapons · ${backpacks.length} backpacks`);
    if (equipDefaultPlayTestLoadout(ctx)) void rebuildEquipmentPreview(ctx);
  } catch (error) {
    ctx.setCatalogMessage(error instanceof AdminAuthError
      ? 'Admin authentication is required. Sign in through the Admin portal, then refresh.'
      : error instanceof Error ? error.message : 'Catalog refresh failed.');
  }
  ctx.notifyUiChange();
}

export function assignDefinition(
  ctx: AvatarPreviewContext,
  slot: CharacterEquipmentSlotV1,
  definition: CatalogDefinition,
): void {
  if (!compatible(slot, definition)) return;
  if (slot.requiresSlotId && !ctx.getAssignments().has(slot.requiresSlotId)) return;
  ctx.getAssignments().set(slot.id, definition);
  void rebuildEquipmentPreview(ctx);
}

export interface DocumentPersistenceContext {
  getDocumentState: () => BaseCharacterEquipmentV1 | null;
  setDocumentState: (value: BaseCharacterEquipmentV1 | null) => void;
  getControllerState: () => AnimationControllerV1 | null;
  setControllerState: (value: AnimationControllerV1 | null) => void;
  getControllerList: () => AnimationControllerListEntry[];
  setControllerList: (value: AnimationControllerListEntry[]) => void;
  getSelectedControllerId: () => string;
  setSelectedControllerId: (value: string) => void;
  getSelectedSlotId: () => string;
  setSelectedSlotId: (value: string) => void;
  getMountEditMode: () => MountEditMode;
  setMountEditMode: (value: MountEditMode) => void;
  getSimulateDrawnSlotId: () => string | null;
  setSimulateDrawnSlotId: (value: string | null) => void;
  getAssignments: () => Map<string, CatalogDefinition>;
  setAssignments: (value: Map<string, CatalogDefinition>) => void;
  getWeapons: () => WeaponDefinition[];
  getBackpacks: () => BackpackDefinition[];
  getSettingsState: () => CharacterSettingsV1;
  setSettingsState: (value: CharacterSettingsV1) => void;
  getDirty: () => boolean;
  setDirty: (value: boolean) => void;
  getControllerDirty: () => boolean;
  setControllerDirty: (value: boolean) => void;
  getSettingsDirty: () => boolean;
  setSettingsDirty: (value: boolean) => void;
  dirtyBackpackPrefabIds: Set<string>;
  dirtyWeaponPrefabIds: Set<string>;
  backpackPrefabDrafts: Map<string, PrefabDocument>;
  weaponPrefabDrafts: Map<string, PrefabDocument>;
  hasUnsavedChanges: () => boolean;
  setStageStatus: (message: string, error?: boolean) => void;
  setPackMissing: (missing: boolean, detail?: string) => void;
  notifyUiChange: () => void;
  ensureAvatar: () => Promise<void>;
  applyCharacterType: () => Promise<void>;
  loadController: (id: string, opts?: { force?: boolean }) => Promise<void>;
  getReadyPromise: () => Promise<void> | null;
  setReadyPromise: (value: Promise<void> | null) => void;
  disposeAvatarPreview: () => void;
}

export async function loadDocument(ctx: DocumentPersistenceContext): Promise<void> {
  if (hasUnsavedChangesConfirm(ctx)) return;
  ctx.setStageStatus('Loading Base Character equipment…');
  try {
    const documentState = cloneBaseCharacterEquipment(await fetchBaseCharacterEquipment());
    ctx.setDocumentState(documentState);
    ctx.setSelectedSlotId(documentState.slots[0]?.id ?? '');
    ctx.setMountEditMode('holster');
    ctx.setSimulateDrawnSlotId(null);
    ctx.setAssignments(new Map());
    equipDefaultPlayTestLoadout(ctx);
    ctx.setDirty(false);
    ctx.dirtyBackpackPrefabIds.clear();
    ctx.dirtyWeaponPrefabIds.clear();
    ctx.backpackPrefabDrafts.clear();
    ctx.weaponPrefabDrafts.clear();
    try {
      ctx.setSettingsState(await fetchCharacterSettings());
    } catch {
      ctx.setSettingsState(cloneCharacterSettings(getCharacterSettings()));
    }
    setCharacterSettings(ctx.getSettingsState());
    ctx.setSettingsDirty(false);
    await ctx.ensureAvatar();
    await ctx.applyCharacterType();
    await ctx.loadController(ctx.getSelectedControllerId(), { force: true });
    ctx.notifyUiChange();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Base Character load failed.';
    if (/sidekick|manifest/i.test(message)) {
      ctx.setPackMissing(
        true,
        `Sidekick pack missing or invalid (${message}). Use Tools → Locate Synty Sidekick Pack…`,
      );
    } else {
      ctx.setStageStatus(message, true);
    }
  }
}

function hasUnsavedChangesConfirm(ctx: DocumentPersistenceContext): boolean {
  return ctx.hasUnsavedChanges()
    && !window.confirm('Discard unsaved Base Character, controller, settings, backpack socket, or weapon grip changes?');
}

export async function reloadSidekickPack(ctx: DocumentPersistenceContext): Promise<void> {
  invalidateSidekickCatalog();
  ctx.disposeAvatarPreview();
  ctx.setReadyPromise(null);
  ctx.setPackMissing(false);
  ctx.setStageStatus('Reloading Sidekick pack…');
}

export async function persistSettings(
  ctx: DocumentPersistenceContext,
  savedPaths: string[],
): Promise<void> {
  if (!ctx.getSettingsDirty()) return;
  const parsed = parseCharacterSettings(ctx.getSettingsState());
  savedPaths.push(await saveCharacterSettings(parsed));
  ctx.setSettingsState(cloneCharacterSettings(parsed));
  setCharacterSettings(ctx.getSettingsState());
  ctx.setSettingsDirty(false);
}

export async function saveDocument(ctx: DocumentPersistenceContext): Promise<void> {
  const documentState = ctx.getDocumentState();
  const controllerState = ctx.getControllerState();
  if (!documentState && !controllerState) return;
  try {
    const savedPaths: string[] = [];
    if (ctx.getDirty() && documentState) {
      const parsed = parseBaseCharacterEquipment(documentState);
      const path = await saveBaseCharacterEquipment(parsed);
      ctx.setDocumentState(cloneBaseCharacterEquipment(parsed));
      ctx.setDirty(false);
      savedPaths.push(path);
    }
    if (ctx.getControllerDirty() && controllerState) {
      const parsed = parseAnimationController(controllerState);
      const path = await saveAnimationController(parsed);
      ctx.setControllerState(cloneAnimationController(parsed));
      ctx.setControllerDirty(false);
      ctx.setControllerList(await fetchAnimationControllerList());
      if (ctx.getControllerState()?.id === 'default') {
        setDefaultAnimationController(ctx.getControllerState()!);
      }
      savedPaths.push(path);
    }
    await persistSettings(ctx, savedPaths);
    for (const prefabId of [...ctx.dirtyBackpackPrefabIds]) {
      const draft = ctx.backpackPrefabDrafts.get(prefabId);
      if (!draft) continue;
      const parsed = parsePrefabDocument(draft);
      const path = await savePrefab(parsed);
      ctx.backpackPrefabDrafts.set(prefabId, parsed);
      ctx.dirtyBackpackPrefabIds.delete(prefabId);
      savedPaths.push(path);
    }
    for (const prefabId of [...ctx.dirtyWeaponPrefabIds]) {
      const draft = ctx.weaponPrefabDrafts.get(prefabId);
      if (!draft) continue;
      const parsed = parsePrefabDocument(draft);
      const path = await savePrefab(parsed);
      ctx.weaponPrefabDrafts.set(prefabId, parsed);
      ctx.dirtyWeaponPrefabIds.delete(prefabId);
      savedPaths.push(path);
    }
    ctx.setStageStatus(savedPaths.length > 0 ? `Saved ${savedPaths.join(', ')}` : 'No changes to save.');
    ctx.notifyUiChange();
  } catch (error) {
    ctx.setStageStatus(error instanceof Error ? error.message : 'Base Character save failed.', true);
  }
}

export function currentSlot(
  documentState: BaseCharacterEquipmentV1 | null,
  selectedSlotId: string,
): CharacterEquipmentSlotV1 | null {
  return documentState?.slots.find((slot) => slot.id === selectedSlotId) ?? null;
}

export function currentVariant(
  documentState: BaseCharacterEquipmentV1 | null,
  selectedType: BaseCharacterType,
) {
  return documentState?.variants[String(selectedType) as '1' | '2'] ?? null;
}

export function currentMount(
  documentState: BaseCharacterEquipmentV1 | null,
  selectedType: BaseCharacterType,
  selectedSlotId: string,
): CharacterBoneMountV1 | null {
  return currentVariant(documentState, selectedType)?.mounts[selectedSlotId] ?? null;
}

export function currentDrawnMount(
  documentState: BaseCharacterEquipmentV1 | null,
  selectedType: BaseCharacterType,
  selectedSlotId: string,
): CharacterBoneMountV1 | null {
  return currentVariant(documentState, selectedType)?.drawnMounts?.[selectedSlotId] ?? null;
}
