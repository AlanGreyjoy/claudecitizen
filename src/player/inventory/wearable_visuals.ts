import { getPresetParts } from '../character_creator/sidekick_catalog';
import {
  cloneSidekickDefinition,
  setDefinitionPart,
  type SidekickCharacterDefinitionV2,
} from '../character_creator/sidekick_definition';
import {
  CharacterPartType,
  type SidekickCatalog,
} from '../character_creator/sidekick_manifest';
import type { InventoryState, WearableSlotType } from './types';
import { resolveEquippedWearables } from './wearable_loadout';

const SLOT_PART_TYPES: Record<WearableSlotType, readonly CharacterPartType[]> = {
  head: [
    CharacterPartType.Hair,
    CharacterPartType.FacialHair,
    CharacterPartType.AttachmentHead,
    CharacterPartType.AttachmentFace,
  ],
  torso: [CharacterPartType.Torso, CharacterPartType.Wrap],
  arms: [
    CharacterPartType.ArmUpperLeft,
    CharacterPartType.ArmUpperRight,
    CharacterPartType.ArmLowerLeft,
    CharacterPartType.ArmLowerRight,
    CharacterPartType.HandLeft,
    CharacterPartType.HandRight,
    CharacterPartType.AttachmentShoulderLeft,
    CharacterPartType.AttachmentShoulderRight,
    CharacterPartType.AttachmentElbowLeft,
    CharacterPartType.AttachmentElbowRight,
  ],
  legs: [
    CharacterPartType.Hips,
    CharacterPartType.LegLeft,
    CharacterPartType.LegRight,
    CharacterPartType.AttachmentHipsFront,
    CharacterPartType.AttachmentHipsBack,
    CharacterPartType.AttachmentHipsLeft,
    CharacterPartType.AttachmentHipsRight,
    CharacterPartType.AttachmentKneeLeft,
    CharacterPartType.AttachmentKneeRight,
  ],
  feet: [CharacterPartType.FootLeft, CharacterPartType.FootRight],
};

const missingPresetWarnings = new Set<string>();

export function wearablePartTypes(
  slotTypes: readonly WearableSlotType[],
): ReadonlySet<CharacterPartType> {
  return new Set(slotTypes.flatMap((slot) => SLOT_PART_TYPES[slot]));
}

export function wearableLoadoutVisualKey(inventory: InventoryState | null): string {
  if (!inventory) return '';
  return resolveEquippedWearables(inventory)
    .map((entry) => [
      entry.primarySlotType,
      entry.itemId,
      entry.definition.sidekickPartPresetId ?? 0,
      ...entry.occupiedSlotTypes,
    ].join(':'))
    .join('|');
}

export function applyWearableLoadoutToDefinition(
  baseDefinition: SidekickCharacterDefinitionV2,
  catalog: SidekickCatalog,
  inventory: InventoryState | null,
): SidekickCharacterDefinitionV2 {
  let next = cloneSidekickDefinition(baseDefinition);
  if (!inventory) return next;

  for (const equipped of resolveEquippedWearables(inventory)) {
    const presetId = equipped.definition.sidekickPartPresetId;
    const parts = typeof presetId === 'number' ? getPresetParts(catalog, presetId) : [];
    if (parts.length === 0) {
      const warningKey = `${equipped.itemId}:${presetId ?? 'missing'}`;
      if (import.meta.env.DEV && !missingPresetWarnings.has(warningKey)) {
        missingPresetWarnings.add(warningKey);
        console.warn(
          `Wearable "${equipped.itemId}" references unavailable Sidekick preset ${presetId ?? 'none'}; using base appearance.`,
        );
      }
      continue;
    }
    const allowedTypes = wearablePartTypes(equipped.occupiedSlotTypes);
    for (const part of parts) {
      if (!allowedTypes.has(part.type)) continue;
      next = setDefinitionPart(next, part.type, part.name);
    }
  }
  return next;
}
