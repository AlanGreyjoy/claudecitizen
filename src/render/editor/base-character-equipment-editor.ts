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
  UAL_ANIMATION_SOURCE_ID,
  buildDefaultAnimationController,
  cloneAnimationController,
  parseAnimationController,
  resolveControllerClip,
  resolveControllerState,
  type AnimationControllerV1,
  type AnimationLocomotionKind,
} from '../../player/animation/schema';
import {
  setDefaultAnimationController,
} from '../../player/animation/default-controller';
import {
  integrateCharacterLocomotion,
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
} from '../../player/character-controller';
import {
  animationLayersFromState,
  resolveWalkAiming,
  resolveWalkFacing,
  resolveWalkInputIntent,
  shouldLockFacingToCamera,
  type WalkGait,
} from '../../player/character-locomotion';
import {
  cloneCharacterSettings,
  getCharacterSettings,
  parseCharacterSettings,
  setCharacterSettings,
  type CharacterSettingsV1,
} from '../../player/character-settings';
import { createPlayerControls } from '../../input/player-controls';
import { resolveDeckCameraOrbit } from '../../flight/flight-aim';
import { add, normalize, scale, vec3 } from '../../math/vec3';
import type { CharacterState, JumpPhase, Vec3 } from '../../types';
import { buildDefaultDefinition, findPreviewSpecies, invalidateSidekickCatalog, loadSidekickCatalog } from '../../player/character_creator/sidekick-catalog';
import type { SidekickCharacterDefinitionV2 } from '../../player/character_creator/sidekick-definition';
import {
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
  type PrefabTransform,
} from '../../world/prefabs/schema';
import {
  attachWeaponEquipmentPreviews,
  createEquipmentPreviewState,
  loadBackpackEquipmentPreview,
  reportDrawnAuthoringStatus,
  setupEquipmentDrawnPivots,
  setupEquipmentMountPivots,
} from "./base-character-equipment-preview";
import { applyPlayTestAnimationLayers, buildPlayTestAnimationStateKey } from "./base-character-equipment-play-test";
import {
  resolveEquipmentTransformTarget,
  type MountEditMode,
} from "./base-character-equipment-transform";
import type {
  BaseCharacterEditorUiApi,
  BaseCharacterEquipmentEditorOptions,
  BaseCharacterLeftTab,
  CharacterPreviewPose,
  EquipmentGizmoMode,
} from './base-character-equipment-ui';
import { createBaseCharacterEditorUiApi } from './base-character-equipment-ui-api';
import {
  WEAPON_SELECT_SLOT_IDS,
  stanceIdForWeaponSlot,
  type WeaponSelectSlotId,
} from '../../player/inventory/weapon-select';

type CatalogDefinition = WeaponDefinition | BackpackDefinition;
/** holster = resting; drawn = character hand bone; weapon-grip = per-weapon prefab pose */

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
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
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
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
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
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
    },
  },
] as const;

const PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED = 9.8;
const PLAY_TEST_STAGE_RADIUS_METERS = 9;
const PLAY_TEST_WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const PLAY_TEST_STAGE_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
const PLAY_TEST_WEAPON_AIM_ZOOM_SCALE = 0.86;
const PLAY_TEST_WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS = 0.07;
const PLAY_TEST_MAX_UPPER_BODY_AIM_YAW = THREE.MathUtils.degToRad(80);
const PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH = THREE.MathUtils.degToRad(55);

function createPlayTestCharacterState(): CharacterState {
  return {
    animation: 'Idle_Loop',
    forward: { ...PLAY_TEST_STAGE_FORWARD },
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: vec3(0, 0, 0),
    up: { ...PLAY_TEST_WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
}

function clampPlayTestToStage(position: Vec3): Vec3 {
  const radial = Math.hypot(position.x, position.z);
  if (radial <= PLAY_TEST_STAGE_RADIUS_METERS) return position;
  const pull = PLAY_TEST_STAGE_RADIUS_METERS / radial;
  return { x: position.x * pull, y: position.y, z: position.z * pull };
}

function smoothPlayTestVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dt: number,
  halfLife: number,
): void {
  if (halfLife <= 1e-6) {
    current.copy(target);
    return;
  }
  const blend = 1 - Math.exp((-Math.LN2 * dt) / halfLife);
  current.lerp(target, blend);
}

export interface BaseCharacterEquipmentEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  setGizmoMode: (mode: EquipmentGizmoMode) => void;
  save: () => Promise<void>;
  /** Load a Project / protected animation GLB into the Sidekick preview runtime. */
  loadAnimationFromAsset: (url: string) => Promise<void>;
  /** Re-read Sidekick pack after Tools → Locate. */
  reloadSidekickPack: () => Promise<void>;
  /** Left equipment chrome — dock into Scene hierarchy panel (full height). */
  getLeftPanel: () => HTMLElement;
  /** Right inspector chrome — dock into Scene inspector panel (full height). */
  getRightPanel: () => HTMLElement;
  getUiApi: () => BaseCharacterEditorUiApi;
  dispose: () => void;
}

export type { BaseCharacterEquipmentEditorOptions } from './base-character-equipment-ui';

const LOCOMOTION_LABELS: Record<AnimationLocomotionKind, string> = {
  idle: 'Idle',
  idle_aiming: 'Idle Aiming',
  idle_crouching: 'Idle Crouching',
  idle_crouching_aiming: 'Idle Crouching Aiming',
  walk_crouching: 'Walk Crouching',
  walk: 'Walk',
  run: 'Run',
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
  options: BaseCharacterEquipmentEditorOptions,
): BaseCharacterEquipmentEditor {
  const { stageHost, leftHost, rightHost, onUiChange } = options;
  // Stage fills the Scene center body. Left/right chrome docks into the outer
  // hierarchy/inspector panels so scene tabs sit between them (same as Scene).
  // Clear any prior mount (HMR / Strict Mode) so panels don't stack twice.
  stageHost.replaceChildren();
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
  playTestHudHelp.textContent =
    'Click stage to look · WASD move · Shift sprint · CapsLock walk · C crouch · Space jump · RMB aim · LMB fire anim · wheel zoom · 1-3 weapons · Esc stop';
  playTestHud.append(
    playTestHudTitle,
    playTestHudState,
    playTestHudLoadout,
    playTestHudHelp,
  );
  const stageStatus = document.createElement('div');
  stageStatus.className = 'ed-base-stage-status';
  const packMissingBanner = document.createElement('div');
  packMissingBanner.className = 'ed-base-pack-missing is-hidden';
  packMissingBanner.setAttribute('role', 'status');
  packMissingBanner.innerHTML =
    '<strong>Synty Sidekick pack missing</strong>'
    + '<span>Export from Unity (<code>ClaudeCitizen → Export Synty Sidekick…</code>), '
    + 'then use <code>Tools → Locate Synty Sidekick Pack…</code> '
    + 'or set the folder in Project Settings.</span>';
  stage.append(canvas, playTestHud, stageStatus, packMissingBanner);
  stageHost.append(stage);

const notifyUiChangeRef = { current: (): void => { onUiChange(); } };
  const notifyUiChange = (): void => notifyUiChangeRef.current();

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
  // Near starts small so equipment-mount close-ups don't clip; renderFrame
  // retunes near/far from camera↔target distance for the orbit stage.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(0, 1.05, 4.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.set(0, 1, 0);
  controls.minDistance = 0.08;
  // Match Scene viewport: RMB is Unity-style flythrough; pan lives on middle mouse.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };
  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSpace('local');
  gizmo.setTranslationSnap(0.01);
  gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
  gizmo.setScaleSnap(0.05);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (event) => {
    if (!playTestActive && !flying) controls.enabled = !event.value;
  });

  // ---- flythrough camera (hold RMB, same as Scene viewport) ----------------
  const FLY_KEY_CODES = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ShiftLeft',
    'ShiftRight',
  ]);
  const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
  const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 12;
  let flyTargetDistance = 10;

  /** Blocks RMB fly while play-test owns the canvas / camera. */
  let authoringCameraSuspended = false;

  function beginFly(): void {
    if (flying || playTestActive || authoringCameraSuspended || disposed || !active) return;
    flying = true;
    flyTargetDistance = Math.max(4, camera.position.distanceTo(controls.target));
    flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    flyEuler.z = 0;
    controls.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.getWorldDirection(flyForward);
    controls.target
      .copy(camera.position)
      .addScaledVector(flyForward, flyTargetDistance);
    if (!playTestActive) controls.enabled = true;
    controls.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(-FLY_PITCH_LIMIT, Math.min(FLY_PITCH_LIMIT, flyEuler.x));
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has('KeyW')) flyMove.add(flyForward);
    if (flyKeys.has('KeyS')) flyMove.sub(flyForward);
    if (flyKeys.has('KeyD')) flyMove.add(flyRight);
    if (flyKeys.has('KeyA')) flyMove.sub(flyRight);
    if (flyKeys.has('KeyE')) flyMove.y += 1;
    if (flyKeys.has('KeyQ')) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight') ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    if (event.type === 'keydown') flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }

  function onPointerLockChange(): void {
    // Play-test also pointer-locks this canvas; don't treat its unlock as fly end.
    if (authoringCameraSuspended || playTestActive) return;
    if (flying && document.pointerLockElement !== canvas) endFly();
  }

  window.addEventListener('keydown', onFlyKey);
  window.addEventListener('keyup', onFlyKey);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointermove', onFlyLook);
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 || playTestActive || authoringCameraSuspended) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id — flythrough still works.
    }
    beginFly();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 2) endFly();
  });
  canvas.addEventListener('pointercancel', () => endFly());
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!flying) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flySpeed = Math.min(
        200,
        Math.max(0.5, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
      );
    },
    { passive: false, capture: true },
  );

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
  let playTestCharacter = createPlayTestCharacterState();
  let playTestControls: ReturnType<typeof createPlayerControls> | null = null;
  let playTestHardAim = false;
  let playTestAimZoom01 = 0;
  let playTestAnimationKey = '';
  let playTestAnimationGeneration = 0;
  let playTestPoseBefore: CharacterPreviewPose = 'reference';
  let playTestStanceBefore = 'unarmed';
  let playTestLocomotionBefore: AnimationLocomotionKind = 'idle';
  let playTestClipBefore = 'Idle_Loop';
  let dirty = false;
  let active = false;
  let disposed = false;
  let readyPromise: Promise<void> | null = null;
  let avatar: SidekickAvatarInstance | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let controllerUpperBodyAim: SidekickUpperBodyAimController | null = null;
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
  const playTestWeaponButtons = new Map<WeaponSelectSlotId, HTMLButtonElement>();
  const playTestCameraPositionBefore = new THREE.Vector3();
  const playTestCameraTargetBefore = new THREE.Vector3();
  const playTestDesiredCameraPos = new THREE.Vector3();
  const playTestDesiredCameraTarget = new THREE.Vector3();
  const playTestSmoothedCameraPos = new THREE.Vector3();
  const playTestSmoothedCameraTarget = new THREE.Vector3();
  const playTestUpperAimView = new THREE.Vector3();
  const playTestUpperAimUp = new THREE.Vector3();
  const playTestUpperAimForward = new THREE.Vector3();
  const playTestUpperAimPlanarView = new THREE.Vector3();
  const playTestUpperAimCross = new THREE.Vector3();
  const controllerSourceLoads = new Map<string, Promise<void>>();
  scene.add(previewRoot);

  const restoreAuthoringCamera = (): void => {
    endFly();
    camera.up.set(0, 1, 0);
    camera.position.copy(playTestCameraPositionBefore);
    controls.target.copy(playTestCameraTargetBefore);
    controls.enabled = true;
    controls.update();
  };

  const resetPlayTestStageTransform = (): void => {
    previewRoot.position.set(0, 0, 0);
    previewRoot.rotation.set(0, 0, 0);
    previewRoot.scale.set(1, 1, 1);
    if (!avatar) return;
    avatar.root.position.set(0, 0, 0);
    avatar.root.rotation.set(0, 0, 0);
    avatar.root.scale.set(1, 1, 1);
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  /** Keep near/far proportional to framing distance so close zooms don't eat the mesh. */
  const updateAuthoringClipPlanes = (): void => {
    const distance = Math.max(0.05, camera.position.distanceTo(controls.target));
    const nextNear = THREE.MathUtils.clamp(distance * 0.01, 0.001, 0.05);
    const nextFar = Math.max(200, distance * 40);
    if (camera.near === nextNear && camera.far === nextFar) return;
    camera.near = nextNear;
    camera.far = nextFar;
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
    else if (flying) updateFly(deltaSeconds);
    else controls.update();
    if (!playTestActive) updateAuthoringClipPlanes();
    if (previewPose === 'animated') {
      controllerUpperBodyAim?.restore();
      animation?.update(deltaSeconds);
      controllerUpperBodyAim?.update(deltaSeconds);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(renderFrame);

  const setStageStatus = (message: string, error = false): void => {
    stageStatus.textContent = message;
    stageStatus.classList.toggle('is-error', error);
  };

  const setPackMissing = (missing: boolean, detail?: string): void => {
    packMissingBanner.classList.toggle('is-hidden', !missing);
    if (missing) {
      setStageStatus(
        detail
          ?? 'Sidekick pack missing or invalid. Use Tools → Locate Synty Sidekick Pack…',
        true,
      );
    }
  };

  const disposeAvatarPreview = (): void => {
    if (avatar) {
      previewRoot.remove(avatar.root);
      avatar.dispose();
      avatar = null;
    }
    animation?.dispose();
    animation = null;
    controllerUpperBodyAim?.dispose();
    controllerUpperBodyAim = null;
    defaultDefinition = null;
  };

  const markDirty = (): void => {
    dirty = true;
    notifyUiChange();
  };

  const markControllerDirty = (): void => {
    controllerDirty = true;
    // Live authoring: Play Test and getDefaultAnimationController() share this draft.
    if (controllerState?.id === 'default') {
      setDefaultAnimationController(controllerState);
    }
    notifyUiChange();
  };

  const markSettingsDirty = (): void => {
    settingsDirty = true;
    notifyUiChange();
  };

  const markBackpackPrefabDirty = (prefabId: string): void => {
    dirtyBackpackPrefabIds.add(prefabId);
    notifyUiChange();
  };

  const markWeaponPrefabDirty = (prefabId: string): void => {
    dirtyWeaponPrefabIds.add(prefabId);
    notifyUiChange();
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

  const currentTransformTarget = (): ReturnType<typeof resolveEquipmentTransformTarget> => {
    const slot = currentSlot();
    if (!slot) return null;
    return resolveEquipmentTransformTarget({
      slot,
      mountEditMode,
      selectedType,
      selectedSlotId,
      assignments,
      activeBackpackPrefabId,
      weaponPreviewRoots,
      weaponGripEntities,
      drawnPivots,
      mountPivots,
      backpackSocketObjects,
      backpackSocketEntities,
      currentDrawnMount,
      currentMount,
    });
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
    notifyUiChange();
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
    notifyUiChange();
    notifyUiChange();
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
    const previewState = createEquipmentPreviewState();
    mountPivots = previewState.mountPivots;
    drawnPivots = previewState.drawnPivots;
    weaponPreviewRoots = previewState.weaponPreviewRoots;
    weaponGripEntities = previewState.weaponGripEntities;
    activeBackpackPrefabId = previewState.activeBackpackPrefabId;
    backpackSocketObjects = previewState.backpackSocketObjects;
    backpackSocketEntities = previewState.backpackSocketEntities;

    const previewCtx = {
      documentState,
      selectedType,
      avatar,
      previewRoot,
      assignments,
      playTestActive,
      playTestWeaponSlotId,
      simulateDrawnSlotId,
      mountEditMode,
      loadBackpackPrefabDraft,
      loadWeaponPrefabDraft,
      ensureDrawnGripEntity,
      applyTransform,
      setStageStatus,
      findEntityObject,
      findPrefabEntity,
      placeholder,
    };
    setupEquipmentMountPivots(previewCtx, previewState);
    setupEquipmentDrawnPivots(previewCtx, previewState);
    const { backpackRoot, backpackSockets } = await loadBackpackEquipmentPreview(
      previewCtx,
      previewState,
      generation,
      previewGeneration,
    );
    if (generation !== previewGeneration) return;
    const stale = await attachWeaponEquipmentPreviews(
      previewCtx,
      previewState,
      backpackRoot,
      backpackSockets,
      generation,
      previewGeneration,
    );
    if (stale || generation !== previewGeneration) return;
    reportDrawnAuthoringStatus(previewCtx);
    if (playTestActive) gizmo.detach();
    else syncGizmo();
    renderPlayTestHud();
    notifyUiChange();
    notifyUiChange();
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
    notifyUiChange();
    if (!avatar) return;
    if (previewPose === 'reference') {
      controllerUpperBodyAim?.restore();
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
    try {
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
      controllerUpperBodyAim = createSidekickUpperBodyAimController(previewRoot, avatar.root);
      animation?.setAnimation('Idle_Loop', 0);
      controls.target.set(0, 0.95, 0);
      camera.position.set(0, 1.05, 4.2);
      controls.update();
      setPackMissing(false);
      setStageStatus('Synty Sidekick character ready.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Sidekick pack load failed.';
      setPackMissing(
        true,
        `Sidekick pack missing or invalid (${detail}). Use Tools → Locate Synty Sidekick Pack…`,
      );
      throw error;
    }
  };

  const refreshCatalog = async (): Promise<void> => {
    catalogMessage = 'Refreshing Admin catalog…';
    notifyUiChange();
    try {
      [weapons, backpacks] = await Promise.all([listWeaponDefinitions(), listBackpackDefinitions()]);
      catalogMessage = `${weapons.length} weapons · ${backpacks.length} backpacks`;
      if (equipDefaultPlayTestLoadout()) void rebuildEquipmentPreview();
    } catch (error) {
      catalogMessage = error instanceof AdminAuthError
        ? 'Admin authentication is required. Sign in through the Admin portal, then refresh.'
        : error instanceof Error ? error.message : 'Catalog refresh failed.';
    }
    notifyUiChange();
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

  const ensureReady = (): Promise<void> => {
    active = true;
    clock.start();
    resize();
    readyPromise ??= Promise.all([loadDocument(), refreshCatalog()]).then(() => undefined);
    return readyPromise;
  };

  const loadAnimationFromAsset = async (url: string): Promise<void> => {
    await ensureReady();
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
    notifyUiChange();
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
      // Keep gameplay's shared default cache on the same document Play Test uses.
      if (controllerState.id === 'default') {
        setDefaultAnimationController(controllerState);
      }
      notifyUiChange();
    } catch (error) {
      controllerState = cloneAnimationController(buildDefaultAnimationController());
      selectedControllerId = controllerState.id;
      selectedStanceId = controllerState.stances[0]?.id ?? 'unarmed';
      controllerDirty = false;
      setDefaultAnimationController(controllerState);
      setStageStatus(
        error instanceof Error
          ? `Controller load failed (${error.message}); using in-memory default.`
          : 'Controller load failed; using in-memory default.',
        true,
      );
      notifyUiChange();
    }
  };

  const ensureControllerClipLoaded = async (
    clipName: string,
  ): Promise<string | null> => {
    if (!controllerState || !animation || !clipName) return null;
    if (animation.clipNames.includes(clipName)) return clipName;
    const state = controllerState.states.find((entry) => entry.clipName === clipName);
    const source = (
      state
        ? controllerState.sources.find((entry) => entry.id === state.sourceId)
        : null
    ) ?? controllerState.sources.find(
      (entry) => entry.label === clipName
        || entry.id.endsWith(`-${clipName.replaceAll('_', '-')}`),
    );
    if (!source) {
      // UAL clips are registered by the default library load — no source entry.
      return animation.clipNames.includes(clipName) ? clipName : null;
    }
    let pending = controllerSourceLoads.get(source.id);
    if (!pending) {
      pending = animation.loadAnimationSource(
        source.url,
        clipName,
        source.yawOffsetDegrees,
        { activate: false },
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
    return animation.clipNames.includes(clipName) ? clipName : null;
  };

  const loadControllerStateClip = async (
    locomotion: AnimationLocomotionKind,
    stanceId: string,
  ): Promise<string | null> => {
    if (!controllerState) return null;
    const state = resolveControllerState(controllerState, locomotion, stanceId);
    if (!state) return null;
    return ensureControllerClipLoaded(state.clipName);
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
    setStageStatus(
      `Controller preview · ${selectedStanceId} ${previewLocomotion} → ${clipName}`,
    );
    notifyUiChange();
  };

  const resolvePlayTestUpperBodyAim = (): {
    pitchRadians: number;
    yawRadians: number;
  } | null => {
    if (!playTestHardAim) return null;
    camera.getWorldDirection(playTestUpperAimView).normalize();
    playTestUpperAimUp
      .set(playTestCharacter.up.x, playTestCharacter.up.y, playTestCharacter.up.z)
      .normalize();
    playTestUpperAimForward
      .set(
        playTestCharacter.forward.x,
        playTestCharacter.forward.y,
        playTestCharacter.forward.z,
      )
      .addScaledVector(playTestUpperAimUp, -playTestUpperAimForward.dot(playTestUpperAimUp))
      .normalize();
    playTestUpperAimPlanarView
      .copy(playTestUpperAimView)
      .addScaledVector(playTestUpperAimUp, -playTestUpperAimView.dot(playTestUpperAimUp));

    let yawRadians = 0;
    if (
      playTestUpperAimPlanarView.lengthSq() > 1e-8
      && playTestUpperAimForward.lengthSq() > 1e-8
    ) {
      playTestUpperAimPlanarView.normalize();
      yawRadians = Math.atan2(
        playTestUpperAimUp.dot(
          playTestUpperAimCross.crossVectors(
            playTestUpperAimForward,
            playTestUpperAimPlanarView,
          ),
        ),
        THREE.MathUtils.clamp(
          playTestUpperAimForward.dot(playTestUpperAimPlanarView),
          -1,
          1,
        ),
      );
    }

    return {
      pitchRadians: THREE.MathUtils.clamp(
        Math.asin(
          THREE.MathUtils.clamp(playTestUpperAimView.dot(playTestUpperAimUp), -1, 1),
        ),
        -PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH,
        PLAY_TEST_MAX_UPPER_BODY_AIM_PITCH,
      ),
      yawRadians: THREE.MathUtils.clamp(
        yawRadians,
        -PLAY_TEST_MAX_UPPER_BODY_AIM_YAW,
        PLAY_TEST_MAX_UPPER_BODY_AIM_YAW,
      ),
    };
  };

  const syncPlayTestAnimation = async (
    force = false,
    locomotion?: {
      isMoving?: boolean;
      isCrouching?: boolean;
      gait?: WalkGait;
      jumpPhase?: JumpPhase;
    },
  ): Promise<void> => {
    if (!playTestActive || !animation || !controllerState) return;
    const { stanceId, stateKey, previewLocomotion: nextPreviewLocomotion } =
      buildPlayTestAnimationStateKey({
        playTestWeaponSlotId,
        playTestHardAim,
        locomotion,
      });
    if (!force && stateKey === playTestAnimationKey) return;
    playTestAnimationKey = stateKey;
    previewLocomotion = nextPreviewLocomotion;
    selectedStanceId = stanceId;
    const generation = ++playTestAnimationGeneration;
    renderPlayTestHud();
    try {
      const applied = await applyPlayTestAnimationLayers({
        animation,
        stanceId,
        playTestHardAim,
        locomotion,
        generation,
        playTestAnimationGeneration,
        isPlayTestActive: () => playTestActive,
        ensureControllerClipLoaded,
        ensureAnimatedPose,
        setStageStatus,
      });
      if (!applied) return;
      renderPlayTestHud();
      notifyUiChange();
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
    playTestControls?.setCombatInputActive(playTestWeaponSlotId !== null);
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
      stanceIdForWeaponSlot(playTestWeaponSlotId),
      playTestHardAim ? 'aiming' : null,
      animation?.activeClipName || 'loading animation',
    ].filter(Boolean).join(' · ');
  }

  function updatePlayTest(deltaSeconds: number): void {
    if (!playTestControls || !controllerState) return;
    playTestControls.setMode('on-foot');
    const actions = playTestControls.consumeActions();
    if (actions.weaponSlotPress) {
      const slotId = WEAPON_SELECT_SLOT_IDS[actions.weaponSlotPress - 1] ?? null;
      if (slotId) void selectPlayTestWeapon(slotId);
    }
    const cameraState = playTestControls.sampleCameraState(deltaSeconds);
    const input = playTestControls.sampleCharacterInput();
    const stanceId = stanceIdForWeaponSlot(playTestWeaponSlotId);

    const intent = resolveWalkInputIntent({
      ...input,
      jumpPressed: actions.jumpPressed,
    });
    playTestHardAim = resolveWalkAiming(
      playTestWeaponSlotId !== null && playTestControls.isSecondaryClickHeld(),
      intent,
    );
    const poseAiming = playTestHardAim;
    const flatOrbit = resolveDeckCameraOrbit(
      PLAY_TEST_STAGE_FORWARD,
      PLAY_TEST_WORLD_UP,
      cameraState.yawRadians,
      0,
      ORBIT_PITCH_LIMIT,
    );
    const moveDir = add(
      scale(flatOrbit.right, intent.moveX),
      scale(flatOrbit.forward, intent.moveY),
    );
    const desiredDirection = intent.isMoving && Math.hypot(moveDir.x, moveDir.z) > 1e-4
      ? normalize({ x: moveDir.x, y: 0, z: moveDir.z })
      : vec3(0, 0, 0);
    const cameraForward = normalize({
      x: flatOrbit.forward.x,
      y: 0,
      z: flatOrbit.forward.z,
    });

    const motion = integrateCharacterLocomotion(
      playTestCharacter,
      {
        wantsJump: intent.wantsJump,
        wantsSprint: intent.isSprinting,
        isMoving: intent.isMoving,
        desiredDirection,
        moveSpeed: intent.moveSpeedMetersPerSecond,
      },
      deltaSeconds,
      PLAY_TEST_WORLD_UP,
      PLAY_TEST_GRAVITY_METERS_PER_SECOND_SQUARED,
      {
        onGroundedStep: () => {
          let position = playTestCharacter.position;
          if (intent.isMoving) {
            position = clampPlayTestToStage(
              add(position, scale(desiredDirection, intent.moveSpeedMetersPerSecond * deltaSeconds)),
            );
          }
          return {
            position: { x: position.x, y: 0, z: position.z },
            up: PLAY_TEST_WORLD_UP,
          };
        },
        tryLand: (candidate) => {
          if (candidate.y > 0) return null;
          const clamped = clampPlayTestToStage(candidate);
          return {
            position: { x: clamped.x, y: 0, z: clamped.z },
            up: PLAY_TEST_WORLD_UP,
          };
        },
      },
    );

    const forward = resolveWalkFacing(
      {
        currentForward: playTestCharacter.forward,
        moveDirection: desiredDirection,
        cameraForward,
        up: PLAY_TEST_WORLD_UP,
        aiming: poseAiming,
        lockFacingToCamera: shouldLockFacingToCamera(poseAiming),
      },
      deltaSeconds,
    );
    const layers = animationLayersFromState({
      stanceId,
      aiming: poseAiming,
      isMoving: intent.isMoving,
      isCrouching: intent.isCrouching,
      gait: intent.gait,
      jumpPhase: motion.jumpPhase,
    });
    playTestCharacter = {
      ...playTestCharacter,
      animation: layers.baseClip,
      upperBodyAnimation: layers.upperClip,
      forward,
      grounded: motion.grounded,
      jumpPhase: motion.jumpPhase,
      jumpPhaseTime: motion.jumpPhaseTime,
      position: motion.position,
      up: motion.up,
      velocity: motion.velocity,
    };

    previewRoot.position.set(
      playTestCharacter.position.x,
      playTestCharacter.position.y,
      playTestCharacter.position.z,
    );
    previewRoot.rotation.y = Math.atan2(
      playTestCharacter.forward.x,
      playTestCharacter.forward.z,
    );

    const aimZoomTarget = playTestHardAim ? 1 : 0;
    playTestAimZoom01 += (aimZoomTarget - playTestAimZoom01)
      * (1 - Math.exp(
        (-Math.LN2 * deltaSeconds) / PLAY_TEST_WEAPON_AIM_ZOOM_HALF_LIFE_SECONDS,
      ));
    const orbit = resolveDeckCameraOrbit(
      PLAY_TEST_STAGE_FORWARD,
      PLAY_TEST_WORLD_UP,
      cameraState.yawRadians,
      cameraState.pitchRadians,
      ORBIT_PITCH_LIMIT,
    );
    const zoomDistance = cameraState.zoomDistance
      * (1 - (1 - PLAY_TEST_WEAPON_AIM_ZOOM_SCALE) * playTestAimZoom01);
    const rig = resolveCharacterCameraRig(orbit, zoomDistance);
    playTestDesiredCameraPos.set(
      playTestCharacter.position.x + rig.positionOffset.x,
      playTestCharacter.position.y + rig.positionOffset.y,
      playTestCharacter.position.z + rig.positionOffset.z,
    );
    playTestDesiredCameraTarget.set(
      playTestCharacter.position.x + rig.targetOffset.x,
      playTestCharacter.position.y + rig.targetOffset.y,
      playTestCharacter.position.z + rig.targetOffset.z,
    );
    smoothPlayTestVector(playTestSmoothedCameraPos, playTestDesiredCameraPos, deltaSeconds, 0.05);
    smoothPlayTestVector(
      playTestSmoothedCameraTarget,
      playTestDesiredCameraTarget,
      deltaSeconds,
      0.04,
    );
    camera.position.copy(playTestSmoothedCameraPos);
    camera.up.set(
      PLAY_TEST_WORLD_UP.x,
      PLAY_TEST_WORLD_UP.y,
      PLAY_TEST_WORLD_UP.z,
    );
    // Keep OrbitControls.target on the pre-play-test pivot so authoring framing
    // is intact when play test stops (do not follow the stage character).
    camera.lookAt(playTestSmoothedCameraTarget);

    controllerUpperBodyAim?.setTarget(resolvePlayTestUpperBodyAim());
    void syncPlayTestAnimation(false, {
      isMoving: intent.isMoving,
      isCrouching: intent.isCrouching,
      gait: intent.gait,
      jumpPhase: motion.jumpPhase,
    });
  }

  const stopPlayTestControls = (): void => {
    playTestControls?.setCombatInputActive(false);
    playTestControls?.setInputSuppressed(true);
    playTestControls?.dispose();
    playTestControls = null;
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  };

  const setPlayTestActive = async (nextActive: boolean): Promise<void> => {
    if (nextActive === playTestActive) return;
    if (nextActive) {
      try {
        authoringCameraSuspended = true;
        endFly();
        await ensureAvatar();
        if (!avatar || !documentState) throw new Error('Base Character is still loading.');
        playTestPoseBefore = previewPose;
        playTestStanceBefore = selectedStanceId;
        playTestLocomotionBefore = previewLocomotion;
        playTestClipBefore = animation?.activeClipName || 'Idle_Loop';
        playTestCameraPositionBefore.copy(camera.position);
        playTestCameraTargetBefore.copy(controls.target);
        controls.saveState();
        equipDefaultPlayTestLoadout();
        // Play Test must resolve clips from the same controller document as authoring.
        if (controllerState?.id === 'default') {
          setDefaultAnimationController(controllerState);
        }
        playTestActive = true;
        playTestWeaponSlotId = null;
        playTestCharacter = createPlayTestCharacterState();
        playTestHardAim = false;
        playTestAimZoom01 = 0;
        playTestAnimationKey = '';
        previewRoot.position.set(0, 0, 0);
        previewRoot.rotation.set(0, 0, 0);
        gizmo.detach();
        controls.enabled = false;
        stopPlayTestControls();
        playTestControls = createPlayerControls(canvas);
        playTestControls.setMode('on-foot');
        playTestControls.setOrbitFacing(0, -0.35);
        playTestControls.setCombatInputActive(false);
        playTestSmoothedCameraPos.set(0, 1.7, 4.4);
        playTestSmoothedCameraTarget.set(0, 0.95, 0);
        camera.position.copy(playTestSmoothedCameraPos);
        camera.lookAt(playTestSmoothedCameraTarget);
        renderPlayTestHud();
        await setPreviewPose('animated');
        await rebuildEquipmentPreview();
        setStageStatus(
          'Play test active — same on-foot camera/controls as the game. Click the stage to look; Esc returns to authoring.',
        );
        await syncPlayTestAnimation(true);
        canvas.focus();
        notifyUiChange();
        notifyUiChange();
      } catch (error) {
        stopPlayTestControls();
        playTestActive = false;
        authoringCameraSuspended = false;
        restoreAuthoringCamera();
        renderPlayTestHud();
        setStageStatus(
          error instanceof Error ? error.message : 'Could not start Base Character play test.',
          true,
        );
      }
      return;
    }

    authoringCameraSuspended = true;
    playTestActive = false;
    playTestAnimationGeneration += 1;
    stopPlayTestControls();
    playTestWeaponSlotId = null;
    playTestCharacter = createPlayTestCharacterState();
    playTestHardAim = false;
    playTestAimZoom01 = 0;
    playTestAnimationKey = '';
    resetPlayTestStageTransform();
    controllerUpperBodyAim?.setTarget(null);
    controllerUpperBodyAim?.restore();
    animation?.setUpperBodyAnimation(null, 0);
    animation?.setPlaying(false);
    if (avatar) restoreReferencePose(avatar.root);
    restoreAuthoringCamera();
    selectedStanceId = playTestStanceBefore;
    previewLocomotion = playTestLocomotionBefore;
    renderPlayTestHud();
    await rebuildEquipmentPreview();
    if (playTestPoseBefore === 'reference') {
      await setPreviewPose('reference');
    } else {
      animation?.setPlaying(true);
      animation?.setUpperBodyAnimation(null, 0);
      animation?.setAnimation(playTestClipBefore, 0.12);
    }
    // Async pose/prefab work can run while the render loop orbits; pin stage + camera again.
    resetPlayTestStageTransform();
    restoreAuthoringCamera();
    controls.saveState();
    authoringCameraSuspended = false;
    setStageStatus('Play test stopped. Authoring controls restored.');
    notifyUiChange();
    notifyUiChange();
    syncGizmo();
  };

  // Escape only — Digit 1–3 are consumed by playTestControls → updatePlayTest.
  // Handling them here too double-toggled draw/holster on a single press.
  const onPlayTestKeyDown = (event: KeyboardEvent): void => {
    if (!playTestActive) return;
    if (event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      void setPlayTestActive(false);
    }
  };

  window.addEventListener('keydown', onPlayTestKeyDown);
  canvas.addEventListener('pointerdown', () => {
    if (playTestActive) canvas.focus();
  });

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

  const uiState = {
    documentState: null as BaseCharacterEquipmentV1 | null,
    controllerState: null as AnimationControllerV1 | null,
    controllerList: [] as AnimationControllerListEntry[],
    selectedControllerId: 'default',
    controllerDirty: false,
    settingsState,
    settingsDirty: false,
    leftTab: 'equipment' as BaseCharacterLeftTab,
    selectedType: 1 as BaseCharacterType,
    previewPose: 'reference' as CharacterPreviewPose,
    selectedStanceId: 'unarmed',
    previewLocomotion: 'idle' as AnimationLocomotionKind,
    selectedSlotId: 'backpack',
    assignments,
    mountEditMode: 'holster' as MountEditMode,
    simulateDrawnSlotId: null as string | null,
    gizmoMode: 'translate' as EquipmentGizmoMode,
    gizmoSpace: 'local' as 'local' | 'world',
    catalogMessage,
    weapons,
    backpacks,
    playTestActive,
    playTestWeaponSlotId: null as WeaponSelectSlotId | null,
    animation: null as SidekickAnimationRuntime | null,
    lastLoadedSourceId,
    animationObjectUrl: null as string | null,
  };

  const syncClosureToUiState = (): void => {
    uiState.documentState = documentState;
    uiState.controllerState = controllerState;
    uiState.controllerList = controllerList;
    uiState.selectedControllerId = selectedControllerId;
    uiState.controllerDirty = controllerDirty;
    uiState.settingsState = settingsState;
    uiState.settingsDirty = settingsDirty;
    uiState.leftTab = leftTab;
    uiState.selectedType = selectedType;
    uiState.previewPose = previewPose;
    uiState.selectedStanceId = selectedStanceId;
    uiState.previewLocomotion = previewLocomotion;
    uiState.selectedSlotId = selectedSlotId;
    uiState.assignments = assignments;
    uiState.mountEditMode = mountEditMode;
    uiState.simulateDrawnSlotId = simulateDrawnSlotId;
    uiState.gizmoMode = gizmoMode;
    uiState.gizmoSpace = gizmoSpace;
    uiState.catalogMessage = catalogMessage;
    uiState.weapons = weapons;
    uiState.backpacks = backpacks;
    uiState.playTestActive = playTestActive;
    uiState.playTestWeaponSlotId = playTestWeaponSlotId;
    uiState.animation = animation;
    uiState.lastLoadedSourceId = lastLoadedSourceId;
    uiState.animationObjectUrl = animationObjectUrl;
  };

  const syncUiStateToClosure = (): void => {
    documentState = uiState.documentState;
    controllerState = uiState.controllerState;
    controllerList = uiState.controllerList;
    selectedControllerId = uiState.selectedControllerId;
    controllerDirty = uiState.controllerDirty;
    settingsState = uiState.settingsState;
    settingsDirty = uiState.settingsDirty;
    leftTab = uiState.leftTab;
    selectedType = uiState.selectedType;
    previewPose = uiState.previewPose;
    selectedStanceId = uiState.selectedStanceId;
    previewLocomotion = uiState.previewLocomotion;
    selectedSlotId = uiState.selectedSlotId;
    assignments = uiState.assignments;
    mountEditMode = uiState.mountEditMode;
    simulateDrawnSlotId = uiState.simulateDrawnSlotId;
    gizmoMode = uiState.gizmoMode;
    gizmoSpace = uiState.gizmoSpace;
    catalogMessage = uiState.catalogMessage;
    weapons = uiState.weapons;
    backpacks = uiState.backpacks;
    playTestActive = uiState.playTestActive;
    playTestWeaponSlotId = uiState.playTestWeaponSlotId;
    animation = uiState.animation;
    lastLoadedSourceId = uiState.lastLoadedSourceId;
    animationObjectUrl = uiState.animationObjectUrl;
  };

  const uiApi = createBaseCharacterEditorUiApi({
    getState: () => uiState,
    state: uiState,
    hasUnsavedChanges,
    notifyUiChange: () => {
      syncUiStateToClosure();
      syncClosureToUiState();
      notifyUiChange();
    },
    markDirty,
    markControllerDirty,
    markSettingsDirty,
    markBackpackPrefabDirty,
    markWeaponPrefabDirty,
    currentSlot,
    currentMount,
    currentDrawnMount,
    currentTransformTarget,
    displayNumber,
    transformEulerDegrees,
    setTransformEulerDegrees,
    applyTransform,
    gizmo,
    save,
    loadDocument,
    setPreviewPose,
    applyCharacterType,
    previewControllerState,
    rebuildEquipmentPreview,
    refreshCatalog,
    assignDefinition,
    loadController,
    loadAnimationFromAsset,
    loadWeaponPrefabDraft,
    ensureDrawnGripEntity,
    setPlayTestActive,
    equipDefaultPlayTestLoadout,
    assignClipToState,
    ensureAnimatedPose,
    ensureAvatar,
    revokeAnimationObjectUrl,
    setStageStatus,
    syncGizmo,
    setGizmoModeInternal: (mode) => {
      if (playTestActive) return;
      gizmoMode = mode;
      gizmo.setMode(mode);
      notifyUiChange();
    },
    setDefaultAnimationController,
    get avatar() { return avatar; },
    get defaultDefinition() { return defaultDefinition; },
  });

  notifyUiChangeRef.current = (): void => {
    syncUiStateToClosure();
    syncClosureToUiState();
    onUiChange();
  };

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
      notifyUiChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Base Character load failed.';
      if (/sidekick|manifest/i.test(message)) {
        setPackMissing(
          true,
          `Sidekick pack missing or invalid (${message}). Use Tools → Locate Synty Sidekick Pack…`,
        );
      } else {
        setStageStatus(message, true);
      }
    }
  }

  async function reloadSidekickPack(): Promise<void> {
    invalidateSidekickCatalog();
    disposeAvatarPreview();
    readyPromise = null;
    setPackMissing(false);
    setStageStatus('Reloading Sidekick pack…');
    await ensureReady();
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
        // Disk is source of truth for Play Mode; keep the shared runtime cache aligned.
        if (controllerState.id === 'default') {
          setDefaultAnimationController(controllerState);
        }
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
      notifyUiChange();
    } catch (error) {
      setStageStatus(error instanceof Error ? error.message : 'Base Character save failed.', true);
    }
  }

  return {
    activate: () => {
      void ensureReady();
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
    reloadSidekickPack,
    getLeftPanel: () => leftHost,
    getRightPanel: () => rightHost,
    getUiApi: () => uiApi,
    dispose: () => {
      disposed = true;
      endFly();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onPlayTestKeyDown);
      window.removeEventListener('keydown', onFlyKey);
      window.removeEventListener('keyup', onFlyKey);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      stopPlayTestControls();
      controllerSourceLoads.clear();
      gizmo.detach();
      controls.dispose();
      gizmo.dispose();
      animation?.dispose();
      controllerUpperBodyAim?.dispose();
      revokeAnimationObjectUrl();
      avatar?.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      stage.remove();
    },
  };
}
