import * as THREE from 'three';
import { CHARACTER_GROUND_OFFSET_METERS } from '../../../player/character_controller';
import {
  buildPlayerSidekickDefinition,
  type PlayerCharacterAppearanceV1,
} from '../../../player/character_creator/player_character_appearance';
import { loadSidekickCatalog } from '../../../player/character_creator/sidekick_catalog';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick_manifest';
import type { SidekickCharacterDefinitionV2 } from '../../../player/character_creator/sidekick_definition';
import type { InventoryState } from '../../../player/inventory/types';
import {
  applyWearableLoadoutToDefinition,
  wearableLoadoutVisualKey,
} from '../../../player/inventory/wearable_visuals';
import type {
  CharacterRenderState,
  CharacterUpperBodyAim,
  Vec3,
} from '../../../types';
import type { CharacterAvatarInstance } from '../../main/scene/character_avatar_model';
import { assembleSidekickCharacter } from './assemble_avatar';
import {
  createSidekickAnimationRuntime,
  type SidekickAnimationRuntime,
} from './animation_runtime';
import { createEquipmentAttachmentController } from './equipment_attach';
import { applyDefaultFrustumCulling } from '../../frustum_policy';
import {
  createSidekickHeadLookController,
  type SidekickHeadLookController,
} from './head_look';
import {
  loadCurrentDefaultAnimationController,
  primaryStanceSources,
  type AnimationControllerV1,
} from '../../../player/animation';

const GAMEPLAY_ANIMATION_TIME_SCALE = 1;

function geometryBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds.isEmpty() ? new THREE.Box3().setFromObject(root) : bounds;
}

export function createSidekickGameplayAvatar(
  renderScale: number,
  appearance: PlayerCharacterAppearanceV1,
  createFallback: () => CharacterAvatarInstance,
): CharacterAvatarInstance {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.add(modelOffset);
  root.frustumCulled = false;

  let avatar: Awaited<ReturnType<typeof assembleSidekickCharacter>> | null = null;
  let animation: SidekickAnimationRuntime | null = null;
  let animationController: AnimationControllerV1 | null = null;
  let fallback: CharacterAvatarInstance | null = null;
  let headLook: SidekickHeadLookController | null = null;
  let ready = false;
  let disposed = false;
  let desiredAnimation = 'Idle_Loop';
  let desiredUpperAnimation: string | null = null;
  let lastNowSeconds: number | null = null;
  let headBone: THREE.Object3D | null = null;
  let pendingInventory: InventoryState | null = null;
  let pendingActiveWeaponSlotId: string | null = null;
  let pendingHeadLook: CharacterUpperBodyAim | null = null;
  let sidekickCatalog: SidekickCatalog | null = null;
  let baseDefinition: SidekickCharacterDefinitionV2 | null = null;
  let appliedWearableKey = '';
  let wearableSyncEpoch = 0;
  let appliedControllerSourceKey = '';
  let controllerSyncEpoch = 0;
  const clipLoadInFlight = new Map<string, Promise<boolean>>();
  const wearableAssetWarnings = new Set<string>();
  const equipment = createEquipmentAttachmentController();
  const modelOffsetPosition = new THREE.Vector3();
  const characterType = appearance.type === 2 ? 2 : 1;

  function controllerSourceKey(controller: AnimationControllerV1): string {
    return primaryStanceSources(controller)
      .map((source) => `${source.id}:${source.yawOffsetDegrees}:${source.url}`)
      .join('|');
  }

  function sourceForClipName(clipName: string) {
    if (!animationController) return null;
    const state = animationController.states.find((entry) => entry.clipName === clipName);
    if (state) {
      return animationController.sources.find((source) => source.id === state.sourceId) ?? null;
    }
    return animationController.sources.find((source) => source.label === clipName) ?? null;
  }

  async function ensureClipLoaded(clipName: string): Promise<boolean> {
    if (!animation || !clipName) return false;
    if (animation.clipNames.includes(clipName)) return true;
    const existing = clipLoadInFlight.get(clipName);
    if (existing) return existing;
    const source = sourceForClipName(clipName);
    if (!source) return false;
    const loading = (async () => {
      try {
        await animation!.loadAnimationSource(
          source.url,
          clipName,
          source.yawOffsetDegrees,
          { activate: false },
        );
        return !disposed && Boolean(animation?.clipNames.includes(clipName));
      } catch (error) {
        console.warn(`Failed to load animation clip "${clipName}".`, error);
        return false;
      } finally {
        clipLoadInFlight.delete(clipName);
      }
    })();
    clipLoadInFlight.set(clipName, loading);
    return loading;
  }

  function playDesiredUpper(fadeSeconds = 0.16): void {
    if (!animation) return;
    if (!desiredUpperAnimation) {
      animation.setUpperBodyAnimation(null, fadeSeconds);
      return;
    }
    const applyUpper = (): void => {
      if (!animation || !desiredUpperAnimation) return;
      if (!animation.clipNames.includes(desiredUpperAnimation)) return;
      animation.setUpperBodyAnimation(desiredUpperAnimation, fadeSeconds);
    };
    if (animation.clipNames.includes(desiredUpperAnimation)) {
      applyUpper();
      return;
    }
    void (async () => {
      const loaded = await ensureClipLoaded(desiredUpperAnimation!);
      if (!loaded || disposed) return;
      applyUpper();
    })();
  }

  function playDesiredAnimation(fadeSeconds = 0.16): void {
    if (!animation) return;
    // Upper first so base activation sees the correct layer mask.
    playDesiredUpper(fadeSeconds);
    if (animation.clipNames.includes(desiredAnimation)) {
      animation.setAnimation(desiredAnimation, fadeSeconds);
      return;
    }
    void ensureClipLoaded(desiredAnimation).then((loaded) => {
      if (!loaded || disposed || !animation) return;
      if (desiredAnimation && animation.clipNames.includes(desiredAnimation)) {
        playDesiredUpper(fadeSeconds);
        animation.setAnimation(desiredAnimation, fadeSeconds);
      }
    });
  }

  async function preloadControllerSources(
    controller: AnimationControllerV1,
    epoch: number,
  ): Promise<void> {
    if (!animation) return;
    animationController = controller;
    const sources = primaryStanceSources(controller);
    for (const source of sources) {
      if (disposed || epoch !== controllerSyncEpoch || !animation) break;
      try {
        await animation.loadAnimationSource(
          source.url,
          source.label,
          source.yawOffsetDegrees,
          { activate: false },
        );
      } catch (error) {
        console.warn(`Failed to preload stance animation "${source.label}".`, error);
      }
    }
    if (disposed || epoch !== controllerSyncEpoch || !animation) return;
    appliedControllerSourceKey = controllerSourceKey(controller);
    playDesiredAnimation(0);
  }

  async function syncSidekickEquipment(epoch: number): Promise<void> {
    if (fallback) {
      fallback.setEquippedInventory?.(pendingInventory, pendingActiveWeaponSlotId);
      return;
    }
    if (!avatar || !ready || !sidekickCatalog || !baseDefinition) return;
    const wearableKey = wearableLoadoutVisualKey(pendingInventory);
    if (wearableKey !== appliedWearableKey) {
      const definition = applyWearableLoadoutToDefinition(
        baseDefinition,
        sidekickCatalog,
        pendingInventory,
      );
      try {
        await avatar.applyDefinition(definition);
        if (disposed || epoch !== wearableSyncEpoch) return;
      } catch (error) {
        if (disposed || epoch !== wearableSyncEpoch) return;
        if (import.meta.env.DEV && !wearableAssetWarnings.has(wearableKey)) {
          wearableAssetWarnings.add(wearableKey);
          console.warn(
            'Wearable Sidekick assets could not be loaded; using the base appearance.',
            error,
          );
        }
        try {
          await avatar.applyDefinition(baseDefinition);
        } catch (restoreError) {
          if (import.meta.env.DEV) {
            console.warn('Failed to restore the base Sidekick appearance.', restoreError);
          }
        }
        if (disposed || epoch !== wearableSyncEpoch) return;
      }
      appliedWearableKey = wearableKey;
    }
    equipment.sync(avatar.root, characterType, pendingInventory, pendingActiveWeaponSlotId);
  }

  function syncEquipment(): void {
    const epoch = ++wearableSyncEpoch;
    void syncSidekickEquipment(epoch);
  }

  async function refreshAnimationControllerFromEditor(): Promise<void> {
    if (!animation || !ready || fallback) return;
    const epoch = ++controllerSyncEpoch;
    try {
      const controller = await loadCurrentDefaultAnimationController();
      if (disposed || epoch !== controllerSyncEpoch) return;
      animationController = controller;
      const nextKey = controllerSourceKey(controller);
      if (nextKey === appliedControllerSourceKey) {
        playDesiredAnimation(0);
        return;
      }
      await preloadControllerSources(controller, epoch);
    } catch (error) {
      console.warn('Could not refresh the gameplay animation controller.', error);
    }
  }

  /** DEV: re-fetch mounts + animation controller when returning from the editor tab. */
  const onVisibilityRefresh = (): void => {
    if (document.visibilityState !== 'visible') return;
    syncEquipment();
    void refreshAnimationControllerFromEditor();
  };
  if (import.meta.env.DEV) {
    document.addEventListener('visibilitychange', onVisibilityRefresh);
  }

  void (async () => {
    try {
      const catalog = await loadSidekickCatalog();
      if (disposed) return;
      const definition = buildPlayerSidekickDefinition(catalog, appearance);
      sidekickCatalog = catalog;
      baseDefinition = definition;
      avatar = await assembleSidekickCharacter(catalog, definition);
      if (disposed) {
        avatar.dispose();
        avatar = null;
        return;
      }
      // Retarget while the skeleton is still at its native scale. Skeleton.pose()
      // restores bind-world transforms while clips are baked; running it below a
      // render-scaled parent makes the root bone compensate with 1 / renderScale
      // (500x in the planet renderer), which cancels the avatar's render scale.
      animation = await createSidekickAnimationRuntime(avatar.root);
      if (disposed) {
        animation.dispose();
        animation = null;
        avatar.dispose();
        avatar = null;
        return;
      }
      // Preload rifle + pistol idle sources authored on the animation controller.
      const controller = await loadCurrentDefaultAnimationController();
      const epoch = ++controllerSyncEpoch;
      await preloadControllerSources(controller, epoch);
      if (disposed) {
        animation?.dispose();
        animation = null;
        avatar.dispose();
        avatar = null;
        return;
      }
      avatar.root.scale.setScalar(renderScale);
      headLook = createSidekickHeadLookController(root, avatar.root);
      headLook?.setTarget(pendingHeadLook);
      applyDefaultFrustumCulling(avatar.root);
      // Measure before parenting beneath the gameplay root. That root may already
      // be rotated into a planet/station frame while assets load; world-aligned
      // bounds from that frame cannot be reused as this model's local offset.
      const bounds = geometryBounds(avatar.root);
      const center = bounds.getCenter(new THREE.Vector3());
      modelOffsetPosition.set(
        -center.x,
        -bounds.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale,
        -center.z,
      );
      modelOffset.add(avatar.root);
      headBone = avatar.root.getObjectByName('Head') ?? avatar.root.getObjectByName('head') ?? null;
      playDesiredAnimation(0);
      ready = true;
      syncEquipment();
    } catch (error) {
      console.warn('ClaudeCitizen Sidekick avatar failed; using fallback avatar.', error);
      avatar?.dispose();
      avatar = null;
      animation?.dispose();
      animation = null;
      animationController = null;
      modelOffset.clear();
      if (disposed) return;
      fallback = createFallback();
      fallback.root.visible = true;
      root.add(fallback.root);
      fallback.setAnimation(desiredAnimation);
      ready = true;
      syncEquipment();
    }
  })();

  return {
    root,
    dispose: () => {
      disposed = true;
      wearableSyncEpoch += 1;
      controllerSyncEpoch += 1;
      clipLoadInFlight.clear();
      if (import.meta.env.DEV) {
        document.removeEventListener('visibilitychange', onVisibilityRefresh);
      }
      equipment.dispose();
      headLook?.dispose();
      animation?.dispose();
      avatar?.dispose();
      fallback?.dispose();
      animationController = null;
      root.clear();
    },
    getHeadBone: () => fallback?.getHeadBone() ?? headBone,
    getActiveWeaponAttachment: () =>
      fallback?.getActiveWeaponAttachment?.() ?? equipment.getActiveWeaponAttachment(),
    hasLoadError: () => fallback?.hasLoadError() ?? false,
    isReady: () => fallback?.isReady() ?? ready,
    setAnimation: (name) => {
      desiredAnimation = name;
      playDesiredAnimation();
      fallback?.setAnimation(name);
    },
    setUpperBodyAnimation: (name) => {
      desiredUpperAnimation = name;
      playDesiredUpper();
      fallback?.setUpperBodyAnimation?.(name);
    },
    setPose: (character: CharacterRenderState, focusPosition: Vec3, scale: number) => {
      if (fallback) {
        fallback.setPose(character, focusPosition, scale);
        return;
      }
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
    updateMixer: (nowSeconds, timeScale = GAMEPLAY_ANIMATION_TIME_SCALE) => {
      if (fallback) {
        fallback.updateMixer(nowSeconds, timeScale);
        return;
      }
      const delta = lastNowSeconds === null ? 0 : nowSeconds - lastNowSeconds;
      headLook?.restore();
      animation?.update(delta * timeScale);
      headLook?.update(delta);
      lastNowSeconds = nowSeconds;
    },
    setHeadLook: (look) => {
      pendingHeadLook = look;
      headLook?.setTarget(look);
      fallback?.setHeadLook?.(look);
    },
    setEquippedInventory: (inventory, activeWeaponSlotId = null) => {
      pendingInventory = inventory;
      pendingActiveWeaponSlotId = activeWeaponSlotId ?? null;
      syncEquipment();
    },
  };
}
