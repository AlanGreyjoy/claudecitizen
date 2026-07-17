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
  cloneBaseCharacterEquipment,
  identityCharacterMount,
  parseBaseCharacterEquipment,
  type BaseCharacterEquipmentV1,
  type BaseCharacterType,
  type CharacterBoneMountV1,
  type CharacterEquipmentSlotV1,
} from '../../player/equipment/base_character_equipment';
import { buildDefaultDefinition, findPreviewSpecies, loadSidekickCatalog } from '../../player/character_creator/sidekick_catalog';
import type { SidekickCharacterDefinitionV2 } from '../../player/character_creator/sidekick_definition';
import { fetchBaseCharacterEquipment, saveBaseCharacterEquipment, savePrefab } from '../../editor/api';
import { assembleSidekickCharacter, type SidekickAvatarInstance } from '../characters/sidekick/assemble_avatar';
import { createSidekickAnimationRuntime, type SidekickAnimationRuntime } from '../characters/sidekick/animation_runtime';
import { createPropInstanceGroup } from '../prefabs/prefab_renderer';
import { loadPrefabDocument } from '../../world/prefabs/loader';
import { collectEquipmentSockets, validateBackpackPrefab } from '../../world/prefabs/item_runtime';
import {
  parsePrefabDocument,
  type PrefabDocument,
  type PrefabEntity,
  type PrefabTransform,
} from '../../world/prefabs/schema';
import type { WeaponSlotType } from '../../types/equipment';

const ATTACHMENT_BONES = ['backAttach', 'hipAttach_l', 'hipAttach_r', 'hipAttachFront', 'hipAttachBack'];
const EQUIPMENT_DND_TYPE = 'application/x-claudecitizen-equipment-definition';

type CatalogDefinition = WeaponDefinition | BackpackDefinition;
type CharacterPreviewPose = 'reference' | 'idle';
type EquipmentGizmoMode = 'translate' | 'rotate' | 'scale';

export interface BaseCharacterEquipmentEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  setGizmoMode: (mode: EquipmentGizmoMode) => void;
  save: () => Promise<void>;
  dispose: () => void;
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
  if (slot.kind === 'backpack') return definition.itemType === 'backpack';
  return definition.itemType === 'weapon' && definition.weaponSlotType === slot.weaponSlotType;
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
  const stageStatus = document.createElement('div');
  stageStatus.className = 'ed-base-stage-status';
  stage.append(canvas, stageStatus);
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
    new THREE.CircleGeometry(3, 64),
    new THREE.MeshStandardMaterial({ color: 0x17243a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(0, 1.25, 2.8);
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
  let selectedType: BaseCharacterType = 1;
  let previewPose: CharacterPreviewPose = 'reference';
  let gizmoMode: EquipmentGizmoMode = 'translate';
  let gizmoSpace: 'local' | 'world' = 'local';
  let selectedSlotId = 'backpack';
  let dirty = false;
  let active = false;
  let disposed = false;
  let initialized = false;
  let avatar: SidekickAvatarInstance | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let defaultDefinition: SidekickCharacterDefinitionV2 | null = null;
  let mountPivots = new Map<string, THREE.Group>();
  let activeBackpackPrefabId: string | null = null;
  let backpackSocketObjects = new Map<string, THREE.Object3D>();
  let backpackSocketEntities = new Map<string, PrefabEntity>();
  const backpackPrefabDrafts = new Map<string, PrefabDocument>();
  const dirtyBackpackPrefabIds = new Set<string>();
  const previewRoot = new THREE.Group();
  let assignments = new Map<string, CatalogDefinition>();
  let weapons: WeaponDefinition[] = [];
  let backpacks: BackpackDefinition[] = [];
  let previewGeneration = 0;
  let catalogMessage = 'Catalog not loaded.';
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
    controls.update();
    const deltaSeconds = clock.getDelta();
    if (previewPose === 'idle') animation?.update(deltaSeconds);
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

  const markBackpackPrefabDirty = (prefabId: string): void => {
    dirtyBackpackPrefabIds.add(prefabId);
    renderLeft();
  };

  const hasUnsavedChanges = (): boolean => dirty || dirtyBackpackPrefabIds.size > 0;

  const currentSlot = (): CharacterEquipmentSlotV1 | null =>
    documentState?.slots.find((slot) => slot.id === selectedSlotId) ?? null;

  const currentMount = (): CharacterBoneMountV1 | null =>
    documentState?.variants[String(selectedType) as '1' | '2'].mounts[selectedSlotId] ?? null;

  const currentTransformTarget = (): {
    object: THREE.Object3D;
    transform: PrefabTransform;
    source: 'character' | 'backpack-socket';
    prefabId?: string;
    label: string;
  } | null => {
    const slot = currentSlot();
    if (!slot) return null;
    if (slot.requiresSlotId && !assignments.has(slot.requiresSlotId)) return null;
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
        ? `Type ${selectedType} fallback character mount`
        : `Type ${selectedType} character mount`,
    };
  };

  const syncGizmo = (): void => {
    const target = currentTransformTarget();
    if (target) gizmo.attach(target.object);
    else gizmo.detach();
  };

  const setGizmoMode = (mode: EquipmentGizmoMode): void => {
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

  const loadPreviewItem = async (definition: CatalogDefinition): Promise<THREE.Group> => {
    if (!definition.prefabId) return placeholder(0xff3fa4);
    const prefab = await loadPrefabDocument(definition.prefabId);
    return prefab ? createPropInstanceGroup(prefab) : placeholder(0xff3fa4);
  };

  const rebuildEquipmentPreview = async (): Promise<void> => {
    if (!documentState || !avatar) return;
    const generation = ++previewGeneration;
    gizmo.detach();
    for (const pivot of mountPivots.values()) pivot.removeFromParent();
    for (const child of [...previewRoot.children]) {
      if (child !== avatar.root) previewRoot.remove(child);
    }
    mountPivots = new Map();
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
      const item = await loadPreviewItem(definition);
      if (generation !== previewGeneration) return;
      const socket = slot.providerSocket ? backpackSockets.get(slot.providerSocket.socketId) : null;
      if (socket && backpackRoot) socket.add(item);
      else if (!slot.requiresSlotId) mountPivots.get(slot.id)?.add(item);
    }
    syncGizmo();
    renderLeft();
    renderInspector();
  };

  const applyCharacterType = async (): Promise<void> => {
    if (!avatar || !defaultDefinition) return;
    const definition = structuredClone(defaultDefinition);
    definition.name = `Base Character Type ${selectedType}`;
    definition.blendShapes.bodyTypeValue = selectedType === 1 ? -100 : 100;
    if (previewPose === 'reference') restoreReferencePose(avatar.root);
    await avatar.applyDefinition(definition);
    await rebuildEquipmentPreview();
  };

  const setPreviewPose = async (nextPose: CharacterPreviewPose): Promise<void> => {
    if (previewPose === nextPose) return;
    previewPose = nextPose;
    renderLeft();
    if (!avatar) return;
    if (previewPose === 'reference') {
      setStageStatus('Reference pose active. Character mounts now use a stable bind-pose basis.');
      await applyCharacterType();
      return;
    }
    animation?.setAnimation('Idle_Loop', 0);
    animation?.update(0);
    setStageStatus('Idle_Loop preview active. Equipment follows the animated attachment bones.');
  };

  const ensureAvatar = async (): Promise<void> => {
    if (avatar) return;
    setStageStatus('Loading default Synty character…');
    const catalog = await loadSidekickCatalog();
    const species = findPreviewSpecies(catalog);
    if (!species) throw new Error('No playable Synty species is available.');
    defaultDefinition = buildDefaultDefinition(catalog, species);
    defaultDefinition.blendShapes.bodyTypeValue = -100;
    avatar = await assembleSidekickCharacter(catalog, defaultDefinition);
    previewRoot.add(avatar.root);
    animation = await createSidekickAnimationRuntime(avatar.root).catch((error: unknown) => {
      console.warn('Base character idle animation unavailable.', error);
      return null;
    });
    animation?.setAnimation('Idle_Loop', 0);
    controls.target.set(0, 1, 0);
    camera.position.set(0, 1.2, 2.75);
    controls.update();
  };

  const refreshCatalog = async (): Promise<void> => {
    catalogMessage = 'Refreshing Admin catalog…';
    renderInspector();
    try {
      [weapons, backpacks] = await Promise.all([listWeaponDefinitions(), listBackpackDefinitions()]);
      catalogMessage = `${weapons.length} weapons · ${backpacks.length} backpacks`;
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

  function renderLeft(): void {
    left.replaceChildren();
    const title = document.createElement('div');
    title.className = 'ed-base-panel-title';
    title.textContent = 'Base Characters';
    const saveButton = button(hasUnsavedChanges() ? 'Save *' : 'Save', () => void save());
    const reload = button('Reload', () => void loadDocument());
    const toolbar = document.createElement('div');
    toolbar.className = 'ed-base-actions';
    toolbar.append(saveButton, reload);
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
    for (const [label, pose] of [['Reference Pose', 'reference'], ['Idle Preview', 'idle']] as const) {
      const node = button(label, () => void setPreviewPose(pose));
      node.classList.toggle('is-active', previewPose === pose);
      poses.append(node);
    }
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
    left.append(title, toolbar, types, poseLabel, poses, slots, add);
  }

  function renderInspector(): void {
    right.replaceChildren();
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
      for (const candidate of documentState.slots) {
        if (candidate.requiresSlotId === slot.id) delete candidate.requiresSlotId;
        if (candidate.providerSocket?.slotId === slot.id) delete candidate.providerSocket;
      }
      assignments.delete(slot.id);
      selectedSlotId = documentState.slots[0]?.id ?? '';
      update();
      renderLeft();
    });
    slotSection.append(remove);

    const transformSection = document.createElement('section');
    transformSection.className = 'ed-base-section';
    const transformTitle = document.createElement('h3');
    const transformTarget = currentTransformTarget();
    transformTitle.textContent = transformTarget?.label ?? 'Transform unavailable';
    transformSection.append(transformTitle);
    if (!transformTarget) {
      const unavailable = document.createElement('p');
      unavailable.className = 'ed-base-warning';
      unavailable.textContent = slot.requiresSlotId
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
    if (transformTarget?.source === 'character') {
      transformSection.append(field('Bone', select(mount.bone, ATTACHMENT_BONES.map((bone) => ({ value: bone, label: bone })), (value) => {
        mount.bone = value;
        update();
      })));
    } else if (transformTarget?.source === 'backpack-socket') {
      const note = document.createElement('p');
      note.className = 'ed-base-note';
      note.textContent = 'Editing the backpack item prefab. Saving will persist this resting weapon position for every character using this backpack.';
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
    right.append(slotSection, transformSection, catalogSection);
  }

  async function loadDocument(): Promise<void> {
    if (hasUnsavedChanges() && !window.confirm('Discard unsaved Base Character and backpack socket changes?')) return;
    setStageStatus('Loading Base Character equipment…');
    try {
      documentState = cloneBaseCharacterEquipment(await fetchBaseCharacterEquipment());
      selectedSlotId = documentState.slots[0]?.id ?? '';
      assignments = new Map();
      dirty = false;
      dirtyBackpackPrefabIds.clear();
      backpackPrefabDrafts.clear();
      await ensureAvatar();
      await applyCharacterType();
      renderLeft();
      renderInspector();
    } catch (error) {
      setStageStatus(error instanceof Error ? error.message : 'Base Character load failed.', true);
    }
  }

  async function save(): Promise<void> {
    if (!documentState) return;
    try {
      const savedPaths: string[] = [];
      if (dirty) {
        const parsed = parseBaseCharacterEquipment(documentState);
        const path = await saveBaseCharacterEquipment(parsed);
        documentState = cloneBaseCharacterEquipment(parsed);
        dirty = false;
        savedPaths.push(path);
      }
      for (const prefabId of [...dirtyBackpackPrefabIds]) {
        const draft = backpackPrefabDrafts.get(prefabId);
        if (!draft) continue;
        const parsed = parsePrefabDocument(draft);
        const path = await savePrefab(parsed);
        backpackPrefabDrafts.set(prefabId, parsed);
        dirtyBackpackPrefabIds.delete(prefabId);
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
    },
    canLeave: () => !hasUnsavedChanges() || window.confirm('Leave Base Characters with unsaved character or backpack socket changes?'),
    isDirty: hasUnsavedChanges,
    setGizmoMode,
    save,
    dispose: () => {
      disposed = true;
      resizeObserver.disconnect();
      gizmo.detach();
      controls.dispose();
      gizmo.dispose();
      animation?.dispose();
      avatar?.dispose();
      environmentTarget.dispose();
      renderer.dispose();
    },
  };
}
