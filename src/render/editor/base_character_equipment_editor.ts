import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  AdminAuthError,
  listBackpackDefinitions,
  listWeaponDefinitions,
  type BackpackDefinition,
  type WeaponDefinition,
} from '../../net/admin_api';
import {
  DEFAULT_DRAWN_WEAPON_BONE,
  cloneBaseCharacterEquipment,
  identityCharacterMount,
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
  type BaseCharacterType,
  type CharacterBoneMountV1,
  type CharacterEquipmentSlotV1,
} from '../../player/equipment/base_character_equipment';
import {
  ANIMATION_LOCOMOTION_KINDS,
  UAL_ANIMATION_SOURCE_ID,
  buildDefaultAnimationController,
  cloneAnimationController,
  locomotionStateSlug,
  parseAnimationController,
  resolveControllerClip,
  resolveControllerState,
  type AnimationControllerV1,
  type AnimationLocomotionKind,
} from '../../player/animation/schema';
import {
  locomotionFromGameplay,
} from '../../player/animation/default_controller';
import {
  advanceJumpAnimationPhase,
} from '../../player/character_controller';
import {
  cloneCharacterSettings,
  DEFAULT_CHARACTER_SETTINGS,
  getCharacterSettings,
  parseCharacterSettings,
  setCharacterSettings,
  type CharacterSettingsV1,
} from '../../player/character_settings';
import { buildDefaultDefinition, findPreviewSpecies, loadSidekickCatalog } from '../../player/character_creator/sidekick_catalog';
import type { SidekickCharacterDefinitionV2 } from '../../player/character_creator/sidekick_definition';
import {
  ASSET_DND_TYPE,
  fetchAnimationController,
  fetchAnimationControllerList,
  fetchBaseCharacterEquipment,
  fetchCharacterSettings,
  saveAnimationController,
  saveBaseCharacterEquipment,
  saveCharacterSettings,
  savePrefab,
  type AnimationControllerListEntry,
} from '../../editor/api';
import { assembleSidekickCharacter, type SidekickAvatarInstance } from '../characters/sidekick/assemble_avatar';
import { createSidekickAnimationRuntime, type SidekickAnimationRuntime } from '../characters/sidekick/animation_runtime';
import { createPropInstanceGroup } from '../prefabs/prefab_renderer';
import { loadPrefabDocument } from '../../world/prefabs/loader';
import {
  collectDrawnGrip,
  collectEquipmentSockets,
  identityDrawnGripTransform,
  validateBackpackPrefab,
} from '../../world/prefabs/item_runtime';
import {
  parsePrefabDocument,
  type PrefabDocument,
  type PrefabEntity,
  type PrefabTransform,
} from '../../world/prefabs/schema';
import type { WeaponSlotType } from '../../types/equipment';
import type { JumpPhase } from '../../types/character';
import {
  WEAPON_SELECT_SLOT_IDS,
  stanceIdForWeaponSlot,
  type WeaponSelectSlotId,
} from '../../player/inventory/weapon_select';

const ATTACHMENT_BONES = [
  'backAttach',
  'hipAttach_l',
  'hipAttach_r',
  'hipAttachFront',
  'hipAttachBack',
  'hand_l',
  'hand_r',
  'prop_l',
  'prop_r',
];
const EQUIPMENT_DND_TYPE = 'application/x-claudecitizen-equipment-definition';

type CatalogDefinition = WeaponDefinition | BackpackDefinition;
type CharacterPreviewPose = 'reference' | 'animated';
type EquipmentGizmoMode = 'translate' | 'rotate' | 'scale';
type BaseCharacterLeftTab = 'equipment' | 'animation' | 'controllers' | 'settings';
/** holster = resting; drawn = character hand bone; weapon-grip = per-weapon prefab pose */
type MountEditMode = 'holster' | 'drawn' | 'weapon-grip';

interface PlayTestDefaultAssignment {
  slotId: 'backpack' | WeaponSelectSlotId;
  definition: CatalogDefinition;
}

const PLAY_TEST_DEFAULT_ASSIGNMENTS: readonly PlayTestDefaultAssignment[] = [
  {
    slotId: 'backpack',
    definition: {
      id: 'demo-backpack',
      name: 'Demo Backpack',
      description: 'Base Character play-test backpack.',
      itemType: 'backpack',
      subType: 'field',
      prefabId: 'demo-backpack',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      capacityLiters: 48,
      emptyMassKg: 2.5,
    },
  },
  {
    slotId: 'rifle-primary',
    definition: {
      id: 'assault-01',
      name: 'Assault 01',
      description: 'Base Character primary-rifle play-test weapon.',
      itemType: 'weapon',
      subType: 'rifle',
      prefabId: 'assault-01',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'rifle',
    },
  },
  {
    slotId: 'rifle-secondary',
    definition: {
      id: 'brown-50',
      name: 'Brown 50',
      description: 'Base Character secondary-rifle play-test weapon.',
      itemType: 'weapon',
      subType: 'rifle',
      prefabId: 'brown-50',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'rifle',
    },
  },
  {
    slotId: 'handgun',
    definition: {
      id: 'twin-horned-pistol',
      name: 'Twin Horned Pistol',
      description: 'Base Character handgun play-test weapon.',
      itemType: 'weapon',
      subType: 'handgun',
      prefabId: 'twin-horned-pistol',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'handgun',
    },
  },
] as const;

const PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED = 9.81;
const PLAY_TEST_FALL_GRAVITY_MULTIPLIER = 1.7;
const PLAY_TEST_STAGE_RADIUS_METERS = 9;

export interface BaseCharacterEquipmentEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  setGizmoMode: (mode: EquipmentGizmoMode) => void;
  save: () => Promise<void>;
  /** Load a Project / protected animation GLB into the Sidekick preview runtime. */
  loadAnimationFromAsset: (url: string) => Promise<void>;
  dispose: () => void;
}

const LOCOMOTION_LABELS: Record<AnimationLocomotionKind, string> = {
  idle: 'Idle',
  walk: 'Walk',
  sprint: 'Sprint',
  jump_start: 'Jump Start',
  jump_loop: 'Jump Loop',
  jump_land: 'Jump Land',
};

const BUILTIN_UAL_CLIPS = new Set([
  'Idle_Loop',
  'Walk_Loop',
  'Sprint_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
]);

function slugFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  const base = fileName.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '') || 'source';
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'source';
}

function labelFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  return fileName.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '') || url;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'ed-btn';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function input(
  value: string,
  onChange: (value: string) => void,
  type = 'text',
  step?: number,
): HTMLInputElement {
  const node = document.createElement('input');
  node.className = 'ed-input';
  node.type = type;
  if (step !== undefined) node.step = String(step);
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'ed-base-field';
  const text = document.createElement('span');
  text.textContent = label;
  node.append(text, control);
  return node;
}

function select(
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = document.createElement('select');
  node.className = 'ed-select';
  for (const option of options) {
    const child = document.createElement('option');
    child.value = option.value;
    child.textContent = option.label;
    child.selected = option.value === value;
    node.append(child);
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function applyTransform(object: THREE.Object3D, transform: PrefabTransform): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.quaternion
    .set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w)
    .normalize();
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function copyObjectToTransform(object: THREE.Object3D, transform: PrefabTransform): void {
  object.quaternion.normalize();
  transform.position = { x: object.position.x, y: object.position.y, z: object.position.z };
  transform.rotation = {
    x: object.quaternion.x,
    y: object.quaternion.y,
    z: object.quaternion.z,
    w: object.quaternion.w,
  };
  transform.scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
}

function transformEulerDegrees(transform: PrefabTransform): { x: number; y: number; z: number } {
  const quaternion = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  ).normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

function setTransformEulerDegrees(
  transform: PrefabTransform,
  degrees: { x: number; y: number; z: number },
): void {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(degrees.x),
    THREE.MathUtils.degToRad(degrees.y),
    THREE.MathUtils.degToRad(degrees.z),
    'XYZ',
  ));
  transform.rotation = {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function findPrefabEntity(root: PrefabEntity, entityId: string): PrefabEntity | null {
  if (root.id === entityId) return root;
  for (const child of root.children ?? []) {
    const match = findPrefabEntity(child, entityId);
    if (match) return match;
  }
  return null;
}

function displayNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function findEntityObject(root: THREE.Object3D, entityId: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.userData.entityId === entityId) match = object;
  });
  return match;
}

function placeholder(color: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.32, 0.12),
    new THREE.MeshBasicMaterial({ color, wireframe: true }),
  );
  group.add(mesh);
  return group;
}

function restoreReferencePose(root: THREE.Object3D): void {
  const posedSkeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || posedSkeletons.has(object.skeleton)) return;
    object.skeleton.pose();
    posedSkeletons.add(object.skeleton);
  });
  root.updateMatrixWorld(true);
}

function compatible(slot: CharacterEquipmentSlotV1, definition: CatalogDefinition): boolean {
  if (slot.kind === 'backpack') return 'capacityLiters' in definition;
  return 'weaponSlotType' in definition && definition.weaponSlotType === slot.weaponSlotType;
}

export function createBaseCharacterEquipmentEditor(
  container: HTMLElement,
): BaseCharacterEquipmentEditor {
  container.classList.add('ed-base-character-editor');
  const left = document.createElement('aside');
  left.className = 'ed-base-sidebar';
  const stage = document.createElement('div');
  stage.className = 'ed-base-stage';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Base Character preview stage');
  const playTestHud = document.createElement('div');
  playTestHud.className = 'ed-base-playtest-hud';
  playTestHud.hidden = true;
  const playTestHudTitle = document.createElement('div');
  playTestHudTitle.className = 'ed-base-playtest-title';
  playTestHudTitle.textContent = 'Character Play Test';
  const playTestHudState = document.createElement('div');
  playTestHudState.className = 'ed-base-playtest-state';
  const playTestHudLoadout = document.createElement('div');
  playTestHudLoadout.className = 'ed-base-playtest-loadout';
  const playTestHudHelp = document.createElement('div');
  playTestHudHelp.className = 'ed-base-playtest-help';
  playTestHudHelp.textContent = 'WASD move · Shift sprint · Space jump · drag to orbit · Esc stop';
  playTestHud.append(
    playTestHudTitle,
    playTestHudState,
    playTestHudLoadout,
    playTestHudHelp,
  );
  const stageStatus = document.createElement('div');
  stageStatus.className = 'ed-base-stage-status';
  stage.append(canvas, playTestHud, stageStatus);
  const right = document.createElement('aside');
  right.className = 'ed-base-sidebar ed-base-inspector';
  container.append(left, stage, right);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08101d);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x263047, 1.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(2.5, 4.5, 2);
  scene.add(light);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(12, 96),
    new THREE.MeshStandardMaterial({ color: 0x17243a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(20, 20, 0x43749a, 0x233b58);
  grid.position.y = 0.003;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(0, 1.05, 4.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);
  controls.enablePan = false;
  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSpace('local');
  gizmo.setTranslationSnap(0.01);
  gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
  gizmo.setScaleSnap(0.05);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value;
  });

  let documentState: BaseCharacterEquipmentV1 | null = null;
  let controllerState: AnimationControllerV1 | null = null;
  let controllerList: AnimationControllerListEntry[] = [];
  let selectedControllerId = 'default';
  let selectedStanceId = 'unarmed';
  let previewLocomotion: AnimationLocomotionKind = 'idle';
  let lastLoadedSourceId = UAL_ANIMATION_SOURCE_ID;
  let controllerDirty = false;
  let settingsState: CharacterSettingsV1 = cloneCharacterSettings(getCharacterSettings());
  let settingsDirty = false;
  let leftTab: BaseCharacterLeftTab = 'equipment';
  let selectedType: BaseCharacterType = 1;
  let previewPose: CharacterPreviewPose = 'reference';
  let gizmoMode: EquipmentGizmoMode = 'translate';
  let gizmoSpace: 'local' | 'world' = 'local';
  let selectedSlotId = 'backpack';
  let mountEditMode: MountEditMode = 'holster';
  /** When set, that weapon slot's preview mesh parents to its drawn mount. */
  let simulateDrawnSlotId: string | null = null;
  let playTestActive = false;
  let playTestWeaponSlotId: WeaponSelectSlotId | null = null;
  let playTestJumpPhase: JumpPhase = 'grounded';
  let playTestJumpPhaseTime = 0;
  let playTestVerticalSpeed = 0;
  let playTestAnimationKey = '';
  let playTestAnimationGeneration = 0;
  let playTestPoseBefore: CharacterPreviewPose = 'reference';
  let playTestStanceBefore = 'unarmed';
  let playTestLocomotionBefore: AnimationLocomotionKind = 'idle';
  let playTestClipBefore = 'Idle_Loop';
  let dirty = false;
  let active = false;
  let disposed = false;
  let initialized = false;
  let avatar: SidekickAvatarInstance | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let animationObjectUrl: string | null = null;
  let defaultDefinition: SidekickCharacterDefinitionV2 | null = null;
  let mountPivots = new Map<string, THREE.Group>();
  let drawnPivots = new Map<string, THREE.Group>();
  let weaponPreviewRoots = new Map<string, THREE.Object3D>();
  let weaponGripEntities = new Map<string, PrefabEntity>();
  let activeBackpackPrefabId: string | null = null;
  let backpackSocketObjects = new Map<string, THREE.Object3D>();
  let backpackSocketEntities = new Map<string, PrefabEntity>();
  const backpackPrefabDrafts = new Map<string, PrefabDocument>();
  const weaponPrefabDrafts = new Map<string, PrefabDocument>();
  const dirtyBackpackPrefabIds = new Set<string>();
  const dirtyWeaponPrefabIds = new Set<string>();
  const previewRoot = new THREE.Group();
  let assignments = new Map<string, CatalogDefinition>();
  let weapons: WeaponDefinition[] = [];
  let backpacks: BackpackDefinition[] = [];
  let previewGeneration = 0;
  let catalogMessage = 'Catalog not loaded.';
  const playTestKeys = new Set<string>();
  const playTestWeaponButtons = new Map<WeaponSelectSlotId, HTMLButtonElement>();
  const playTestCameraPositionBefore = new THREE.Vector3();
  const playTestCameraTargetBefore = new THREE.Vector3();
  const playTestPreviousPosition = new THREE.Vector3();
  const playTestCameraForward = new THREE.Vector3();
  const playTestCameraRight = new THREE.Vector3();
  const playTestMoveDirection = new THREE.Vector3();
  const playTestCameraDelta = new THREE.Vector3();
  const controllerSourceLoads = new Map<string, Promise<void>>();
  scene.add(previewRoot);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const clock = new THREE.Clock();
  const renderFrame = (): void => {
    if (disposed) return;
    requestAnimationFrame(renderFrame);
    if (!active) return;
    resize();
    const deltaSeconds = Math.min(clock.getDelta(), 0.05);
    if (playTestActive) updatePlayTest(deltaSeconds);
    controls.update();
    if (previewPose === 'animated') animation?.update(deltaSeconds);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(renderFrame);

  const setStageStatus = (message: string, error = false): void => {
    stageStatus.textContent = message;
    stageStatus.classList.toggle('is-error', error);
  };

  const markDirty = (): void => {
    dirty = true;
    renderLeft();
  };

  const markControllerDirty = (): void => {
    controllerDirty = true;
    renderLeft();
  };

  const markSettingsDirty = (): void => {
    settingsDirty = true;
    renderLeft();
  };

  const markBackpackPrefabDirty = (prefabId: string): void => {
    dirtyBackpackPrefabIds.add(prefabId);
    renderLeft();
  };

  const markWeaponPrefabDirty = (prefabId: string): void => {
    dirtyWeaponPrefabIds.add(prefabId);
    renderLeft();
  };

  const hasUnsavedChanges = (): boolean =>
    dirty
    || controllerDirty
    || settingsDirty
    || dirtyBackpackPrefabIds.size > 0
    || dirtyWeaponPrefabIds.size > 0;

  const matchingCatalogDefinition = (
    fallback: CatalogDefinition,
  ): CatalogDefinition | null => {
    const catalog = fallback.itemType === 'backpack' ? backpacks : weapons;
    return catalog.find((definition) =>
      definition.prefabId === fallback.prefabId
      && definition.itemType === fallback.itemType
    ) ?? null;
  };

  const equipDefaultPlayTestLoadout = (overwrite = false): boolean => {
    let changed = false;
    for (const entry of PLAY_TEST_DEFAULT_ASSIGNMENTS) {
      const current = assignments.get(entry.slotId);
      const shouldReplaceFallback = current === entry.definition;
      if (!overwrite && current && !shouldReplaceFallback) continue;
      const next = matchingCatalogDefinition(entry.definition) ?? entry.definition;
      if (current === next) continue;
      assignments.set(entry.slotId, next);
      changed = true;
    }
    return changed;
  };

  const ensureDrawnGripEntity = (doc: PrefabDocument): PrefabEntity => {
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
  };

  const currentSlot = (): CharacterEquipmentSlotV1 | null =>
    documentState?.slots.find((slot) => slot.id === selectedSlotId) ?? null;

  const currentVariant = () =>
    documentState?.variants[String(selectedType) as '1' | '2'] ?? null;

  const currentMount = (): CharacterBoneMountV1 | null =>
    currentVariant()?.mounts[selectedSlotId] ?? null;

  const currentDrawnMount = (): CharacterBoneMountV1 | null =>
    currentVariant()?.drawnMounts?.[selectedSlotId] ?? null;

  const currentTransformTarget = (): {
    object: THREE.Object3D;
    transform: PrefabTransform;
    source: 'character' | 'backpack-socket' | 'weapon-grip';
    prefabId?: string;
    label: string;
  } | null => {
    const slot = currentSlot();
    if (!slot) return null;
    if (slot.requiresSlotId && !assignments.has(slot.requiresSlotId)) return null;

    if (mountEditMode === 'weapon-grip' && slot.kind === 'weapon') {
      const weaponRoot = weaponPreviewRoots.get(selectedSlotId);
      const gripEntity = weaponGripEntities.get(selectedSlotId);
      const assignment = assignments.get(selectedSlotId);
      if (!weaponRoot || !gripEntity || !assignment?.prefabId) return null;
      return {
        object: weaponRoot,
        transform: gripEntity.transform,
        source: 'weapon-grip',
        prefabId: assignment.prefabId,
        label: `Weapon grip · ${assignment.name}`,
      };
    }

    if (mountEditMode === 'drawn' && slot.kind === 'weapon') {
      const drawn = currentDrawnMount();
      const pivot = drawnPivots.get(selectedSlotId);
      if (!drawn || !pivot) return null;
      return {
        object: pivot,
        transform: drawn,
        source: 'character',
        label: `Type ${selectedType} hand bone mount`,
      };
    }

    if (slot.providerSocket && activeBackpackPrefabId) {
      const object = backpackSocketObjects.get(slot.providerSocket.socketId);
      const entity = backpackSocketEntities.get(slot.providerSocket.socketId);
      if (object && entity) {
        return {
          object,
          transform: entity.transform,
          source: 'backpack-socket',
          prefabId: activeBackpackPrefabId,
          label: `Backpack socket · ${slot.providerSocket.socketId}`,
        };
      }
      if (slot.requiresSlotId) return null;
    }
    const mount = currentMount();
    const pivot = mountPivots.get(selectedSlotId);
    if (!mount || !pivot) return null;
    return {
      object: pivot,
      transform: mount,
      source: 'character',
      label: slot.providerSocket
        ? `Type ${selectedType} holster fallback`
        : `Type ${selectedType} holster mount`,
    };
  };

  const syncGizmo = (): void => {
    const target = currentTransformTarget();
    if (target) gizmo.attach(target.object);
    else gizmo.detach();
  };

  const setGizmoMode = (mode: EquipmentGizmoMode): void => {
    if (playTestActive) return;
    gizmoMode = mode;
    gizmo.setMode(mode);
    renderInspector();
  };

  gizmo.addEventListener('objectChange', () => {
    const target = currentTransformTarget();
    if (!target || gizmo.object !== target.object) return;
    copyObjectToTransform(target.object, target.transform);
    if (target.source === 'backpack-socket' && target.prefabId) {
      dirtyBackpackPrefabIds.add(target.prefabId);
    } else if (target.source === 'weapon-grip' && target.prefabId) {
      dirtyWeaponPrefabIds.add(target.prefabId);
    } else {
      dirty = true;
    }
    renderLeft();
    renderInspector();
  });

  const loadBackpackPrefabDraft = async (prefabId: string): Promise<PrefabDocument | null> => {
    const existing = backpackPrefabDrafts.get(prefabId);
    if (existing) return existing;
    const loaded = await loadPrefabDocument(prefabId);
    if (!loaded) return null;
    const draft = structuredClone(loaded);
    backpackPrefabDrafts.set(prefabId, draft);
    return draft;
  };

  const loadWeaponPrefabDraft = async (prefabId: string): Promise<PrefabDocument | null> => {
    const existing = weaponPrefabDrafts.get(prefabId);
    if (existing) return existing;
    const loaded = await loadPrefabDocument(prefabId);
    if (!loaded) return null;
    const draft = structuredClone(loaded);
    weaponPrefabDrafts.set(prefabId, draft);
    return draft;
  };

  const rebuildEquipmentPreview = async (): Promise<void> => {
    if (!documentState || !avatar) return;
    const generation = ++previewGeneration;
    gizmo.detach();
    for (const pivot of mountPivots.values()) pivot.removeFromParent();
    for (const pivot of drawnPivots.values()) pivot.removeFromParent();
    for (const child of [...previewRoot.children]) {
      if (child !== avatar.root) previewRoot.remove(child);
    }
    mountPivots = new Map();
    drawnPivots = new Map();
    weaponPreviewRoots = new Map();
    weaponGripEntities = new Map();
    activeBackpackPrefabId = null;
    backpackSocketObjects = new Map();
    backpackSocketEntities = new Map();
    const variant = documentState.variants[String(selectedType) as '1' | '2'];
    for (const slot of documentState.slots) {
      const mount = variant.mounts[slot.id];
      const bone = avatar.root.getObjectByName(mount.bone);
      const pivot = new THREE.Group();
      pivot.name = `equipment-mount:${slot.id}`;
      applyTransform(pivot, mount);
      (bone ?? previewRoot).add(pivot);
      mountPivots.set(slot.id, pivot);
      if (!bone) setStageStatus(`Missing character bone "${mount.bone}" for ${slot.label}.`, true);
    }
    for (const [slotId, mount] of Object.entries(variant.drawnMounts ?? {})) {
      const bone = avatar.root.getObjectByName(mount.bone);
      const pivot = new THREE.Group();
      pivot.name = `equipment-drawn:${slotId}`;
      applyTransform(pivot, mount);
      (bone ?? previewRoot).add(pivot);
      drawnPivots.set(slotId, pivot);
      if (!bone) {
        setStageStatus(`Missing drawn-mount bone "${mount.bone}" for ${slotId}.`, true);
      }
    }

    let backpackRoot: THREE.Group | null = null;
    const backpackSockets = new Map<string, THREE.Object3D>();
    const backpackAssignment = assignments.get('backpack');
    if (backpackAssignment?.itemType === 'backpack') {
      const prefab = backpackAssignment.prefabId
        ? await loadBackpackPrefabDraft(backpackAssignment.prefabId)
        : null;
      if (generation !== previewGeneration) return;
      const errors = prefab ? validateBackpackPrefab(prefab) : ['Backpack prefab is missing.'];
      if (prefab && errors.length === 0) {
        activeBackpackPrefabId = prefab.id;
        backpackRoot = createPropInstanceGroup(prefab);
        mountPivots.get('backpack')?.add(backpackRoot);
        for (const socket of collectEquipmentSockets(prefab)) {
          const object = findEntityObject(backpackRoot, socket.entityId);
          const entity = findPrefabEntity(prefab.root, socket.entityId);
          if (object) {
            backpackSockets.set(socket.id, object);
            backpackSocketObjects.set(socket.id, object);
          }
          if (entity) backpackSocketEntities.set(socket.id, entity);
        }
        setStageStatus('Backpack sockets valid. Both rifle slots are available.');
      } else {
        mountPivots.get('backpack')?.add(placeholder(0xffa832));
        assignments.delete('rifle-secondary');
        setStageStatus(`Backpack warning: ${errors.join(' ')}`, true);
      }
    } else {
      assignments.delete('rifle-secondary');
      setStageStatus('No backpack equipped. One rifle uses the character backAttach fallback.');
    }

    for (const slot of documentState.slots) {
      if (slot.kind !== 'weapon') continue;
      const definition = assignments.get(slot.id);
      if (!definition || definition.itemType !== 'weapon') continue;
      if (slot.requiresSlotId && !assignments.has(slot.requiresSlotId)) continue;
      if (!definition.prefabId) continue;
      const draft = await loadWeaponPrefabDraft(definition.prefabId);
      if (generation !== previewGeneration) return;
      if (!draft) continue;
      const gripEntity = ensureDrawnGripEntity(draft);
      const item = createPropInstanceGroup(draft);
      weaponPreviewRoots.set(slot.id, item);
      weaponGripEntities.set(slot.id, gripEntity);
      const drawnSlotId = playTestActive ? playTestWeaponSlotId : simulateDrawnSlotId;
      const drawnParent = drawnSlotId === slot.id ? drawnPivots.get(slot.id) ?? null : null;
      if (drawnParent) {
        applyTransform(item, gripEntity.transform);
        drawnParent.add(item);
        continue;
      }
      applyTransform(item, identityDrawnGripTransform());
      const socket = slot.providerSocket ? backpackSockets.get(slot.providerSocket.socketId) : null;
      if (socket && backpackRoot) socket.add(item);
      else if (!slot.requiresSlotId) mountPivots.get(slot.id)?.add(item);
    }
    if (
      !playTestActive
      && simulateDrawnSlotId
      && (mountEditMode === 'drawn' || mountEditMode === 'weapon-grip')
    ) {
      setStageStatus(
        mountEditMode === 'weapon-grip'
          ? 'Editing this weapon’s drawn-grip. Save writes the weapon prefab.'
          : 'Editing character hand bone. Switch to Weapon grip for per-gun rotation.',
      );
    }
    if (playTestActive) gizmo.detach();
    else syncGizmo();
    renderPlayTestHud();
    renderLeft();
    renderInspector();
  };

  const applyCharacterType = async (): Promise<void> => {
    if (!avatar || !defaultDefinition) return;
    const definition = structuredClone(defaultDefinition);
    definition.name = `Base Character Type ${selectedType}`;
    definition.blendShapes.bodyTypeValue = selectedType === 1 ? -100 : 100;
    definition.blendShapes.bodySizeValue = 0;
    definition.blendShapes.muscleValue = -100;
    if (previewPose === 'reference') restoreReferencePose(avatar.root);
    await avatar.applyDefinition(definition);
    await rebuildEquipmentPreview();
  };

  const revokeAnimationObjectUrl = (): void => {
    if (!animationObjectUrl) return;
    URL.revokeObjectURL(animationObjectUrl);
    animationObjectUrl = null;
  };

  const setPreviewPose = async (nextPose: CharacterPreviewPose): Promise<void> => {
    if (previewPose === nextPose) return;
    previewPose = nextPose;
    renderLeft();
    if (!avatar) return;
    if (previewPose === 'reference') {
      animation?.setPlaying(false);
      setStageStatus('Reference pose active. Character mounts now use a stable bind-pose basis.');
      await applyCharacterType();
      return;
    }
    animation?.setPlaying(true);
    const clip = animation?.activeClipName || animation?.clipNames[0] || 'Idle_Loop';
    animation?.setAnimation(clip, 0);
    animation?.update(0);
    setStageStatus(
      `Animation preview · ${clip}. Equipment follows animated attachment bones.`,
    );
  };

  const ensureAnimatedPose = async (): Promise<void> => {
    if (previewPose !== 'animated') await setPreviewPose('animated');
  };

  const ensureAvatar = async (): Promise<void> => {
    if (avatar) return;
    setStageStatus('Loading default Synty character…');
    const catalog = await loadSidekickCatalog();
    const species = findPreviewSpecies(catalog);
    if (!species) throw new Error('No playable Synty species is available.');
    defaultDefinition = buildDefaultDefinition(catalog, species);
    // Match playable defaults so mounts aren't authored against a different
    // backAttach basis (empty def uses muscleValue 0 → bogus ~178° flip).
    defaultDefinition.blendShapes.bodyTypeValue = -100;
    defaultDefinition.blendShapes.bodySizeValue = 0;
    defaultDefinition.blendShapes.muscleValue = -100;
    avatar = await assembleSidekickCharacter(catalog, defaultDefinition);
    previewRoot.add(avatar.root);
    animation = await createSidekickAnimationRuntime(avatar.root).catch((error: unknown) => {
      console.warn('Base character idle animation unavailable.', error);
      return null;
    });
    animation?.setAnimation('Idle_Loop', 0);
    controls.target.set(0, 0.95, 0);
    camera.position.set(0, 1.05, 4.2);
    controls.update();
  };

  const refreshCatalog = async (): Promise<void> => {
    catalogMessage = 'Refreshing Admin catalog…';
    renderInspector();
    try {
      [weapons, backpacks] = await Promise.all([listWeaponDefinitions(), listBackpackDefinitions()]);
      catalogMessage = `${weapons.length} weapons · ${backpacks.length} backpacks`;
      if (equipDefaultPlayTestLoadout()) void rebuildEquipmentPreview();
    } catch (error) {
      catalogMessage = error instanceof AdminAuthError
        ? 'Admin authentication is required. Sign in through the Admin portal, then refresh.'
        : error instanceof Error ? error.message : 'Catalog refresh failed.';
    }
    renderInspector();
  };

  const assignDefinition = (slot: CharacterEquipmentSlotV1, definition: CatalogDefinition): void => {
    if (!compatible(slot, definition)) return;
    if (slot.requiresSlotId && !assignments.has(slot.requiresSlotId)) return;
    assignments.set(slot.id, definition);
    void rebuildEquipmentPreview();
  };

  const ensureSourceForUrl = (url: string): string => {
    if (!controllerState) return UAL_ANIMATION_SOURCE_ID;
    const existing = controllerState.sources.find((source) => source.url === url);
    if (existing) {
      lastLoadedSourceId = existing.id;
      return existing.id;
    }
    let id = slugFromUrl(url);
    const taken = new Set(controllerState.sources.map((source) => source.id));
    taken.add(UAL_ANIMATION_SOURCE_ID);
    if (taken.has(id)) {
      let suffix = 2;
      while (taken.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    controllerState.sources.push({ id, url, label: labelFromUrl(url), yawOffsetDegrees: 0 });
    lastLoadedSourceId = id;
    markControllerDirty();
    return id;
  };

  const loadAnimationFromAsset = async (url: string): Promise<void> => {
    await ensureAvatar();
    if (!animation) throw new Error('Animation runtime unavailable.');
    leftTab = 'controllers';
    setStageStatus(`Loading ${labelFromUrl(url)}…`);
    await animation.loadAnimationSource(url, labelFromUrl(url));
    if (avatar && defaultDefinition) await applyCharacterType();
    ensureSourceForUrl(url);
    await ensureAnimatedPose();
    animation.setAnimation(animation.activeClipName || animation.clipNames[0] || 'Idle_Loop', 0);
    animation.setPlaying(true);
    animation.update(0);
    setStageStatus(
      `Loaded ${labelFromUrl(url)} · ${animation.clipNames.length} clip(s). Assign via Controllers.`,
    );
    renderLeft();
  };

  const loadController = async (id: string, opts?: { force?: boolean }): Promise<void> => {
    if (
      !opts?.force &&
      controllerDirty &&
      !window.confirm('Discard unsaved animation controller changes?')
    ) {
      return;
    }
    try {
      controllerList = await fetchAnimationControllerList();
      if (controllerList.length === 0) {
        controllerState = cloneAnimationController(buildDefaultAnimationController());
        selectedControllerId = controllerState.id;
      } else {
        const targetId = controllerList.some((entry) => entry.id === id)
          ? id
          : controllerList[0]!.id;
        controllerState = cloneAnimationController(await fetchAnimationController(targetId));
        selectedControllerId = controllerState.id;
      }
      selectedStanceId = controllerState.stances[0]?.id ?? 'unarmed';
      controllerDirty = false;
      renderLeft();
    } catch (error) {
      controllerState = cloneAnimationController(buildDefaultAnimationController());
      selectedControllerId = controllerState.id;
      selectedStanceId = controllerState.stances[0]?.id ?? 'unarmed';
      controllerDirty = false;
      setStageStatus(
        error instanceof Error
          ? `Controller load failed (${error.message}); using in-memory default.`
          : 'Controller load failed; using in-memory default.',
        true,
      );
      renderLeft();
    }
  };

  const loadControllerStateClip = async (
    locomotion: AnimationLocomotionKind,
    stanceId: string,
  ): Promise<string | null> => {
    if (!controllerState || !animation) return null;
    const state = resolveControllerState(controllerState, locomotion, stanceId);
    if (!state) return null;
    if (
      state.sourceId !== UAL_ANIMATION_SOURCE_ID
      && !animation.clipNames.includes(state.clipName)
    ) {
      const source = controllerState.sources.find((entry) => entry.id === state.sourceId);
      if (!source) return null;
      let pending = controllerSourceLoads.get(source.id);
      if (!pending) {
        pending = animation.loadAnimationSource(
          source.url,
          source.label,
          source.yawOffsetDegrees,
        );
        controllerSourceLoads.set(source.id, pending);
      }
      try {
        await pending;
        lastLoadedSourceId = source.id;
      } finally {
        if (controllerSourceLoads.get(source.id) === pending) {
          controllerSourceLoads.delete(source.id);
        }
      }
    }
    return animation.clipNames.includes(state.clipName) ? state.clipName : null;
  };

  const previewControllerState = async (): Promise<void> => {
    if (!controllerState || !animation) return;
    const configuredClip = resolveControllerClip(
      controllerState,
      previewLocomotion,
      selectedStanceId,
    );
    let clipName: string | null;
    try {
      clipName = await loadControllerStateClip(previewLocomotion, selectedStanceId);
    } catch (error) {
      setStageStatus(
        error instanceof Error ? error.message : 'Controller animation failed to load.',
        true,
      );
      return;
    }
    if (!clipName) {
      setStageStatus(
        configuredClip
          ? `Could not load ${configuredClip} for ${selectedStanceId} / ${LOCOMOTION_LABELS[previewLocomotion]}.`
          : `No clip assigned for ${selectedStanceId} / ${LOCOMOTION_LABELS[previewLocomotion]}.`,
        true,
      );
      return;
    }
    await ensureAnimatedPose();
    animation.setAnimation(clipName, 0.12);
    animation.setPlaying(true);
    setStageStatus(`Controller preview · ${selectedStanceId} / ${previewLocomotion} → ${clipName}`);
    renderLeft();
  };

  const playTestMovementAxes = (): { x: number; y: number; moving: boolean } => {
    const x = Number(playTestKeys.has('KeyD')) - Number(playTestKeys.has('KeyA'));
    const y = Number(playTestKeys.has('KeyW')) - Number(playTestKeys.has('KeyS'));
    return { x, y, moving: x !== 0 || y !== 0 };
  };

  const syncPlayTestAnimation = async (force = false): Promise<void> => {
    if (!playTestActive || !animation || !controllerState) return;
    const movement = playTestMovementAxes();
    const isSprinting = movement.moving
      && (playTestKeys.has('ShiftLeft') || playTestKeys.has('ShiftRight'));
    const locomotion = locomotionFromGameplay(
      playTestJumpPhase,
      movement.moving,
      isSprinting,
    );
    const stanceId = stanceIdForWeaponSlot(playTestWeaponSlotId);
    const stateKey = `${stanceId}:${locomotion}`;
    if (!force && stateKey === playTestAnimationKey) return;
    playTestAnimationKey = stateKey;
    previewLocomotion = locomotion;
    selectedStanceId = stanceId;
    const generation = ++playTestAnimationGeneration;
    renderPlayTestHud();
    try {
      const clipName = await loadControllerStateClip(locomotion, stanceId);
      if (!playTestActive || generation !== playTestAnimationGeneration) return;
      if (!clipName) {
        setStageStatus(
          `Play test has no loadable ${stanceId} / ${LOCOMOTION_LABELS[locomotion]} clip.`,
          true,
        );
        return;
      }
      await ensureAnimatedPose();
      if (!playTestActive || generation !== playTestAnimationGeneration) return;
      animation.setAnimation(clipName, 0.12);
      animation.setPlaying(true);
      renderPlayTestHud();
      renderInspector();
    } catch (error) {
      if (!playTestActive || generation !== playTestAnimationGeneration) return;
      setStageStatus(
        error instanceof Error ? error.message : 'Play-test animation failed to load.',
        true,
      );
    }
  };

  const selectPlayTestWeapon = async (
    slotId: WeaponSelectSlotId | null,
    toggle = true,
  ): Promise<void> => {
    if (!playTestActive) return;
    equipDefaultPlayTestLoadout();
    playTestWeaponSlotId = toggle && slotId === playTestWeaponSlotId ? null : slotId;
    playTestAnimationKey = '';
    renderPlayTestHud();
    await rebuildEquipmentPreview();
    if (!playTestActive) return;
    await syncPlayTestAnimation(true);
    canvas.focus();
  };

  function renderPlayTestHud(): void {
    playTestHud.hidden = !playTestActive;
    stage.classList.toggle('is-play-testing', playTestActive);
    if (!playTestActive) return;
    if (playTestWeaponButtons.size === 0) {
      PLAY_TEST_DEFAULT_ASSIGNMENTS
        .filter((entry): entry is PlayTestDefaultAssignment & { slotId: WeaponSelectSlotId } =>
          entry.slotId !== 'backpack')
        .forEach((entry, index) => {
          const weaponButton = button(`${index + 1} ${entry.definition.name}`, () => {
            void selectPlayTestWeapon(entry.slotId);
          });
          weaponButton.className = 'ed-base-playtest-weapon';
          weaponButton.title = `Draw ${entry.definition.name}; press again to holster`;
          playTestWeaponButtons.set(entry.slotId, weaponButton);
          playTestHudLoadout.append(weaponButton);
        });
    }
    for (const [slotId, weaponButton] of playTestWeaponButtons) {
      const assignment = assignments.get(slotId);
      const digit = WEAPON_SELECT_SLOT_IDS.indexOf(slotId) + 1;
      weaponButton.textContent = `${digit} ${assignment?.name ?? slotId}`;
      weaponButton.classList.toggle('is-active', slotId === playTestWeaponSlotId);
    }
    const weaponName = playTestWeaponSlotId
      ? assignments.get(playTestWeaponSlotId)?.name ?? playTestWeaponSlotId
      : 'Unarmed';
    playTestHudState.textContent = [
      weaponName,
      LOCOMOTION_LABELS[previewLocomotion],
      animation?.activeClipName || 'loading animation',
    ].join(' · ');
  }

  function updatePlayTest(deltaSeconds: number): void {
    const movement = playTestMovementAxes();
    const isSprinting = movement.moving
      && (playTestKeys.has('ShiftLeft') || playTestKeys.has('ShiftRight'));
    playTestPreviousPosition.copy(previewRoot.position);

    if (movement.moving) {
      camera.getWorldDirection(playTestCameraForward);
      playTestCameraForward.y = 0;
      if (playTestCameraForward.lengthSq() < 1e-6) playTestCameraForward.set(0, 0, -1);
      else playTestCameraForward.normalize();
      playTestCameraRight.crossVectors(playTestCameraForward, THREE.Object3D.DEFAULT_UP).normalize();
      playTestMoveDirection
        .copy(playTestCameraForward)
        .multiplyScalar(movement.y)
        .addScaledVector(playTestCameraRight, movement.x)
        .normalize();
      const settings = getCharacterSettings();
      const speed = isSprinting
        ? settings.sprintSpeedMetersPerSecond
        : settings.walkSpeedMetersPerSecond;
      previewRoot.position.addScaledVector(playTestMoveDirection, speed * deltaSeconds);
      const horizontalDistance = Math.hypot(previewRoot.position.x, previewRoot.position.z);
      if (horizontalDistance > PLAY_TEST_STAGE_RADIUS_METERS) {
        const scale = PLAY_TEST_STAGE_RADIUS_METERS / horizontalDistance;
        previewRoot.position.x *= scale;
        previewRoot.position.z *= scale;
      }
      const targetYaw = Math.atan2(playTestMoveDirection.x, playTestMoveDirection.z);
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - previewRoot.rotation.y),
        Math.cos(targetYaw - previewRoot.rotation.y),
      );
      previewRoot.rotation.y += yawDelta * Math.min(1, deltaSeconds * 10);
    }

    const airborne = playTestJumpPhase === 'jump-start' || playTestJumpPhase === 'jump-loop';
    if (airborne) {
      const gravityScale = playTestVerticalSpeed < 0 ? PLAY_TEST_FALL_GRAVITY_MULTIPLIER : 1;
      playTestVerticalSpeed -= PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED
        * gravityScale
        * deltaSeconds;
      previewRoot.position.y += playTestVerticalSpeed * deltaSeconds;
      if (previewRoot.position.y <= 0) {
        previewRoot.position.y = 0;
        playTestVerticalSpeed = 0;
      }
    }
    const phase = advanceJumpAnimationPhase(
      { jumpPhase: playTestJumpPhase, jumpPhaseTime: playTestJumpPhaseTime },
      deltaSeconds,
      previewRoot.position.y > 0.001,
      false,
    );
    playTestJumpPhase = phase.jumpPhase;
    playTestJumpPhaseTime = phase.jumpPhaseTime;

    playTestCameraDelta.copy(previewRoot.position).sub(playTestPreviousPosition);
    camera.position.add(playTestCameraDelta);
    controls.target.add(playTestCameraDelta);
    void syncPlayTestAnimation();
  }

  const startPlayTestJump = (): void => {
    if (!playTestActive || previewRoot.position.y > 0.001) return;
    if (playTestJumpPhase === 'jump-start' || playTestJumpPhase === 'jump-loop') return;
    playTestVerticalSpeed = getCharacterSettings().jumpSpeedMetersPerSecond;
    playTestJumpPhase = 'jump-start';
    playTestJumpPhaseTime = 0;
    playTestAnimationKey = '';
    void syncPlayTestAnimation(true);
  };

  const setPlayTestActive = async (nextActive: boolean): Promise<void> => {
    if (nextActive === playTestActive) return;
    if (nextActive) {
      try {
        await ensureAvatar();
        if (!avatar || !documentState) throw new Error('Base Character is still loading.');
        playTestPoseBefore = previewPose;
        playTestStanceBefore = selectedStanceId;
        playTestLocomotionBefore = previewLocomotion;
        playTestClipBefore = animation?.activeClipName || 'Idle_Loop';
        playTestCameraPositionBefore.copy(camera.position);
        playTestCameraTargetBefore.copy(controls.target);
        equipDefaultPlayTestLoadout();
        playTestActive = true;
        playTestWeaponSlotId = null;
        playTestJumpPhase = 'grounded';
        playTestJumpPhaseTime = 0;
        playTestVerticalSpeed = 0;
        playTestAnimationKey = '';
        playTestKeys.clear();
        previewRoot.position.set(0, 0, 0);
        previewRoot.rotation.set(0, 0, 0);
        camera.position.set(0, 1.7, 4.4);
        controls.target.set(0, 0.95, 0);
        controls.update();
        renderPlayTestHud();
        await setPreviewPose('animated');
        await rebuildEquipmentPreview();
        setStageStatus('Play test active. The stage has focus; press Esc to return to authoring.');
        await syncPlayTestAnimation(true);
        canvas.focus();
        renderLeft();
        renderInspector();
      } catch (error) {
        playTestActive = false;
        renderPlayTestHud();
        setStageStatus(
          error instanceof Error ? error.message : 'Could not start Base Character play test.',
          true,
        );
      }
      return;
    }

    playTestActive = false;
    playTestAnimationGeneration += 1;
    playTestKeys.clear();
    playTestWeaponSlotId = null;
    playTestJumpPhase = 'grounded';
    playTestJumpPhaseTime = 0;
    playTestVerticalSpeed = 0;
    playTestAnimationKey = '';
    previewRoot.position.set(0, 0, 0);
    previewRoot.rotation.set(0, 0, 0);
    camera.position.copy(playTestCameraPositionBefore);
    controls.target.copy(playTestCameraTargetBefore);
    controls.update();
    selectedStanceId = playTestStanceBefore;
    previewLocomotion = playTestLocomotionBefore;
    renderPlayTestHud();
    await rebuildEquipmentPreview();
    if (playTestPoseBefore === 'reference') {
      await setPreviewPose('reference');
    } else {
      animation?.setPlaying(true);
      animation?.setAnimation(playTestClipBefore, 0.12);
    }
    setStageStatus('Play test stopped. Authoring controls restored.');
    renderLeft();
    renderInspector();
    syncGizmo();
  };

  const onPlayTestKeyDown = (event: KeyboardEvent): void => {
    if (!playTestActive) return;
    if (event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    if (event.code === 'Escape') {
      event.preventDefault();
      void setPlayTestActive(false);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) startPlayTestJump();
    }
    const digitIndex = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
    if (digitIndex >= 0 && !event.repeat) {
      event.preventDefault();
      void selectPlayTestWeapon(WEAPON_SELECT_SLOT_IDS[digitIndex]!);
    }
    playTestKeys.add(event.code);
  };

  const onPlayTestKeyUp = (event: KeyboardEvent): void => {
    if (!playTestActive) return;
    if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    playTestKeys.delete(event.code);
  };

  const onPlayTestBlur = (): void => {
    playTestKeys.clear();
  };

  canvas.addEventListener('pointerdown', () => {
    if (playTestActive) canvas.focus();
  });
  canvas.addEventListener('keydown', onPlayTestKeyDown);
  canvas.addEventListener('keyup', onPlayTestKeyUp);
  canvas.addEventListener('blur', onPlayTestBlur);

  const assignClipToState = (stateId: string, clipName: string): void => {
    if (!controllerState) return;
    const state = controllerState.states.find((entry) => entry.id === stateId);
    if (!state) return;
    state.clipName = clipName;
    if (clipName) {
      state.sourceId = BUILTIN_UAL_CLIPS.has(clipName)
        ? UAL_ANIMATION_SOURCE_ID
        : lastLoadedSourceId;
    }
    markControllerDirty();
  };

  function renderControllerPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ed-base-anim-panel ed-base-controller-panel';
    if (!controllerState) {
      panel.append(Object.assign(document.createElement('div'), {
        className: 'ed-base-note',
        textContent: 'Loading animation controller…',
      }));
      return panel;
    }

    const controllerSelect = select(
      selectedControllerId,
      (controllerList.length > 0
        ? controllerList
        : [{ id: controllerState.id, label: controllerState.label }]
      ).map((entry) => ({ value: entry.id, label: entry.label })),
      (value) => {
        void loadController(value);
      },
    );
    const saveControllerBtn = button(controllerDirty ? 'Save Ctrl *' : 'Save Ctrl', () => {
      void (async () => {
        if (!controllerState) return;
        try {
          const parsed = parseAnimationController(controllerState);
          const path = await saveAnimationController(parsed);
          controllerState = cloneAnimationController(parsed);
          controllerDirty = false;
          controllerList = await fetchAnimationControllerList();
          setStageStatus(`Saved ${path}`);
          renderLeft();
        } catch (error) {
          setStageStatus(error instanceof Error ? error.message : 'Controller save failed.', true);
        }
      })();
    });
    const actions = document.createElement('div');
    actions.className = 'ed-base-actions';
    actions.append(saveControllerBtn);

    const stanceRow = document.createElement('div');
    stanceRow.className = 'ed-base-type-toggle';
    for (const stance of controllerState.stances) {
      const node = button(stance.label, () => {
        selectedStanceId = stance.id;
        renderLeft();
      });
      node.classList.toggle('is-active', stance.id === selectedStanceId);
      stanceRow.append(node);
    }
    const addStanceBtn = button('+ Stance', () => {
      if (!controllerState) return;
      const id = window.prompt('New stance id (lowercase slug):')?.trim();
      if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
      if (controllerState.stances.some((stance) => stance.id === id)) return;
      const label = window.prompt('Stance label:', id.replace(/-/g, ' '))?.trim() || id;
      controllerState.stances.push({ id, label });
      for (const locomotion of ANIMATION_LOCOMOTION_KINDS) {
        controllerState.states.push({
          id: `${id}-${locomotionStateSlug(locomotion)}`,
          label: `${label} ${LOCOMOTION_LABELS[locomotion]}`,
          locomotion,
          stanceId: id,
          clipName: '',
          sourceId: UAL_ANIMATION_SOURCE_ID,
        });
      }
      selectedStanceId = id;
      markControllerDirty();
    });
    stanceRow.append(addStanceBtn);

    const renameStanceBtn = button('Rename', () => {
      if (!controllerState) return;
      const stance = controllerState.stances.find((entry) => entry.id === selectedStanceId);
      if (!stance) return;
      const next = window.prompt('Stance label:', stance.label)?.trim();
      if (!next) return;
      stance.label = next;
      markControllerDirty();
    });

    const previewRow = document.createElement('div');
    previewRow.className = 'ed-base-actions';
    const locoSelect = select(
      previewLocomotion,
      ANIMATION_LOCOMOTION_KINDS.map((kind) => ({
        value: kind,
        label: LOCOMOTION_LABELS[kind],
      })),
      (value) => {
        previewLocomotion = value as AnimationLocomotionKind;
        void previewControllerState();
      },
    );
    const previewBtn = button('Preview', () => void previewControllerState());
    previewBtn.disabled = !animation;
    previewRow.append(field('Preview loco', locoSelect), previewBtn);

    const table = document.createElement('div');
    table.className = 'ed-base-controller-states';
    for (const locomotion of ANIMATION_LOCOMOTION_KINDS) {
      const state = controllerState.states.find(
        (entry) => entry.stanceId === selectedStanceId && entry.locomotion === locomotion,
      );
      if (!state) continue;
      const clipOptions = [
        { value: '', label: '(unassigned)' },
        ...(animation?.clipNames ?? []).map((name) => ({ value: name, label: name })),
      ];
      if (state.clipName && !clipOptions.some((option) => option.value === state.clipName)) {
        clipOptions.push({
          value: state.clipName,
          label: `${state.clipName} (not loaded)`,
        });
      }
      const row = document.createElement('div');
      row.className = 'ed-base-controller-state-row';
      const label = document.createElement('span');
      label.textContent = LOCOMOTION_LABELS[locomotion];
      const clipSelect = select(state.clipName, clipOptions, (value) => {
        assignClipToState(state.id, value);
      });
      clipSelect.title = 'Assign loaded clip';
      const sourceBadge = document.createElement('code');
      sourceBadge.className = 'ed-base-source-badge';
      sourceBadge.textContent = state.sourceId;
      row.append(label, clipSelect, sourceBadge);
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const url = event.dataTransfer?.getData(ASSET_DND_TYPE)
          || event.dataTransfer?.getData('text/plain')
          || '';
        if (!url || !/\.(glb|gltf)(?:[?#].*)?$/i.test(url)) return;
        void (async () => {
          try {
            await loadAnimationFromAsset(url);
            const clip = animation?.activeClipName || animation?.clipNames[0] || '';
            if (clip) assignClipToState(state.id, clip);
            selectedStanceId = state.stanceId;
            previewLocomotion = state.locomotion;
            await previewControllerState();
          } catch (error) {
            setStageStatus(error instanceof Error ? error.message : 'Drop assign failed.', true);
          }
        })();
      });
      table.append(row);
    }

    const note = document.createElement('div');
    note.className = 'ed-base-note';
    note.textContent =
      'Use Project → Anims (or drop a GLB on a row) to load clips, then assign. Gameplay still uses hard-coded UAL names until stance wiring.';

    panel.append(
      field('Controller', controllerSelect),
      actions,
      field('Stance', stanceRow),
      renameStanceBtn,
      previewRow,
      table,
      note,
    );
    return panel;
  }

  function renderEquipmentTab(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const types = document.createElement('div');
    types.className = 'ed-base-type-toggle';
    for (const type of [1, 2] as const) {
      const node = button(`Type ${type}`, () => {
        selectedType = type;
        renderLeft();
        renderInspector();
        void applyCharacterType();
      });
      node.classList.toggle('is-active', selectedType === type);
      types.append(node);
    }
    const poseLabel = document.createElement('div');
    poseLabel.className = 'ed-base-subtitle';
    poseLabel.textContent = 'Authoring pose';
    const poses = document.createElement('div');
    poses.className = 'ed-base-type-toggle';
    for (const [label, pose] of [
      ['Reference Pose', 'reference'],
      ['Animation Preview', 'animated'],
    ] as const) {
      const node = button(label, () => void setPreviewPose(pose));
      node.classList.toggle('is-active', previewPose === pose);
      poses.append(node);
    }
    const stanceLabel = document.createElement('div');
    stanceLabel.className = 'ed-base-subtitle';
    stanceLabel.textContent = 'Animation stance (for lining up drawn weapons)';
    const stanceRow = document.createElement('div');
    stanceRow.className = 'ed-base-type-toggle';
    const stanceIds = controllerState?.stances.map((stance) => stance.id)
      ?? ['unarmed', 'rifle', 'pistol'];
    for (const stanceId of stanceIds) {
      const node = button(stanceId, () => {
        selectedStanceId = stanceId;
        void previewControllerState();
        renderLeft();
      });
      node.classList.toggle('is-active', stanceId === selectedStanceId);
      stanceRow.append(node);
    }
    const locoRow = document.createElement('div');
    locoRow.className = 'ed-base-actions';
    locoRow.style.marginTop = '0.35rem';
    const locoSelect = select(
      previewLocomotion,
      ANIMATION_LOCOMOTION_KINDS.map((kind) => ({
        value: kind,
        label: LOCOMOTION_LABELS[kind],
      })),
      (value) => {
        previewLocomotion = value as AnimationLocomotionKind;
        void previewControllerState();
        renderLeft();
      },
    );
    locoSelect.title = 'Locomotion clip for the selected stance';
    const previewStanceBtn = button('Play stance', () => void previewControllerState());
    locoRow.append(locoSelect, previewStanceBtn);
    const stanceHint = document.createElement('p');
    stanceHint.className = 'ed-base-note';
    stanceHint.textContent =
      'Switch to Animation Preview, pick Rifle/Pistol, enable Simulate drawn, then gizmo the drawn mount.';

    const slotsLabel = document.createElement('div');
    slotsLabel.className = 'ed-base-subtitle';
    slotsLabel.textContent = 'Equipment slots';
    const slots = document.createElement('div');
    slots.className = 'ed-base-slot-list';
    for (const slot of documentState?.slots ?? []) {
      const unavailable = Boolean(slot.requiresSlotId && !assignments.has(slot.requiresSlotId));
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ed-base-slot';
      row.classList.toggle('is-selected', slot.id === selectedSlotId);
      row.classList.toggle('is-unavailable', unavailable);
      row.textContent = `${slot.label}${assignments.has(slot.id) ? ' · equipped' : ''}`;
      row.addEventListener('click', () => {
        selectedSlotId = slot.id;
        if (slot.kind !== 'weapon') mountEditMode = 'holster';
        renderLeft();
        renderInspector();
        syncGizmo();
      });
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const id = event.dataTransfer?.getData(EQUIPMENT_DND_TYPE);
        const definition = [...weapons, ...backpacks].find((entry) => entry.id === id);
        if (definition) assignDefinition(slot, definition);
      });
      slots.append(row);
    }
    const add = button('Add slot', () => {
      if (!documentState) return;
      const id = window.prompt('New slot id (lowercase slug):')?.trim();
      if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
      if (documentState.slots.some((slot) => slot.id === id)) return;
      const kind = window.prompt('Slot kind: weapon or backpack?', 'weapon') === 'backpack' ? 'backpack' : 'weapon';
      const newSlot: CharacterEquipmentSlotV1 = kind === 'weapon'
        ? { id, label: id.replace(/-/g, ' '), kind, weaponSlotType: 'rifle' }
        : { id, label: id.replace(/-/g, ' '), kind };
      documentState.slots.push(newSlot);
      documentState.variants['1'].mounts[id] = identityCharacterMount('backAttach');
      documentState.variants['2'].mounts[id] = identityCharacterMount('backAttach');
      selectedSlotId = id;
      markDirty();
      renderInspector();
      void rebuildEquipmentPreview();
    });
    fragment.append(
      types,
      poseLabel,
      poses,
      stanceLabel,
      stanceRow,
      locoRow,
      stanceHint,
      slotsLabel,
      slots,
      add,
    );
    return fragment;
  }

  function renderAnimationTab(): HTMLElement {
    const animPanel = document.createElement('div');
    animPanel.className = 'ed-base-anim-panel';
    const clipSelect = select(
      animation?.activeClipName ?? '',
      (animation?.clipNames ?? []).map((name) => ({ value: name, label: name })),
      (value) => {
        void ensureAnimatedPose().then(() => {
          animation?.setAnimation(value, 0.12);
          animation?.setPlaying(true);
          setStageStatus(`Playing ${value}. Equipment follows animated attachment bones.`);
          renderLeft();
        });
      },
    );
    clipSelect.disabled = !animation || animation.clipNames.length === 0;
    clipSelect.title = 'Animation clip';
    const playBtn = button(animation?.playing === false ? 'Play' : 'Pause', () => {
      void ensureAnimatedPose().then(() => {
        const next = !(animation?.playing ?? true);
        animation?.setPlaying(next);
        setStageStatus(next ? `Playing ${animation?.activeClipName ?? 'clip'}.` : 'Animation paused.');
        renderLeft();
      });
    });
    playBtn.disabled = !animation;
    const ualBtn = button('UAL', () => {
      void (async () => {
        if (!animation) return;
        try {
          setStageStatus('Loading UAL locomotion…');
          await animation.loadDefaultLibrary();
          lastLoadedSourceId = UAL_ANIMATION_SOURCE_ID;
          await ensureAnimatedPose();
          setStageStatus(`UAL loaded · ${animation.clipNames.length} clip(s).`);
        } catch (error) {
          setStageStatus(error instanceof Error ? error.message : 'UAL load failed.', true);
        }
        renderLeft();
      })();
    });
    ualBtn.title = 'Load Universal Animation Library locomotion clips';
    ualBtn.disabled = !animation;
    const loadGlbBtn = button('Load GLB…', () => {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (!file || !animation) return;
        void (async () => {
          try {
            setStageStatus(`Loading ${file.name}…`);
            revokeAnimationObjectUrl();
            animationObjectUrl = URL.createObjectURL(file);
            await animation.loadAnimationSource(animationObjectUrl, file.name);
            if (avatar && defaultDefinition) await applyCharacterType();
            await ensureAnimatedPose();
            animation.setAnimation(animation.activeClipName || 'Rifle_Idle', 0);
            animation.setPlaying(true);
            animation.update(0);
            setStageStatus(
              `Loaded ${file.name} · ${animation.clipNames.length} clip(s) retargeted to Sidekick.`,
            );
          } catch (error) {
            setStageStatus(error instanceof Error ? error.message : 'Animation GLB load failed.', true);
          }
          renderLeft();
        })();
      });
      picker.click();
    });
    loadGlbBtn.title = 'Load Mixamo/Unity animation GLB and retarget onto this Sidekick';
    loadGlbBtn.disabled = !animation;
    const animActions = document.createElement('div');
    animActions.className = 'ed-base-actions';
    animActions.append(playBtn, ualBtn, loadGlbBtn);
    const speed = document.createElement('input');
    speed.className = 'ed-input ed-base-anim-speed';
    speed.type = 'range';
    speed.min = '0';
    speed.max = '2';
    speed.step = '0.05';
    speed.value = String(animation?.timeScale ?? 1);
    speed.disabled = !animation;
    speed.title = 'Playback speed';
    speed.addEventListener('input', () => {
      animation?.setTimeScale(Number(speed.value));
    });
    const sourceNote = document.createElement('div');
    sourceNote.className = 'ed-base-note';
    sourceNote.textContent = animation
      ? `Source: ${animation.sourceLabel}`
      : 'Animation runtime unavailable.';
    const tip = document.createElement('div');
    tip.className = 'ed-base-note';
    tip.textContent =
      'Quick scrubber for loaded clips. Assign stance bindings on the Controllers tab (or Project → Anims).';
    animPanel.append(
      field('Clip', clipSelect),
      animActions,
      field('Speed', speed),
      sourceNote,
      tip,
    );
    return animPanel;
  }

  function renderSettingsPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ed-base-anim-panel ed-base-settings-panel';

    const speedField = (
      label: string,
      key: 'walkSpeedMetersPerSecond' | 'sprintSpeedMetersPerSecond' | 'jumpSpeedMetersPerSecond',
    ): HTMLLabelElement =>
      field(label, input(String(settingsState[key]), (raw) => {
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) return;
        settingsState = { ...settingsState, [key]: value };
        setCharacterSettings(settingsState);
        markSettingsDirty();
      }, 'number', 0.1));

    const saveSettingsBtn = button(
      settingsDirty ? 'Save Settings *' : 'Save Settings',
      () => void save(),
    );
    const resetDefaults = button('Reset defaults', () => {
      settingsState = cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
      setCharacterSettings(settingsState);
      markSettingsDirty();
    });
    const actions = document.createElement('div');
    actions.className = 'ed-base-actions';
    actions.append(saveSettingsBtn, resetDefaults);

    const note = document.createElement('p');
    note.className = 'ed-base-note';
    note.textContent =
      'On-foot locomotion for every character (planet, station, and ship decks). '
      + 'Changes apply immediately — start a Play Test to feel them. '
      + 'Save writes src/player/data/character-settings.json.';

    panel.append(
      speedField('Walk speed (m/s)', 'walkSpeedMetersPerSecond'),
      speedField('Sprint speed (m/s)', 'sprintSpeedMetersPerSecond'),
      speedField('Jump speed (m/s)', 'jumpSpeedMetersPerSecond'),
      actions,
      note,
    );
    return panel;
  }

  function renderLeft(): void {
    left.replaceChildren();
    const title = document.createElement('div');
    title.className = 'ed-base-panel-title';
    title.textContent = 'Base Characters';
    const saveButton = button(hasUnsavedChanges() ? 'Save *' : 'Save', () => void save());
    const reload = button('Reload', () => void loadDocument());
    saveButton.disabled = playTestActive;
    reload.disabled = playTestActive;
    const playTestButton = button(playTestActive ? 'Stop Test' : 'Play Test', () => {
      void setPlayTestActive(!playTestActive);
    });
    playTestButton.classList.toggle('is-active', playTestActive);
    playTestButton.title = playTestActive
      ? 'Stop character play test and restore authoring controls'
      : 'Test locomotion, jumping, and the default backpack/weapon loadout';
    const charSettingsButton = button('Char Settings', () => {
      leftTab = 'settings';
      renderLeft();
    });
    charSettingsButton.classList.toggle('is-active', leftTab === 'settings');
    charSettingsButton.title =
      'Tune walk, sprint, and jump speeds — applies live, even during Play Test';
    const toolbar = document.createElement('div');
    toolbar.className = 'ed-base-actions';
    toolbar.append(saveButton, reload, playTestButton, charSettingsButton);

    const tabs = document.createElement('div');
    tabs.className = 'ed-base-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [
      ['equipment', 'Equipment'],
      ['animation', 'Animation'],
      ['controllers', 'Controllers'],
    ] as const) {
      const tab = button(label, () => {
        leftTab = id;
        renderLeft();
        if (id === 'equipment') renderInspector();
      });
      tab.className = 'ed-base-tab';
      tab.classList.toggle('is-active', leftTab === id);
      tab.disabled = playTestActive;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', leftTab === id ? 'true' : 'false');
      tabs.append(tab);
    }

    const body = document.createElement('div');
    body.className = 'ed-base-tab-body';
    if (playTestActive && leftTab !== 'settings') {
      const panel = document.createElement('div');
      panel.className = 'ed-base-anim-panel ed-base-playtest-panel';
      const note = document.createElement('p');
      note.className = 'ed-base-note';
      note.textContent =
        'Click the stage, then use WASD, Shift, Space, and 1–3. Movement drives the active controller states in real time.';
      const reset = button('Reset default loadout', () => {
        equipDefaultPlayTestLoadout(true);
        void rebuildEquipmentPreview().then(() => canvas.focus());
      });
      const stop = button('Stop Play Test', () => void setPlayTestActive(false));
      const actions = document.createElement('div');
      actions.className = 'ed-base-actions';
      actions.append(reset, stop);
      panel.append(note, actions);
      body.append(panel);
    } else if (leftTab === 'settings') body.append(renderSettingsPanel());
    else if (leftTab === 'equipment') body.append(renderEquipmentTab());
    else if (leftTab === 'animation') body.append(renderAnimationTab());
    else body.append(renderControllerPanel());

    left.append(title, toolbar, tabs, body);
  }

  function renderInspector(): void {
    right.replaceChildren();
    if (playTestActive) {
      const heading = document.createElement('div');
      heading.className = 'ed-base-panel-title';
      heading.textContent = 'Play Test';
      const section = document.createElement('section');
      section.className = 'ed-base-section';
      const state = document.createElement('p');
      state.className = 'ed-base-note';
      const weaponName = playTestWeaponSlotId
        ? assignments.get(playTestWeaponSlotId)?.name ?? playTestWeaponSlotId
        : 'Unarmed';
      state.textContent = `${weaponName} · ${LOCOMOTION_LABELS[previewLocomotion]} · ${animation?.activeClipName || 'loading'}`;
      const controlsNote = document.createElement('p');
      controlsNote.className = 'ed-base-note';
      controlsNote.textContent =
        'WASD move · Shift sprint · Space jump · 1 Assault 01 · 2 Brown 50 · 3 Twin Horned Pistol';
      section.append(state, controlsNote);
      right.append(heading, section);
      return;
    }
    const slot = currentSlot();
    const mount = currentMount();
    const heading = document.createElement('div');
    heading.className = 'ed-base-panel-title';
    heading.textContent = slot ? slot.label : 'Equipment slot';
    right.append(heading);
    if (!slot || !mount || !documentState) return;
    const update = (): void => {
      markDirty();
      void rebuildEquipmentPreview();
    };
    const slotSection = document.createElement('section');
    slotSection.className = 'ed-base-section';
    slotSection.append(
      field('Slot ID', Object.assign(document.createElement('code'), { textContent: slot.id })),
      field('Label', input(slot.label, (value) => { slot.label = value || slot.id; update(); })),
      field(
        'Kind',
        select(slot.kind, [{ value: 'weapon', label: 'Weapon' }, { value: 'backpack', label: 'Backpack' }], (value) => {
          slot.kind = value === 'backpack' ? 'backpack' : 'weapon';
          if (slot.kind === 'weapon') slot.weaponSlotType ??= 'rifle';
          else delete slot.weaponSlotType;
          assignments.delete(slot.id);
          update();
        }),
      ),
    );
    if (slot.kind === 'weapon') {
      slotSection.append(field(
        'Accepts',
        select(slot.weaponSlotType ?? 'rifle', ['sword', 'handgun', 'rifle'].map((value) => ({ value, label: value })), (value) => {
          slot.weaponSlotType = value as WeaponSlotType;
          assignments.delete(slot.id);
          update();
        }),
      ));
    }
    const slotOptions = [{ value: '', label: 'Always available' }, ...documentState.slots
      .filter((candidate) => candidate.id !== slot.id)
      .map((candidate) => ({ value: candidate.id, label: candidate.label }))];
    slotSection.append(
      field('Requires slot', select(slot.requiresSlotId ?? '', slotOptions, (value) => {
        slot.requiresSlotId = value || undefined;
        if (!value) assignments.delete(slot.id);
        update();
      })),
      field('Provider slot', select(slot.providerSocket?.slotId ?? '', [{ value: '', label: 'Character mount' }, ...slotOptions.slice(1)], (value) => {
        slot.providerSocket = value ? { slotId: value, socketId: slot.providerSocket?.socketId || slot.id } : undefined;
        update();
      })),
    );
    if (slot.providerSocket) {
      slotSection.append(field('Provider socket', input(slot.providerSocket.socketId, (value) => {
        if (slot.providerSocket) slot.providerSocket.socketId = value;
        update();
      })));
    }
    const remove = button('Delete slot', () => {
      if (!documentState || documentState.slots.length <= 1) return;
      if (!window.confirm(`Delete slot "${slot.label}" from both character types?`)) return;
      documentState.slots = documentState.slots.filter((candidate) => candidate.id !== slot.id);
      delete documentState.variants['1'].mounts[slot.id];
      delete documentState.variants['2'].mounts[slot.id];
      delete documentState.variants['1'].drawnMounts?.[slot.id];
      delete documentState.variants['2'].drawnMounts?.[slot.id];
      for (const candidate of documentState.slots) {
        if (candidate.requiresSlotId === slot.id) delete candidate.requiresSlotId;
        if (candidate.providerSocket?.slotId === slot.id) delete candidate.providerSocket;
      }
      assignments.delete(slot.id);
      if (simulateDrawnSlotId === slot.id) simulateDrawnSlotId = null;
      mountEditMode = 'holster';
      selectedSlotId = documentState.slots[0]?.id ?? '';
      update();
      renderLeft();
    });
    slotSection.append(remove);

    let mountModeSection: HTMLElement | null = null;
    if (slot.kind === 'weapon') {
      mountModeSection = document.createElement('section');
      mountModeSection.className = 'ed-base-section';
      const mountModeTitle = document.createElement('h3');
      mountModeTitle.textContent = 'Mount target';
      mountModeSection.append(mountModeTitle);
      const modeRow = document.createElement('div');
      modeRow.className = 'ed-base-actions';
      const enterDrawnAuthoring = (mode: 'drawn' | 'weapon-grip'): void => {
        mountEditMode = mode;
        selectedStanceId = stanceIdForWeaponSlot(slot.id);
        simulateDrawnSlotId = slot.id;
        if (!currentDrawnMount() && documentState) {
          const variant = documentState.variants[String(selectedType) as '1' | '2'];
          variant.drawnMounts ??= {};
          variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
          markDirty();
        }
        const assignment = assignments.get(slot.id);
        if (mode === 'weapon-grip' && assignment?.prefabId) {
          void loadWeaponPrefabDraft(assignment.prefabId).then((draft) => {
            if (draft) {
              const hadGrip = Boolean(collectDrawnGrip(draft));
              ensureDrawnGripEntity(draft);
              if (!hadGrip) markWeaponPrefabDirty(draft.id);
            }
            void rebuildEquipmentPreview().then(() => {
              void previewControllerState();
            });
          });
          return;
        }
        void rebuildEquipmentPreview().then(() => {
          void previewControllerState();
        });
      };
      for (const [label, mode] of [
        ['Holster', 'holster'],
        ['Hand bone', 'drawn'],
        ['Weapon grip', 'weapon-grip'],
      ] as const) {
        const modeButton = button(label, () => {
          if (mode === 'holster') {
            mountEditMode = 'holster';
            if (simulateDrawnSlotId === slot.id) simulateDrawnSlotId = null;
            void rebuildEquipmentPreview();
            return;
          }
          enterDrawnAuthoring(mode);
        });
        modeButton.classList.toggle('is-active', mountEditMode === mode);
        if (mode === 'weapon-grip' && !assignments.has(slot.id)) {
          modeButton.disabled = true;
          modeButton.title = 'Assign a weapon from the catalog first';
        }
        modeRow.append(modeButton);
      }
      mountModeSection.append(modeRow);
      const drawn = currentDrawnMount();
      if (mountEditMode === 'drawn' || mountEditMode === 'weapon-grip') {
        const hint = document.createElement('p');
        hint.className = 'ed-base-note';
        hint.textContent = mountEditMode === 'weapon-grip'
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
        simulate.checked = simulateDrawnSlotId === slot.id;
        simulate.addEventListener('change', () => {
          simulateDrawnSlotId = simulate.checked ? slot.id : null;
          void rebuildEquipmentPreview();
        });
        simulateLabel.append(simulate, document.createTextNode('Simulate drawn (mesh in hand)'));
        mountModeSection.append(simulateLabel);
        if (mountEditMode === 'drawn') {
          if (drawn) {
            const removeDrawn = button('Remove hand bone mount', () => {
              if (!documentState) return;
              const variant = documentState.variants[String(selectedType) as '1' | '2'];
              if (variant.drawnMounts) {
                delete variant.drawnMounts[slot.id];
                if (Object.keys(variant.drawnMounts).length === 0) delete variant.drawnMounts;
              }
              if (simulateDrawnSlotId === slot.id) simulateDrawnSlotId = null;
              mountEditMode = 'holster';
              update();
            });
            mountModeSection.append(removeDrawn);
          } else {
            const addDrawn = button('Add hand bone mount', () => {
              if (!documentState) return;
              const variant = documentState.variants[String(selectedType) as '1' | '2'];
              variant.drawnMounts ??= {};
              variant.drawnMounts[slot.id] = identityCharacterMount(DEFAULT_DRAWN_WEAPON_BONE);
              update();
            });
            mountModeSection.append(addDrawn);
          }
        }
      }
    }

    const transformSection = document.createElement('section');
    transformSection.className = 'ed-base-section';
    const transformTitle = document.createElement('h3');
    const transformTarget = currentTransformTarget();
    const editingMount = mountEditMode === 'drawn' && slot.kind === 'weapon'
      ? currentDrawnMount()
      : mountEditMode === 'weapon-grip'
        ? null
        : mount;
    transformTitle.textContent = transformTarget?.label ?? 'Transform unavailable';
    transformSection.append(transformTitle);
    if (!transformTarget) {
      const unavailable = document.createElement('p');
      unavailable.className = 'ed-base-warning';
      unavailable.textContent = mountEditMode === 'weapon-grip' && slot.kind === 'weapon'
        ? 'Assign a weapon and enable Simulate drawn to edit that gun’s grip.'
        : mountEditMode === 'drawn' && slot.kind === 'weapon'
          ? 'Add a hand bone mount to edit the shared character attach bone.'
          : slot.requiresSlotId
            ? `Equip a valid ${slot.requiresSlotId} to edit this provider socket.`
            : 'The selected transform target is unavailable.';
      transformSection.append(unavailable);
    }
    const modes = document.createElement('div');
    modes.className = 'ed-base-actions';
    for (const [label, mode] of [['Move', 'translate'], ['Rotate', 'rotate'], ['Scale', 'scale']] as const) {
      const modeButton = button(label, () => setGizmoMode(mode));
      modeButton.classList.toggle('is-active', gizmoMode === mode);
      modes.append(modeButton);
    }
    const spaceButton = button(gizmoSpace === 'local' ? 'Local' : 'World', () => {
      gizmoSpace = gizmoSpace === 'local' ? 'world' : 'local';
      gizmo.setSpace(gizmoSpace);
      renderInspector();
    });
    spaceButton.title = 'Toggle local/world gizmo orientation';
    modes.append(spaceButton);
    if (transformTarget) transformSection.append(modes);
    const markTransformDirty = (): void => {
      if (transformTarget?.source === 'backpack-socket' && transformTarget.prefabId) {
        markBackpackPrefabDirty(transformTarget.prefabId);
      } else if (transformTarget?.source === 'weapon-grip' && transformTarget.prefabId) {
        markWeaponPrefabDirty(transformTarget.prefabId);
      } else {
        markDirty();
      }
    };
    const updateNumber = (target: { x: number; y: number; z: number }, key: 'x' | 'y' | 'z', value: string): void => {
      const number = Number(value);
      if (!Number.isFinite(number) || !transformTarget) return;
      target[key] = number;
      applyTransform(transformTarget.object, transformTarget.transform);
      markTransformDirty();
    };
    if (transformTarget?.source === 'character' && editingMount) {
      transformSection.append(field('Bone', select(editingMount.bone, ATTACHMENT_BONES.map((bone) => ({ value: bone, label: bone })), (value) => {
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
    const appendVectorRow = (
      label: string,
      target: { x: number; y: number; z: number },
      step: number,
      onValue: (key: 'x' | 'y' | 'z', value: string) => void,
    ): void => {
      const row = document.createElement('div');
      row.className = 'ed-base-vector';
      const rowLabel = document.createElement('span');
      rowLabel.textContent = label;
      row.append(rowLabel);
      for (const key of ['x', 'y', 'z'] as const) {
        const valueInput = input(displayNumber(target[key]), (value) => onValue(key, value), 'number', step);
        valueInput.title = key.toUpperCase();
        row.append(valueInput);
      }
      transformSection.append(row);
    };
    if (transformTarget) {
      const transform = transformTarget.transform;
      appendVectorRow('Position', transform.position, 0.01, (key, value) => updateNumber(transform.position, key, value));
      const rotationDegrees = transformEulerDegrees(transform);
      appendVectorRow('Rotation°', rotationDegrees, 5, (key, value) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        const nextDegrees = transformEulerDegrees(transform);
        nextDegrees[key] = number;
        setTransformEulerDegrees(transform, nextDegrees);
        applyTransform(transformTarget.object, transform);
        markTransformDirty();
        renderInspector();
      });
      appendVectorRow('Scale', transform.scale, 0.05, (key, value) => updateNumber(transform.scale, key, value));
    }

    const catalogSection = document.createElement('section');
    catalogSection.className = 'ed-base-section ed-base-catalog';
    const catalogTitle = document.createElement('h3');
    catalogTitle.textContent = 'Synchronized catalog';
    const refresh = button('Refresh', () => void refreshCatalog());
    const adminLink = document.createElement('a');
    adminLink.className = 'ed-btn';
    adminLink.href = '/?boot=admin';
    adminLink.target = '_blank';
    adminLink.textContent = 'Open Admin';
    const message = document.createElement('p');
    message.className = 'ed-base-note';
    message.textContent = catalogMessage;
    catalogSection.append(catalogTitle, refresh, adminLink, message);
    const available = slot.kind === 'backpack'
      ? backpacks
      : weapons.filter((weapon) => weapon.weaponSlotType === slot.weaponSlotType);
    const slotUnavailable = Boolean(slot.requiresSlotId && !assignments.has(slot.requiresSlotId));
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
        card.addEventListener('dragstart', (event) => event.dataTransfer?.setData(EQUIPMENT_DND_TYPE, definition.id));
        card.addEventListener('click', () => assignDefinition(slot, definition));
        catalogSection.append(card);
      }
    }
    const clear = button('Clear preview assignment', () => {
      assignments.delete(slot.id);
      if (slot.id === 'backpack') assignments.delete('rifle-secondary');
      void rebuildEquipmentPreview();
    });
    catalogSection.append(clear);
    right.append(
      slotSection,
      ...(mountModeSection ? [mountModeSection] : []),
      transformSection,
      catalogSection,
    );
  }

  async function loadDocument(): Promise<void> {
    if (hasUnsavedChanges() && !window.confirm('Discard unsaved Base Character, controller, settings, backpack socket, or weapon grip changes?')) return;
    setStageStatus('Loading Base Character equipment…');
    try {
      documentState = cloneBaseCharacterEquipment(await fetchBaseCharacterEquipment());
      selectedSlotId = documentState.slots[0]?.id ?? '';
      mountEditMode = 'holster';
      simulateDrawnSlotId = null;
      assignments = new Map();
      equipDefaultPlayTestLoadout();
      dirty = false;
      dirtyBackpackPrefabIds.clear();
      dirtyWeaponPrefabIds.clear();
      backpackPrefabDrafts.clear();
      weaponPrefabDrafts.clear();
      try {
        settingsState = await fetchCharacterSettings();
      } catch {
        // Keep the session's active settings when the document is missing.
        settingsState = cloneCharacterSettings(getCharacterSettings());
      }
      setCharacterSettings(settingsState);
      settingsDirty = false;
      await ensureAvatar();
      await applyCharacterType();
      await loadController(selectedControllerId, { force: true });
      renderLeft();
      renderInspector();
    } catch (error) {
      setStageStatus(error instanceof Error ? error.message : 'Base Character load failed.', true);
    }
  }

  async function persistSettings(savedPaths: string[]): Promise<void> {
    if (!settingsDirty) return;
    const parsed = parseCharacterSettings(settingsState);
    savedPaths.push(await saveCharacterSettings(parsed));
    settingsState = cloneCharacterSettings(parsed);
    setCharacterSettings(settingsState);
    settingsDirty = false;
  }

  async function save(): Promise<void> {
    if (!documentState && !controllerState) return;
    try {
      const savedPaths: string[] = [];
      if (dirty && documentState) {
        const parsed = parseBaseCharacterEquipment(documentState);
        const path = await saveBaseCharacterEquipment(parsed);
        documentState = cloneBaseCharacterEquipment(parsed);
        dirty = false;
        savedPaths.push(path);
      }
      if (controllerDirty && controllerState) {
        const parsed = parseAnimationController(controllerState);
        const path = await saveAnimationController(parsed);
        controllerState = cloneAnimationController(parsed);
        controllerDirty = false;
        controllerList = await fetchAnimationControllerList();
        savedPaths.push(path);
      }
      await persistSettings(savedPaths);
      for (const prefabId of [...dirtyBackpackPrefabIds]) {
        const draft = backpackPrefabDrafts.get(prefabId);
        if (!draft) continue;
        const parsed = parsePrefabDocument(draft);
        const path = await savePrefab(parsed);
        backpackPrefabDrafts.set(prefabId, parsed);
        dirtyBackpackPrefabIds.delete(prefabId);
        savedPaths.push(path);
      }
      for (const prefabId of [...dirtyWeaponPrefabIds]) {
        const draft = weaponPrefabDrafts.get(prefabId);
        if (!draft) continue;
        const parsed = parsePrefabDocument(draft);
        const path = await savePrefab(parsed);
        weaponPrefabDrafts.set(prefabId, parsed);
        dirtyWeaponPrefabIds.delete(prefabId);
        savedPaths.push(path);
      }
      setStageStatus(savedPaths.length > 0 ? `Saved ${savedPaths.join(', ')}` : 'No changes to save.');
      renderLeft();
    } catch (error) {
      setStageStatus(error instanceof Error ? error.message : 'Base Character save failed.', true);
    }
  }

  return {
    activate: () => {
      active = true;
      clock.start();
      resize();
      if (!initialized) {
        initialized = true;
        void Promise.all([loadDocument(), refreshCatalog()]);
      }
    },
    deactivate: () => {
      active = false;
      if (playTestActive) void setPlayTestActive(false);
    },
    canLeave: () =>
      !hasUnsavedChanges() ||
      window.confirm('Leave Base Characters with unsaved character, controller, settings, backpack, or weapon grip changes?'),
    isDirty: hasUnsavedChanges,
    setGizmoMode,
    save,
    loadAnimationFromAsset,
    dispose: () => {
      disposed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener('keydown', onPlayTestKeyDown);
      canvas.removeEventListener('keyup', onPlayTestKeyUp);
      canvas.removeEventListener('blur', onPlayTestBlur);
      playTestKeys.clear();
      controllerSourceLoads.clear();
      gizmo.detach();
      controls.dispose();
      gizmo.dispose();
      animation?.dispose();
      revokeAnimationObjectUrl();
      avatar?.dispose();
      environmentTarget.dispose();
      renderer.dispose();
    },
  };
}
