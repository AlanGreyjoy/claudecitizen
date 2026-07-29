#!/usr/bin/env node
/**
 * Generate an in-place Carlton-style dance on the project's native Synty
 * Sidekick skeleton.
 *
 * The project's licensed UAL Dance_Loop supplies grounded lower-body motion.
 * Torso, arm, wrist, head, and weight-shift curves are authored here against
 * the real Sidekick bind pose, then exported as one native Sidekick GLB.
 *
 * Usage:
 *   npx tsx scripts/generate_sidekick_carlton_dance.mjs --project <projectRoot>
 *   npx tsx scripts/generate_sidekick_carlton_dance.mjs \
 *     --project <projectRoot> --out <file.glb>
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
} from '../src/render/characters/unity-humanoid-retarget.ts';

globalThis.FileReader = class FileReader {
  result = null;
  onload = null;
  onloadend = null;
  onerror = null;

  readAsArrayBuffer(blob) {
    Promise.resolve(blob.arrayBuffer())
      .then((buffer) => {
        this.result = buffer;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL() {
    throw new Error('FileReader.readAsDataURL is not supported by this generator.');
  }
};

const CLIP_NAME = 'carlton_dance_loop';
const DURATION_SECONDS = 4;
const FPS = 30;
const FRAME_COUNT = DURATION_SECONDS * FPS + 1;
const DEFAULT_OUTPUT_RELATIVE = 'assets/animations/Emotes/carlton_dance_loop.glb';
const DEFAULT_SIDEKICK_PACK = 'assets/Synty/Sidekick';
const UAL_CANDIDATES = [
  'assets/animations/universal-animation-library-1/UAL1_Standard.glb',
  'assets/protected/animations/universal-animation-library/UAL1_Standard.glb',
];
const LOWER_BODY_BONES = [
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
];
const CORE_ANIMATED_BONES = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  ...LOWER_BODY_BONES,
];

function usage() {
  console.log(`Usage:
  npx tsx scripts/generate_sidekick_carlton_dance.mjs --project <projectRoot>
  npx tsx scripts/generate_sidekick_carlton_dance.mjs --project <projectRoot> --out <file.glb>

The default output is <project>/${DEFAULT_OUTPUT_RELATIVE}.
`);
}

function parseArgs(argv) {
  const args = { help: false, output: null, project: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project') args.project = argv[++index] ?? null;
    else if (arg === '--out') args.output = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function assertInside(root, target, label) {
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new Error(`${label} must stay inside the Asteron project.`);
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadGltf(filePath) {
  const bytes = await readFile(filePath);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return new Promise((resolveGltf, reject) => {
    new GLTFLoader().parse(
      arrayBuffer,
      `${pathToFileURL(dirname(filePath)).href}/`,
      resolveGltf,
      reject,
    );
  });
}

async function resolveInputs(projectRoot, outputArg) {
  const projectFile = join(projectRoot, 'asteron.project.json');
  const project = JSON.parse(await readFile(projectFile, 'utf8'));
  const sidekickRelative =
    project?.contentPacks?.syntySidekick || DEFAULT_SIDEKICK_PACK;
  const sidekickPack = resolve(projectRoot, sidekickRelative);
  assertInside(projectRoot, sidekickPack, 'Configured Sidekick pack');
  const baseModel = join(sidekickPack, 'base/SK_BaseModel.glb');

  let ualModel = null;
  for (const candidate of UAL_CANDIDATES) {
    const absolute = resolve(projectRoot, candidate);
    if (await fileExists(absolute)) {
      ualModel = absolute;
      break;
    }
  }
  if (!ualModel) {
    throw new Error(`UAL1_Standard.glb was not found under ${projectRoot}.`);
  }

  const output = outputArg
    ? resolve(outputArg)
    : resolve(projectRoot, DEFAULT_OUTPUT_RELATIVE);
  assertInside(projectRoot, output, 'Animation output');
  return { baseModel, output, ualModel };
}

function captureRestPose(scene, skeleton) {
  scene.updateMatrixWorld(true);
  return new Map(skeleton.bones.map((bone) => [
    bone.name,
    {
      localPosition: bone.position.clone(),
      localQuaternion: bone.quaternion.clone(),
      worldPosition: bone.getWorldPosition(new THREE.Vector3()),
      worldQuaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
    },
  ]));
}

function restoreRestPose(scene, skeleton, rest) {
  for (const bone of skeleton.bones) {
    const pose = rest.get(bone.name);
    if (!pose) continue;
    bone.position.copy(pose.localPosition);
    bone.quaternion.copy(pose.localQuaternion);
  }
  scene.updateMatrixWorld(true);
}

function createTrackSamplers(clip) {
  return new Map(clip.tracks.map((track) => [
    track.name,
    {
      interpolant: track.createInterpolant(new Float32Array(track.getValueSize())),
      valueSize: track.getValueSize(),
    },
  ]));
}

function sampleTrack(samplers, trackName, time) {
  const sampler = samplers.get(trackName);
  if (!sampler) return null;
  const sampled = sampler.interpolant.evaluate(time);
  return Array.from(sampled.slice(0, sampler.valueSize));
}

function requireBone(bones, name) {
  const bone = bones.get(name);
  if (!bone) throw new Error(`Sidekick skeleton is missing bone "${name}".`);
  return bone;
}

function setBoneWorldQuaternion(scene, bone, worldQuaternion) {
  const parentWorldInverse = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    : new THREE.Quaternion();
  bone.quaternion
    .copy(parentWorldInverse)
    .multiply(worldQuaternion)
    .normalize();
  scene.updateMatrixWorld(true);
}

function quaternionFromDegrees(pitch, yaw, roll) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(pitch),
    THREE.MathUtils.degToRad(yaw),
    THREE.MathUtils.degToRad(roll),
    'YXZ',
  ));
}

function alignBoneToDirection(rest, boneName, childName, direction, twistDegrees = 0) {
  const boneRest = rest.get(boneName);
  const childRest = rest.get(childName);
  if (!boneRest || !childRest) {
    throw new Error(`Cannot resolve rest direction ${boneName} -> ${childName}.`);
  }
  const restDirection = childRest.worldPosition
    .clone()
    .sub(boneRest.worldPosition)
    .normalize();
  const targetDirection = direction.clone().normalize();
  const align = new THREE.Quaternion().setFromUnitVectors(
    restDirection,
    targetDirection,
  );
  const twist = new THREE.Quaternion().setFromAxisAngle(
    targetDirection,
    THREE.MathUtils.degToRad(twistDegrees),
  );
  return {
    align,
    targetDirection,
    worldQuaternion: twist
      .multiply(align)
      .multiply(boneRest.worldQuaternion)
      .normalize(),
  };
}

function wrappedSeedTime(time, seedDuration) {
  const slowedCycle = time % 2;
  return (slowedCycle / 2) * seedDuration;
}

function danceSignals(time) {
  const phase = Math.PI * time;
  const side = Math.sin(phase);
  const cross = Math.cos(phase);
  const beat = Math.cos(phase * 2);
  const centerPulse = 0.5 + 0.5 * beat;
  const variation =
    0.5 - 0.5 * Math.cos((Math.PI * 2 * time) / DURATION_SECONDS);
  return { beat, centerPulse, cross, side, variation };
}

function applySeedLowerBody({
  bones,
  pelvis,
  rest,
  scene,
  seedDuration,
  seedPelvisStart,
  seedSamplers,
  time,
}) {
  const seedTime = wrappedSeedTime(time, seedDuration);
  const pelvisQuaternion = sampleTrack(
    seedSamplers,
    '.bones[pelvis].quaternion',
    seedTime,
  );
  if (pelvisQuaternion) pelvis.quaternion.fromArray(pelvisQuaternion).normalize();

  const pelvisPosition = sampleTrack(
    seedSamplers,
    '.bones[pelvis].position',
    seedTime,
  );
  pelvis.position.copy(rest.get('pelvis').localPosition);
  if (pelvisPosition && seedPelvisStart) {
    const verticalDelta = THREE.MathUtils.clamp(
      pelvisPosition[1] - seedPelvisStart[1],
      -0.055,
      0.055,
    );
    pelvis.position.y += verticalDelta * 0.75;
  }

  for (const boneName of LOWER_BODY_BONES) {
    const quaternion = sampleTrack(
      seedSamplers,
      `.bones[${boneName}].quaternion`,
      seedTime,
    );
    if (quaternion) requireBone(bones, boneName).quaternion.fromArray(quaternion).normalize();
  }
  scene.updateMatrixWorld(true);
}

function applyPelvisAndSpine({
  bones,
  pelvis,
  rest,
  scene,
  signals,
}) {
  pelvis.position.x += 0.06 * signals.side;
  pelvis.position.y -= 0.014 * signals.centerPulse;
  pelvis.position.z += 0.008 * signals.cross;
  scene.updateMatrixWorld(true);

  const currentPelvisWorld = pelvis.getWorldQuaternion(new THREE.Quaternion());
  const pelvisRestWorldInverse = rest.get('pelvis').worldQuaternion.clone().invert();
  const seedPelvisDelta = currentPelvisWorld
    .clone()
    .multiply(pelvisRestWorldInverse);
  const authoredPelvisDelta = quaternionFromDegrees(
    1.5 * signals.beat,
    -5 * signals.side,
    5.5 * signals.side,
  );
  const pelvisWorld = authoredPelvisDelta
    .clone()
    .multiply(currentPelvisWorld);
  setBoneWorldQuaternion(scene, pelvis, pelvisWorld);

  const spinePoses = [
    ['spine_01', -2.5, 3.5, -3.5],
    ['spine_02', -3.5, 6.5, -6],
    ['spine_03', -4.5, 10, -9],
  ];
  for (const [name, pitchBase, yawScale, rollScale] of spinePoses) {
    const extra = quaternionFromDegrees(
      pitchBase + 1.5 * signals.beat,
      yawScale * signals.side,
      rollScale * signals.side,
    );
    const desired = extra
      .multiply(authoredPelvisDelta)
      .multiply(seedPelvisDelta)
      .multiply(rest.get(name).worldQuaternion);
    setBoneWorldQuaternion(scene, requireBone(bones, name), desired);
  }

  const neckDesired = quaternionFromDegrees(
    1.5 * signals.beat,
    -5 * signals.side,
    4 * signals.side,
  )
    .multiply(authoredPelvisDelta)
    .multiply(seedPelvisDelta)
    .multiply(rest.get('neck_01').worldQuaternion);
  setBoneWorldQuaternion(scene, requireBone(bones, 'neck_01'), neckDesired);

  const headDesired = quaternionFromDegrees(
    2.5 * signals.beat,
    -8 * signals.side,
    6.5 * signals.side,
  )
    .multiply(authoredPelvisDelta)
    .multiply(seedPelvisDelta)
    .multiply(rest.get('head').worldQuaternion);
  setBoneWorldQuaternion(scene, requireBone(bones, 'head'), headDesired);
}

function applyArm({
  bones,
  rest,
  scene,
  sideName,
  signals,
}) {
  const isLeft = sideName === 'l';
  const mirror = isLeft ? 1 : -1;
  const upperName = `upperarm_${sideName}`;
  const lowerName = `lowerarm_${sideName}`;
  const handName = `hand_${sideName}`;

  const upperDirection = new THREE.Vector3(
    mirror,
    -0.18 + mirror * 0.22 * signals.side + 0.035 * signals.variation,
    0.30 + mirror * 0.08 * signals.cross,
  ).normalize();
  const upperPose = alignBoneToDirection(
    rest,
    upperName,
    lowerName,
    upperDirection,
    mirror * (-10 - 8 * signals.side),
  );
  setBoneWorldQuaternion(
    scene,
    requireBone(bones, upperName),
    upperPose.worldQuaternion,
  );

  // Both fists travel toward the same side on each sweep. The mirrored offset
  // keeps each elbow bent while the shared x term creates the Carlton silhouette.
  const lowerDirection = new THREE.Vector3(
    mirror * 0.10 + 0.62 * signals.side,
    0.88 + 0.08 * signals.beat + 0.05 * signals.variation,
    0.42 + mirror * 0.04 * signals.cross,
  ).normalize();
  const lowerPose = alignBoneToDirection(
    rest,
    lowerName,
    handName,
    lowerDirection,
    mirror * 12 + 10 * signals.side,
  );
  setBoneWorldQuaternion(
    scene,
    requireBone(bones, lowerName),
    lowerPose.worldQuaternion,
  );

  const handRest = rest.get(handName);
  const wrist = new THREE.Quaternion().setFromAxisAngle(
    lowerPose.targetDirection,
    THREE.MathUtils.degToRad(mirror * 8 + 18 * signals.side),
  );
  const handWorld = wrist
    .multiply(lowerPose.align)
    .multiply(handRest.worldQuaternion)
    .normalize();
  setBoneWorldQuaternion(scene, requireBone(bones, handName), handWorld);
}

function applyFingerSeed({
  bones,
  scene,
  seedDuration,
  seedSamplers,
  time,
}) {
  const seedTime = wrappedSeedTime(time, seedDuration);
  for (const [name, bone] of bones) {
    if (!/^(thumb|index|middle|ring|pinky)_/.test(name)) continue;
    const quaternion = sampleTrack(
      seedSamplers,
      `.bones[${name}].quaternion`,
      seedTime,
    );
    if (quaternion) bone.quaternion.fromArray(quaternion).normalize();
  }
  scene.updateMatrixWorld(true);
}

function animatedBoneNames(skeleton) {
  const names = new Set(CORE_ANIMATED_BONES);
  for (const bone of skeleton.bones) {
    if (/^(thumb|index|middle|ring|pinky)_/.test(bone.name)) names.add(bone.name);
  }
  return [...names];
}

function createOutputClip({
  bones,
  rest,
  scene,
  seedClip,
  seedSamplers,
  skeleton,
}) {
  const boneNames = animatedBoneNames(skeleton);
  const quaternionValues = new Map(
    boneNames.map((name) => [name, new Float32Array(FRAME_COUNT * 4)]),
  );
  const pelvisPositions = new Float32Array(FRAME_COUNT * 3);
  const times = new Float32Array(FRAME_COUNT);
  const pelvis = requireBone(bones, 'pelvis');
  const seedPelvisStart = sampleTrack(
    seedSamplers,
    '.bones[pelvis].position',
    0,
  );

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const trackTime = frame === FRAME_COUNT - 1
      ? DURATION_SECONDS
      : frame / FPS;
    const poseTime = frame === FRAME_COUNT - 1 ? 0 : trackTime;
    times[frame] = trackTime;
    restoreRestPose(scene, skeleton, rest);

    applySeedLowerBody({
      bones,
      pelvis,
      rest,
      scene,
      seedDuration: seedClip.duration,
      seedPelvisStart,
      seedSamplers,
      time: poseTime,
    });
    const signals = danceSignals(poseTime);
    applyPelvisAndSpine({ bones, pelvis, rest, scene, signals });
    applyArm({ bones, rest, scene, sideName: 'l', signals });
    applyArm({ bones, rest, scene, sideName: 'r', signals });
    applyFingerSeed({
      bones,
      scene,
      seedDuration: seedClip.duration,
      seedSamplers,
      time: poseTime,
    });

    pelvis.position.toArray(pelvisPositions, frame * 3);
    for (const name of boneNames) {
      const bone = requireBone(bones, name);
      const values = quaternionValues.get(name);
      const previous = frame > 0
        ? new THREE.Quaternion().fromArray(values, (frame - 1) * 4)
        : rest.get(name).localQuaternion;
      const current = bone.quaternion.clone();
      if (current.dot(previous) < 0) {
        current.set(-current.x, -current.y, -current.z, -current.w);
      }
      current.toArray(values, frame * 4);
    }
  }

  restoreRestPose(scene, skeleton, rest);
  const tracks = boneNames.map((name) => new THREE.QuaternionKeyframeTrack(
    `${name}.quaternion`,
    times,
    quaternionValues.get(name),
  ));
  tracks.push(new THREE.VectorKeyframeTrack(
    'pelvis.position',
    times,
    pelvisPositions,
  ));
  return new THREE.AnimationClip(CLIP_NAME, DURATION_SECONDS, tracks);
}

async function exportGlb(scene, clip, output) {
  const binary = await new GLTFExporter().parseAsync(scene, {
    animations: [clip],
    binary: true,
    onlyVisible: false,
  });
  if (!(binary instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return a binary ArrayBuffer.');
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(binary));
}

function assertLoopClosed(clip) {
  for (const track of clip.tracks) {
    const itemSize = track.getValueSize();
    for (let component = 0; component < itemSize; component += 1) {
      const first = track.values[component];
      const last = track.values[track.values.length - itemSize + component];
      assert.ok(
        Math.abs(first - last) <= 1e-5,
        `${track.name} is not loop-closed (${first} vs ${last}).`,
      );
    }
  }
}

function measurePose(scene, mixer, time) {
  mixer.setTime(time);
  scene.updateMatrixWorld(true);
  const point = (name) => scene
    .getObjectByName(name)
    .getWorldPosition(new THREE.Vector3());
  const leftHand = point('hand_l');
  const rightHand = point('hand_r');
  const leftFoot = point('foot_l');
  const rightFoot = point('foot_r');
  const root = point('root');
  return {
    footMinimumY: Math.min(leftFoot.y, rightFoot.y),
    handCenterX: (leftHand.x + rightHand.x) / 2,
    handMaximumY: Math.max(leftHand.y, rightHand.y),
    rootLength: root.length(),
  };
}

async function validateOutput(output, baseModel) {
  const generated = await loadGltf(output);
  assert.equal(generated.animations.length, 1, 'Generated GLB must contain one clip.');
  const [sourceClip] = generated.animations;
  assert.equal(sourceClip.name, CLIP_NAME);
  assert.ok(Math.abs(sourceClip.duration - DURATION_SECONDS) <= 1e-4);
  assertLoopClosed(sourceClip);
  for (const track of sourceClip.tracks) {
    for (const value of track.values) {
      assert.ok(Number.isFinite(value), `${track.name} contains a non-finite value.`);
    }
  }

  const target = await loadGltf(baseModel);
  const rebound = retargetUnityHumanoidAnimations(
    target.scene,
    generated.scene,
    generated.animations,
  );
  assert.equal(rebound.length, 1);
  assert.ok(
    rebound[0].tracks.some((track) =>
      track.name === '.bones[pelvis].quaternion'),
    'Runtime native Sidekick rebind did not preserve the pelvis track.',
  );

  const targetMesh = findFirstSkinnedMesh(target.scene);
  assert.ok(targetMesh, 'Validation target has no skinned Sidekick marker.');
  const mixer = new THREE.AnimationMixer(targetMesh);
  mixer.clipAction(rebound[0]).setLoop(THREE.LoopRepeat, Infinity).play();
  const left = measurePose(target.scene, mixer, 0.5);
  const right = measurePose(target.scene, mixer, 1.5);
  assert.ok(
    Math.abs(left.handCenterX - right.handCenterX) >= 0.24,
    'Arm sweep envelope is too small to read as the intended dance.',
  );
  assert.ok(
    Math.max(left.handMaximumY, right.handMaximumY) <= 2.05,
    'Hand pose exceeded the Sidekick height envelope.',
  );
  assert.ok(
    Math.min(left.footMinimumY, right.footMinimumY) >= -0.25,
    'A foot moved implausibly below the authored ground envelope.',
  );
  assert.ok(
    Math.max(left.rootLength, right.rootLength) <= 1e-5,
    'The animation contains root motion.',
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(targetMesh);

  return {
    bones: findFirstSkinnedMesh(generated.scene)?.skeleton.bones.length ?? 0,
    handSweepMeters: Math.abs(left.handCenterX - right.handCenterX),
    tracks: sourceClip.tracks.length,
  };
}

async function generate(projectRoot, outputArg) {
  const { baseModel, output, ualModel } = await resolveInputs(
    projectRoot,
    outputArg,
  );
  const target = await loadGltf(baseModel);
  const targetMesh = findFirstSkinnedMesh(target.scene);
  if (!targetMesh) throw new Error('SK_BaseModel.glb has no skinned skeleton marker.');
  const bones = new Map(targetMesh.skeleton.bones.map((bone) => [bone.name, bone]));
  for (const name of CORE_ANIMATED_BONES) requireBone(bones, name);
  const rest = captureRestPose(target.scene, targetMesh.skeleton);

  const ual = await loadGltf(ualModel);
  const dance = ual.animations.find((clip) => clip.name === 'Dance_Loop');
  if (!dance) throw new Error('UAL1_Standard.glb has no Dance_Loop clip.');
  const [seedClip] = retargetUnityHumanoidAnimations(
    target.scene,
    ual.scene,
    [dance],
  );
  restoreRestPose(target.scene, targetMesh.skeleton, rest);

  const clip = createOutputClip({
    bones,
    rest,
    scene: target.scene,
    seedClip,
    seedSamplers: createTrackSamplers(seedClip),
    skeleton: targetMesh.skeleton,
  });
  await exportGlb(target.scene, clip, output);
  const summary = await validateOutput(output, baseModel);
  const bytes = (await readFile(output)).byteLength;
  console.log(`Wrote ${output}`);
  console.log(
    `  ${CLIP_NAME}: ${DURATION_SECONDS.toFixed(1)}s @ ${FPS} fps, ` +
    `${summary.tracks} tracks, ${summary.bones} bones`,
  );
  console.log(
    `  validated native Sidekick rebind, closed loop, no root motion, ` +
    `${summary.handSweepMeters.toFixed(3)}m hand sweep, ${bytes} bytes`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.project) {
    usage();
    throw new Error('Provide --project <projectRoot>.');
  }
  await generate(resolve(args.project), args.output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
