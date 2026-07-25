import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player_character_appearance';
import {
  buildPlayerSidekickDefinition,
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
} from '../../../player/character_creator/player_character_appearance';
import { loadSidekickCatalog } from '../../../player/character_creator/sidekick_catalog';
import type { SidekickCharacterDefinitionV2 } from '../../../player/character_creator/sidekick_definition';
import type { InventoryState } from '../../../player/inventory/types';
import { applyWearableLoadoutToDefinition } from '../../../player/inventory/wearable_visuals';
import {
  createSidekickPreviewStage,
  type SidekickPreviewStage,
} from '../../characters/sidekick/preview_stage';
import { createEquipmentAttachmentController } from '../../characters/sidekick/equipment_attach';

export interface InventoryAvatarPreview {
  dispose: () => void;
  setActive: (active: boolean) => void;
  setInventory: (inventory: InventoryState | null) => void;
}

export function createInventoryAvatarPreview(
  canvas: HTMLCanvasElement,
  appearance: PlayerCharacterAppearanceV1 | null | undefined,
): InventoryAvatarPreview {
  let active = false;
  let disposed = false;
  let initializing: Promise<void> | null = null;
  let stage: SidekickPreviewStage | null = null;
  let baseDefinition: SidekickCharacterDefinitionV2 | null = null;
  let catalog: Awaited<ReturnType<typeof loadSidekickCatalog>> | null = null;
  let inventory: InventoryState | null = null;
  let restoringBase = false;
  const resolvedAppearance = appearance ?? DEFAULT_PLAYER_CHARACTER_APPEARANCE;
  const characterType = resolvedAppearance.type === 2 ? 2 : 1;
  const equipment = createEquipmentAttachmentController();

  const applyInventory = (): void => {
    if (!stage || !baseDefinition || !catalog) return;
    restoringBase = false;
    stage.setDefinition(
      applyWearableLoadoutToDefinition(baseDefinition, catalog, inventory),
    );
    equipment.sync(stage.avatarRoot, characterType, inventory);
  };

  const ensureInitialized = (): void => {
    if (initializing || stage || disposed) return;
    canvas.dataset.state = 'loading';
    initializing = (async () => {
      const loadedCatalog = await loadSidekickCatalog();
      if (disposed) return;
      catalog = loadedCatalog;
      baseDefinition = buildPlayerSidekickDefinition(
        loadedCatalog,
        resolvedAppearance,
      );
      const preview = await createSidekickPreviewStage(
        canvas,
        loadedCatalog,
        baseDefinition,
        {
          onBusyChange: (busy) => {
            canvas.dataset.state = busy ? 'loading' : 'ready';
          },
          onError: (error) => {
            console.warn('Inventory avatar wearable could not be rendered.', error);
            if (!restoringBase && stage && baseDefinition) {
              restoringBase = true;
              stage.setDefinition(baseDefinition);
            }
          },
        },
        {
          transparent: true,
          showGround: false,
          horizontalRotationOnly: true,
          enableZoom: false,
          subjectHorizontalOffset: -0.2,
        },
      );
      if (disposed) {
        preview.dispose();
        return;
      }
      stage = preview;
      stage.setActive(active);
      stage.setAnimation('Idle_Loop');
      applyInventory();
      canvas.dataset.state = 'ready';
    })().catch((error: unknown) => {
      canvas.dataset.state = 'error';
      console.warn('Inventory avatar preview unavailable.', error);
    });
  };

  return {
    setActive(next) {
      active = next;
      canvas.classList.toggle('is-active', active);
      stage?.setActive(active);
      if (active) ensureInitialized();
    },
    setInventory(next) {
      inventory = next;
      if (active) ensureInitialized();
      applyInventory();
    },
    dispose() {
      disposed = true;
      equipment.dispose();
      stage?.dispose();
      stage = null;
    },
  };
}
