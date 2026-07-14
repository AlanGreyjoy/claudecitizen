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
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  buildUalBoneMap,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
} from '../src/render/characters/unity_humanoid_retarget';

const catalog = JSON.parse(readFileSync(
  new URL('../src/assets/protected/characters/synty_sidekick/manifest.json', import.meta.url),
  'utf8',
)) as SidekickCatalog;

test('UAL bone mapping supports both Unity and exported Sidekick names', () => {
  const targetBones = ['root', 'pelvis', 'head', 'Hips'].map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });
  const sourceBones = ['root', 'pelvis', 'Head'].map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });

  const names = buildUalBoneMap(targetBones, sourceBones);
  assert.equal(names.root, 'root');
  assert.equal(names.pelvis, 'pelvis');
  assert.equal(names.head, 'Head');
  assert.equal(names.Hips, 'pelvis');
});

test('UAL retargeting preserves Sidekick child offsets and hierarchy order', async () => {
  class TestProgressEvent extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  }
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: TestProgressEvent,
  });
  const loadFixture = async (url: URL) => {
    const bytes = readFileSync(url);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new GLTFLoader().parseAsync(buffer, '');
  };
  const [target, source] = await Promise.all([
    loadFixture(new URL(
      '../src/assets/protected/characters/synty_sidekick/parts/humn/SK_HUMN_BASE_01_10TORS_HU01.glb',
      import.meta.url,
    )),
    loadFixture(new URL(
      '../src/assets/universal-animation-library-1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
      import.meta.url,
    )),
  ]);
  const sourceClip = source.animations.find((clip) => clip.name === 'Idle_Loop');
  assert.ok(sourceClip);
  const [targetClip] = retargetUnityHumanoidAnimations(target.scene, source.scene, [sourceClip]);
  assert.ok(targetClip);
  assert.ok(targetClip.tracks.every((track) => Array.from(track.values).every(Number.isFinite)));
  assert.deepEqual(
    targetClip.tracks
      .filter((track) => track.name.endsWith('.position'))
      .map((track) => track.name)
      .sort(),
    ['.bones[pelvis].position', '.bones[root].position'],
  );

  const sourceMesh = findFirstSkinnedMesh(source.scene);
  const targetMesh = findFirstSkinnedMesh(target.scene);
  assert.ok(sourceMesh);
  assert.ok(targetMesh);
  const sourceMixer = new THREE.AnimationMixer(source.scene);
  const targetMixer = new THREE.AnimationMixer(targetMesh);
  sourceMixer.clipAction(sourceClip).play();
  targetMixer.clipAction(targetClip).play();
  sourceMixer.setTime(0.65);
  targetMixer.setTime(0.65);
  source.scene.updateMatrixWorld(true);
  target.scene.updateMatrixWorld(true);

  const direction = (skeleton: THREE.Skeleton, from: string, to: string) => {
    const start = skeleton.getBoneByName(from);
    const end = skeleton.getBoneByName(to);
    assert.ok(start);
    assert.ok(end);
    return end.getWorldPosition(new THREE.Vector3())
      .sub(start.getWorldPosition(new THREE.Vector3()))
      .normalize();
  };
  for (const [from, to] of [
    ['upperarm_l', 'lowerarm_l'],
    ['lowerarm_l', 'hand_l'],
    ['upperarm_r', 'lowerarm_r'],
    ['lowerarm_r', 'hand_r'],
    ['thigh_l', 'calf_l'],
    ['calf_l', 'foot_l'],
    ['thigh_r', 'calf_r'],
    ['calf_r', 'foot_r'],
  ]) {
    const errorDegrees = THREE.MathUtils.radToDeg(
      direction(sourceMesh.skeleton, from, to)
        .angleTo(direction(targetMesh.skeleton, from, to)),
    );
    assert.ok(errorDegrees < 8, `${from}->${to} differs by ${errorDegrees.toFixed(2)}°`);
  }
});
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
