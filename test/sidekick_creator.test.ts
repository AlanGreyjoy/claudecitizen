import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CharacterPartType, SIDEKICK_PART_GROUPS, type SidekickCatalog } from '../src/player/character_creator/sidekick_manifest';
import {
  buildDefaultDefinition,
  getCompletePartPresets,
  getPartsForSpecies,
  getPlayableSpecies,
} from '../src/player/character_creator/sidekick_catalog';
import { createSidekickCreatorStore } from '../src/player/character_creator/sidekick_creator_store';
import {
  DEFAULT_SIDEKICK_MATERIAL_EFFECTS,
  getDefinitionPartName,
  parseSidekickDefinition,
  serializeSidekickDefinition,
} from '../src/player/character_creator/sidekick_definition';
import {
  createSidekickSelectionGeneration,
  getSidekickBodyMorphWeight,
} from '../src/render/characters/sidekick/assemble_avatar';
import {
  applySidekickMaterialEffectsToPixel,
  getSidekickAtlasCellRect,
  getSidekickRoughnessByte,
  SIDEKICK_MIN_ROUGHNESS,
} from '../src/render/characters/sidekick/materials';
import { sanitizeSidekickMorphInfluences } from '../src/render/characters/sidekick/load_part';

const catalog = JSON.parse(readFileSync(
  new URL('../src/assets/protected/characters/synty_sidekick/manifest.json', import.meta.url),
  'utf8',
)) as SidekickCatalog;
const human = catalog.species.find((species) => species.name === 'Human');
if (!human) throw new Error('Human species fixture missing.');

test('installed catalog exposes Human, all slots, and the 16 complete presets', () => {
  assert.deepEqual(getPlayableSpecies(catalog).map((species) => species.name), ['Human']);
  const slotTypes = SIDEKICK_PART_GROUPS.flatMap((group) => group.types);
  assert.equal(new Set(slotTypes).size, 38);
  for (const type of slotTypes)
    assert.ok(getPartsForSpecies(catalog, human.id, type).length > 0, `missing installed slot ${type}`);
  assert.equal(getCompletePartPresets(catalog, human.id).length, 16);
});

test('randomization honors locks and group presets leave other groups untouched', () => {
  const definition = buildDefaultDefinition(catalog, human);
  const originalColors = definition.colorRows;
  const store = createSidekickCreatorStore(catalog, definition, { rng: () => 0.999 });
  const originalHair = getDefinitionPartName(definition, CharacterPartType.Hair);
  const originalHips = getDefinitionPartName(definition, CharacterPartType.Hips);
  store.toggleLock(CharacterPartType.Hair);
  store.randomizeCharacter();
  assert.equal(getDefinitionPartName(store.getState().definition, CharacterPartType.Hair), originalHair);
  assert.ok(store.getState().definition.parts.length < 38, 'full randomization should use coherent presets');
  assert.notDeepEqual(store.getState().definition.colorRows, originalColors);
  const randomizedHips = getDefinitionPartName(store.getState().definition, CharacterPartType.Hips);

  const headPreset = store.getAvailablePresets(1)[0];
  assert.ok(headPreset);
  store.applyPartPreset(headPreset.id);
  assert.equal(getDefinitionPartName(store.getState().definition, CharacterPartType.Hips), randomizedHips);
  assert.notEqual(randomizedHips, originalHips);
});

test('wrap follows torso and feminine body state', () => {
  const definition = buildDefaultDefinition(catalog, human);
  const store = createSidekickCreatorStore(catalog, definition);
  const wrapName = getPartsForSpecies(catalog, human.id, CharacterPartType.Wrap)[0]?.name;
  assert.ok(wrapName);
  store.setBody({ bodyTypeValue: 100 });
  assert.equal(getDefinitionPartName(store.getState().definition, CharacterPartType.Wrap), wrapName);
  store.setBody({ bodyTypeValue: -100 });
  assert.equal(getDefinitionPartName(store.getState().definition, CharacterPartType.Wrap), null);
});

test('color mutation and legacy definition migration round-trip', () => {
  const definition = buildDefaultDefinition(catalog, human);
  const row = definition.colorRows[0];
  assert.ok(row);
  const store = createSidekickCreatorStore(catalog, definition);
  store.setColorValue(row.colorPropertyId, '123456');
  store.setMaterialEffects({ dirtAmount: 0.75, dirtColor: '654321' });
  assert.equal(
    store.getState().definition.colorRows.find((candidate) => candidate.colorPropertyId === row.colorPropertyId)?.color,
    '123456',
  );

  const legacy = { ...store.getState().definition } as Record<string, unknown>;
  delete legacy.schemaVersion;
  delete legacy.materialEffects;
  const parsed = parseSidekickDefinition(legacy);
  assert.equal(parsed.schemaVersion, 2);
  assert.deepEqual(parsed.materialEffects, DEFAULT_SIDEKICK_MATERIAL_EFFECTS);
  assert.deepEqual(parseSidekickDefinition(JSON.parse(serializeSidekickDefinition(parsed))), parsed);
});

test('body values map to source morphs and atlas cells use Unity UV coordinates', () => {
  const body = { bodyTypeValue: 100, bodySizeValue: -40, muscleValue: 20 };
  assert.equal(getSidekickBodyMorphWeight('masculineFeminine', body), 1);
  assert.equal(getSidekickBodyMorphWeight('defaultSkinny', body), 0.4);
  assert.equal(getSidekickBodyMorphWeight('defaultHeavy', body), 0);
  assert.equal(getSidekickBodyMorphWeight('defaultBuff', body), 0.6);
  assert.equal(getSidekickBodyMorphWeight('facialSmile', body), null);
  assert.deepEqual(getSidekickAtlasCellRect(3, 4, 32), { x: 6, y: 22, width: 2, height: 2 });
  assert.equal(getSidekickRoughnessByte(255), Math.round(SIDEKICK_MIN_ROUGHNESS * 255));
  assert.equal(getSidekickRoughnessByte(0), 255);
  assert.deepEqual(applySidekickMaterialEffectsToPixel(
    { r: 200, g: 160, b: 120 },
    { dark: 255, dirt: 255, skin: 0, eyeEdge: 0 },
    {
      ...DEFAULT_SIDEKICK_MATERIAL_EFFECTS,
      darkAmount: 0.5,
      dirtAmount: 0,
    },
  ), { r: 100, g: 80, b: 60 });
  assert.deepEqual(applySidekickMaterialEffectsToPixel(
    { r: 200, g: 160, b: 120 },
    { dark: 0, dirt: 255, skin: 0, eyeEdge: 0 },
    {
      ...DEFAULT_SIDEKICK_MATERIAL_EFFECTS,
      darkAmount: 0,
      dirtAmount: 1,
      dirtColor: '785A3C',
    },
  ), { r: 120, g: 90, b: 60 });
  assert.deepEqual(sanitizeSidekickMorphInfluences([Number.NaN, 0.5, Infinity, -Infinity]), [0, 0.5, 0, 0]);
});

test('rapid async selections accept only the latest generation', async () => {
  const generation = createSidekickSelectionGeneration();
  const accepted: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  const firstReady = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondReady = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const apply = async (name: string, ready: Promise<void>): Promise<void> => {
    const token = generation.begin(CharacterPartType.Hair);
    await ready;
    if (generation.isCurrent(CharacterPartType.Hair, token)) accepted.push(name);
  };
  const first = apply('first', firstReady);
  const second = apply('second', secondReady);
  releaseSecond?.();
  await second;
  releaseFirst?.();
  await first;
  assert.deepEqual(accepted, ['second']);
});
