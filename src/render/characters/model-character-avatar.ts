import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTER_GROUND_OFFSET_METERS } from '../../player/character-controller';
import {
  loadCurrentDefaultAnimationController,
  type AnimationControllerV1,
} from '../../player/animation';
import type { CharacterRenderState, CharacterUpperBodyAim, Vec3 } from '../../types';
import { applyDefaultFrustumCulling } from '../frustum-policy';
import { avatarGeometryBounds } from './avatar-bounds';
import type { CharacterAvatarInstance } from '../main/scene/character-avatar-model';
import {
  createSidekickAnimationRuntime,
  type SidekickAnimationRuntime,
} from './sidekick/animation-runtime';
import {
  createSidekickHeadLookController,
  type SidekickHeadLookController,
} from './sidekick/head-look';

const MODEL_ANIMATION_TIME_SCALE = 1;
/** The only clips station NPC locomotion ever asks for. */
const NPC_CLIP_NAMES = ['Idle_Loop', 'Walk_Loop'] as const;

const gltfLoader = new GLTFLoader();
const templateCache = new Map<string, Promise<THREE.Object3D>>();

/**
 * One parsed GLB per url, shared by every avatar wearing it. Instances take a
 * `SkeletonUtils` clone — `Object3D.clone` would hand every NPC the same
 * skeleton and they would all animate as one body.
 */
export function loadCharacterModelTemplate(url: string): Promise<THREE.Object3D> {
  let pending = templateCache.get(url);
  if (!pending) {
    pending = gltfLoader.loadAsync(url).then((gltf) => {
      applyDefaultFrustumCulling(gltf.scene);
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      return gltf.scene;
    });
    pending.catch(() => templateCache.delete(url));
    templateCache.set(url, pending);
  }
  return pending;
}

export async function cloneCharacterModel(url: string): Promise<THREE.Object3D> {
  return cloneSkinnedScene(await loadCharacterModelTemplate(url));
}

/**
 * Clip urls come from the project animation controller, not from the character
 * GLB: authored NPC models are static meshes with a Unity humanoid rig, and the
 * animation runtime retargets the controller's clips onto them.
 */
function clipSourceUrls(controller: AnimationControllerV1): Map<string, string> {
  const urlByClipName = new Map<string, string>();
  for (const clipName of NPC_CLIP_NAMES) {
    const state = controller.states.find((entry) => entry.clipName === clipName);
    const source =
      (state && controller.sources.find((entry) => entry.id === state.sourceId)) ??
      controller.sources.find((entry) => entry.label === clipName);
    if (source) urlByClipName.set(clipName, source.url);
  }
  return urlByClipName;
}

async function loadNpcClips(
  animation: SidekickAnimationRuntime,
  controller: AnimationControllerV1,
): Promise<void> {
  const loadedUrls = new Set<string>();
  for (const [clipName, url] of clipSourceUrls(controller)) {
    if (loadedUrls.has(url)) continue;
    loadedUrls.add(url);
    try {
      await animation.loadAnimationSource(url, clipName, 0, { activate: false });
    } catch (error) {
      console.warn(`NPC animation clip "${clipName}" failed to load from ${url}.`, error);
    }
  }
}

/**
 * Avatar for an authored character GLB (asset browser drag onto an NPC marker).
 * Unlike the modular Sidekick avatar it carries no wearables or equipment
 * sockets — the model is whatever the artist exported.
 */
export function createModelCharacterAvatar(
  renderScale: number,
  modelUrl: string,
): CharacterAvatarInstance {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.frustumCulled = false;
  root.add(modelOffset);

  let model: THREE.Object3D | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let headLook: SidekickHeadLookController | null = null;
  let headBone: THREE.Object3D | null = null;
  let desiredAnimation = 'Idle_Loop';
  let pendingHeadLook: CharacterUpperBodyAim | null = null;
  let lastNowSeconds: number | null = null;
  let ready = false;
  let disposed = false;
  let loadError: unknown = null;
  const modelOffsetPosition = new THREE.Vector3();

  function playDesiredAnimation(fadeSeconds: number): void {
    if (!animation || !animation.clipNames.includes(desiredAnimation)) return;
    animation.setAnimation(desiredAnimation, fadeSeconds);
  }

  void (async () => {
    try {
      const clone = cloneSkinnedScene(await loadCharacterModelTemplate(modelUrl));
      if (disposed) return;
      // Retarget at the model's native scale: `Skeleton.pose()` restores
      // bind-world transforms while clips are baked, so a render-scaled parent
      // makes the root bone cancel the scale back out.
      animation = await createSidekickAnimationRuntime(clone);
      if (disposed) {
        animation.dispose();
        animation = null;
        return;
      }
      await loadNpcClips(animation, await loadCurrentDefaultAnimationController());
      if (disposed) {
        animation.dispose();
        animation = null;
        return;
      }
      clone.scale.setScalar(renderScale);
      // Measure before parenting: the gameplay root may already be rotated into
      // a station frame, and those world-aligned bounds are not a local offset.
      const bounds = avatarGeometryBounds(clone);
      const center = bounds.getCenter(new THREE.Vector3());
      modelOffsetPosition.set(
        -center.x,
        -bounds.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale,
        -center.z,
      );
      modelOffset.add(clone);
      model = clone;
      headBone = clone.getObjectByName('Head') ?? clone.getObjectByName('head') ?? null;
      headLook = createSidekickHeadLookController(root, clone);
      headLook?.setTarget(pendingHeadLook);
      playDesiredAnimation(0);
      ready = true;
    } catch (error) {
      loadError = error;
      console.warn(`NPC character model "${modelUrl}" failed to load.`, error);
    }
  })();

  return {
    root,
    dispose: () => {
      disposed = true;
      headLook?.dispose();
      animation?.dispose();
      animation = null;
      model = null;
      root.clear();
    },
    getHeadBone: () => headBone,
    hasLoadError: () => loadError !== null,
    isReady: () => ready,
    setAnimation: (name) => {
      if (!name || name === desiredAnimation) return;
      desiredAnimation = name;
      playDesiredAnimation(0.16);
    },
    setPose: (character: CharacterRenderState, focusPosition: Vec3, scale: number) => {
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
    },
    updateMixer: (nowSeconds, timeScale = MODEL_ANIMATION_TIME_SCALE) => {
      if (!model) return;
      const delta = lastNowSeconds === null ? 0 : nowSeconds - lastNowSeconds;
      headLook?.restore();
      animation?.update(delta * timeScale);
      headLook?.update(delta);
      lastNowSeconds = nowSeconds;
    },
    setHeadLook: (look) => {
      pendingHeadLook = look;
      headLook?.setTarget(look);
    },
    setEquippedInventory: () => {
      /* Authored character models have no equipment sockets. */
    },
    getActiveWeaponAttachment: () => null,
  };
}
