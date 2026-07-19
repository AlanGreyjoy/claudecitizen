import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTER_GROUND_OFFSET_METERS } from '../../../player/character_controller';
import type { CharacterRenderState, Vec3 } from '../../../types';
import {
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
} from '../../characters/unity_humanoid_retarget';
import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player_character_appearance';
import { createSidekickGameplayAvatar } from '../../characters/sidekick/gameplay_avatar';
import { applyDefaultFrustumCulling } from '../../frustum_policy';

const UAL_AVATAR_URL = UNIVERSAL_ANIMATION_LIBRARY_URL;
const PROTECTED_CHARACTER_URL_PREFIX = '/src/assets/protected/characters/';
const DEFAULT_CHARACTER_AVATAR_ID = 'ual-mannequin';
const FALLBACK_CHARACTER_AVATAR_ID = 'ual-mannequin';

export const CHARACTER_ANIMATION_TIME_SCALE = 1.35;

const LOOPING_CLIPS = new Set([
  'Idle_Loop',
  'Jump_Loop',
  'Sprint_Loop',
  'Walk_Loop',
]);

type CharacterAvatarRig = 'three-gltf' | 'unity-humanoid';
type AvatarAnimationBinding = 'scene' | 'skinned-mesh';

interface CharacterAvatarSpec {
  animationUrl?: string;
  id: string;
  label: string;
  modelUrl: string;
  rig: CharacterAvatarRig;
  visibleBodyMeshNames?: string[];
}

interface AvatarAsset {
  animationBinding: AvatarAnimationBinding;
  animations: THREE.AnimationClip[];
  id: string;
  template: THREE.Object3D;
}

export interface CharacterAvatarInstance {
  root: THREE.Group;
  dispose: () => void;
  getHeadBone: () => THREE.Object3D | null;
  hasLoadError: () => boolean;
  isReady: () => boolean;
  setAnimation: (name: string) => void;
  setPose: (character: CharacterRenderState, focusPosition: Vec3, renderScale: number) => void;
  updateMixer: (nowSeconds: number, timeScale?: number) => void;
  /** Attach equipped backpack/weapons from personal inventory loadout; optional drawn hotbar slot. */
  setEquippedInventory?: (
    inventory: import('../../../player/inventory/types').InventoryState | null,
    activeWeaponSlotId?: string | null,
  ) => void;
}

let avatarAssetPromise: Promise<AvatarAsset> | null = null;
let avatarLoadError: unknown = null;

const CHARACTER_AVATAR_CATALOG: Record<string, CharacterAvatarSpec> = {
  [FALLBACK_CHARACTER_AVATAR_ID]: {
    id: FALLBACK_CHARACTER_AVATAR_ID,
    label: 'UAL mannequin',
    modelUrl: UAL_AVATAR_URL,
    rig: 'three-gltf',
  },
  'space-suit-male': {
    animationUrl: UAL_AVATAR_URL,
    id: 'space-suit-male',
    label: 'POLYGON Sci-Fi Worlds space suit male',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_SpaceSuit_Male_01.glb`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_SpaceSuit_Male_01'],
  },
  'soldier-male': {
    animationUrl: UAL_AVATAR_URL,
    id: 'soldier-male',
    label: 'POLYGON Sci-Fi Worlds soldier male',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_Soldier_Male_01.glb`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_Soldier_Male_01'],
  },
  'strider-male': {
    animationUrl: UAL_AVATAR_URL,
    id: 'strider-male',
    label: 'POLYGON Sci-Fi Worlds strider male',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_Strider_Male_01.glb`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_Strider_Male_01'],
  },
  'alien-armor': {
    animationUrl: UAL_AVATAR_URL,
    id: 'alien-armor',
    label: 'POLYGON Sci-Fi Worlds alien armor',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_AlienArmor_01.glb`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_AlienArmor_01'],
  },
  'alien-chef': {
    animationUrl: UAL_AVATAR_URL,
    id: 'alien-chef',
    label: 'POLYGON Sci-Fi Worlds alien chef',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_AlienChef_01.gltf`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_AlienChef_01'],
  },
  'alien-combat': {
    animationUrl: UAL_AVATAR_URL,
    id: 'alien-combat',
    label: 'POLYGON Sci-Fi Worlds alien combat',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_AlienCombat_01.gltf`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_AlienCombat_01'],
  },
  'alien-rock': {
    animationUrl: UAL_AVATAR_URL,
    id: 'alien-rock',
    label: 'POLYGON Sci-Fi Worlds alien rock',
    modelUrl: `${PROTECTED_CHARACTER_URL_PREFIX}SM_Chr_ScifiWorlds_AlienRock_01.gltf`,
    rig: 'unity-humanoid',
    visibleBodyMeshNames: ['SM_Chr_ScifiWorlds_AlienRock_01'],
  },
};

export const CHARACTER_AVATAR_IDS = Object.freeze(Object.keys(CHARACTER_AVATAR_CATALOG));

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, resolve, undefined, reject);
  });
}

function requestedAvatarId(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('character') ?? params.get('avatar');
}

function avatarLoadCandidates(): CharacterAvatarSpec[] {
  const requested = requestedAvatarId();
  const selected =
    (requested && CHARACTER_AVATAR_CATALOG[requested]) ||
    CHARACTER_AVATAR_CATALOG[DEFAULT_CHARACTER_AVATAR_ID];
  const fallback = CHARACTER_AVATAR_CATALOG[FALLBACK_CHARACTER_AVATAR_ID];
  if (selected.id === fallback.id) return [fallback];
  return [selected, fallback];
}

function isSelectedBodyMeshName(objectName: string, bodyName: string): boolean {
  return objectName === bodyName || objectName.startsWith(`${bodyName}_`);
}

function prepareTemplateScene(sceneRoot: THREE.Object3D, spec: CharacterAvatarSpec): void {
  const visibleBodyMeshNames = new Set(spec.visibleBodyMeshNames ?? []);
  applyDefaultFrustumCulling(sceneRoot);
  sceneRoot.traverse((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      if (
        visibleBodyMeshNames.size > 0 &&
        object.name.startsWith('SM_Chr_ScifiWorlds_')
      ) {
        object.visible = [...visibleBodyMeshNames].some((name) =>
          isSelectedBodyMeshName(object.name, name),
        );
      }
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

async function loadAvatarSpec(spec: CharacterAvatarSpec): Promise<AvatarAsset> {
  const modelGltf = await loadGltf(spec.modelUrl);
  prepareTemplateScene(modelGltf.scene, spec);

  if (spec.rig === 'unity-humanoid') {
    const animationGltf =
      spec.animationUrl && spec.animationUrl !== spec.modelUrl
        ? await loadGltf(spec.animationUrl)
        : modelGltf;
    const animations = retargetUnityHumanoidAnimations(
      modelGltf.scene,
      animationGltf.scene,
      animationGltf.animations,
    );
    if (animations.length === 0) {
      throw new Error(`Character avatar "${spec.id}" has no retargetable animations.`);
    }
    return {
      animationBinding: 'skinned-mesh',
      animations,
      id: spec.id,
      template: modelGltf.scene,
    };
  }

  if (modelGltf.animations.length === 0) {
    throw new Error(`Character avatar "${spec.id}" has no animations.`);
  }
  return {
    animationBinding: 'scene',
    animations: modelGltf.animations,
    id: spec.id,
    template: modelGltf.scene,
  };
}

async function loadFirstAvailableAvatarAsset(): Promise<AvatarAsset> {
  let lastError: unknown = null;
  for (const spec of avatarLoadCandidates()) {
    try {
      return await loadAvatarSpec(spec);
    } catch (error: unknown) {
      lastError = error;
      console.warn(`ClaudeCitizen character avatar "${spec.id}" load failed.`, error);
    }
  }
  throw lastError ?? new Error('No character avatar could be loaded.');
}

function loadAvatarAsset(): Promise<AvatarAsset> {
  if (avatarLoadError) return Promise.reject(avatarLoadError);
  if (!avatarAssetPromise) {
    avatarAssetPromise = loadFirstAvailableAvatarAsset().catch((error: unknown) => {
      avatarLoadError = error;
      avatarAssetPromise = null;
      console.error('ClaudeCitizen avatar load failed.', error);
      throw error;
    });
  }
  return avatarAssetPromise;
}

function createLegacyCharacterAvatarInstance(renderScale: number): CharacterAvatarInstance {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.frustumCulled = false;
  root.add(modelOffset);

  const mixerClock: { lastNowSeconds: number | null } = { lastNowSeconds: null };
  let mixer: THREE.AnimationMixer | null = null;
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: string | null = null;
  let headBone: THREE.Object3D | null = null;
  let ready = false;
  let loadError: unknown = null;
  const modelOffsetPosition = new THREE.Vector3(
    0,
    -CHARACTER_GROUND_OFFSET_METERS * renderScale,
    0,
  );
  const actions = new Map<string, THREE.AnimationAction>();

  loadAvatarAsset()
    .then((asset) => {
      const sceneRoot = cloneSkinnedScene(asset.template);
      sceneRoot.scale.setScalar(renderScale);
      const bbox = new THREE.Box3().setFromObject(sceneRoot);
      const center = bbox.getCenter(new THREE.Vector3());
      modelOffsetPosition.set(
        -center.x,
        -bbox.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale,
        -center.z,
      );
      headBone = sceneRoot.getObjectByName('Head') ?? null;
      modelOffset.add(sceneRoot);
      const skinnedMesh = findFirstSkinnedMesh(sceneRoot);
      const mixerRoot =
        asset.animationBinding === 'skinned-mesh' && skinnedMesh ? skinnedMesh : sceneRoot;
      mixer = new THREE.AnimationMixer(mixerRoot);
      for (const clip of asset.animations) {
        const action = mixer.clipAction(clip);
        if (LOOPING_CLIPS.has(clip.name)) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions.set(clip.name, action);
      }
      const idle = actions.get('Idle_Loop');
      idle?.play();
      activeAction = idle ?? null;
      activeAnimation = idle ? 'Idle_Loop' : null;
      ready = true;
    })
    .catch((error: unknown) => {
      loadError = error;
    });

  function setAnimation(name: string): void {
    if (!mixer || !name || activeAnimation === name) return;
    const nextAction = actions.get(name);
    if (!nextAction) return;
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.fadeIn(0.16);
    nextAction.play();
    activeAction?.fadeOut(0.16);
    activeAction = nextAction;
    activeAnimation = name;
  }

  function setPose(
    character: CharacterRenderState,
    focusPosition: Vec3,
    scale: number,
  ): void {
    root.position.set(
      (character.position.x - focusPosition.x) * scale,
      (character.position.y - focusPosition.y) * scale,
      (character.position.z - focusPosition.z) * scale,
    );
    root.up.set(character.up.x, character.up.y, character.up.z);
    root.lookAt(
      root.position.x + character.forward.x * 8 * scale,
      root.position.y + character.forward.y * 8 * scale,
      root.position.z + character.forward.z * 8 * scale,
    );
    modelOffset.position.copy(modelOffsetPosition);
  }

  function updateMixer(nowSeconds: number, timeScale = CHARACTER_ANIMATION_TIME_SCALE): void {
    if (!mixer) return;
    const dt =
      mixerClock.lastNowSeconds == null
        ? 0
        : clamp01(nowSeconds - mixerClock.lastNowSeconds) * timeScale;
    mixer.update(dt);
    mixerClock.lastNowSeconds = nowSeconds;
  }

  function dispose(): void {
    mixer?.stopAllAction();
  }

  return {
    root,
    dispose,
    getHeadBone: () => headBone,
    hasLoadError: () => loadError !== null,
    isReady: () => ready,
    setAnimation,
    setPose,
    updateMixer,
    setEquippedInventory: () => {
      /* Legacy avatar has no equipment sockets. */
    },
  };
}

export function createCharacterAvatarInstance(
  renderScale: number,
  appearance: PlayerCharacterAppearanceV1 | null = null,
): CharacterAvatarInstance {
  if (appearance) {
    return createSidekickGameplayAvatar(
      renderScale,
      appearance,
      () => createLegacyCharacterAvatarInstance(renderScale),
    );
  }
  return createLegacyCharacterAvatarInstance(renderScale);
}
