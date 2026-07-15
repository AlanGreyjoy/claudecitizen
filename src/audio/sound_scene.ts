import { rotateVec3ByQuat } from '../math/quat';
import type { Vec3 } from '../types';
import type { PrefabSoundSpec } from '../world/prefabs/sound_runtime';
import { getSfxAudioGraph, loadSfxBuffer, type SfxAudioGraph } from './sfx';

export interface SoundListenerPose {
  /** Listener pose in the same prefab-local scene axes as the sound specs. */
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

interface SoundState {
  inside: boolean;
  loading: boolean;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  panner: PannerNode | null;
}

export interface SoundSceneController {
  setScene: (key: string | null, sounds: readonly PrefabSoundSpec[]) => void;
  update: (listener: SoundListenerPose) => void;
  dispose: () => void;
}

function inverseRotate(vector: Vec3, rotation: PrefabSoundSpec['rotation']): Vec3 {
  return rotateVec3ByQuat(vector, {
    x: -rotation.x,
    y: -rotation.y,
    z: -rotation.z,
    w: rotation.w,
  });
}

function safeScale(value: number): number {
  if (Math.abs(value) >= 1e-6) return value;
  return value < 0 ? -1e-6 : 1e-6;
}

function zoneClearance(sound: PrefabSoundSpec, listener: Vec3): number {
  const delta = {
    x: listener.x - sound.position.x,
    y: listener.y - sound.position.y,
    z: listener.z - sound.position.z,
  };
  const rotated = inverseRotate(delta, sound.rotation);
  const local = {
    x: rotated.x / safeScale(sound.scale.x),
    y: rotated.y / safeScale(sound.scale.y),
    z: rotated.z / safeScale(sound.scale.z),
  };
  if (sound.zone.shape === 'sphere') {
    return sound.zone.radius - Math.hypot(local.x, local.y, local.z);
  }
  return Math.min(
    sound.zone.size.x / 2 - Math.abs(local.x),
    sound.zone.size.y / 2 - Math.abs(local.y),
    sound.zone.size.z / 2 - Math.abs(local.z),
  );
}

function loopWeight(sound: PrefabSoundSpec, clearance: number): number {
  if (clearance < 0) return 0;
  if (sound.blendDistance <= 0) return 1;
  return Math.min(1, clearance / sound.blendDistance);
}

function spatialMaxDistance(sound: PrefabSoundSpec): number {
  const scale = sound.scale;
  if (sound.zone.shape === 'sphere') {
    return Math.max(0.1, sound.zone.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
  }
  return Math.max(
    0.1,
    Math.hypot(
      (sound.zone.size.x * Math.abs(scale.x)) / 2,
      (sound.zone.size.y * Math.abs(scale.y)) / 2,
      (sound.zone.size.z * Math.abs(scale.z)) / 2,
    ),
  );
}

function setAudioParam(param: AudioParam | undefined, value: number, now: number): void {
  if (param) param.setValueAtTime(value, now);
}

function setListenerPose(graph: SfxAudioGraph, pose: SoundListenerPose): void {
  const listener = graph.context.listener;
  const now = graph.context.currentTime;
  if ('positionX' in listener) {
    setAudioParam(listener.positionX, pose.position.x, now);
    setAudioParam(listener.positionY, pose.position.y, now);
    setAudioParam(listener.positionZ, pose.position.z, now);
    setAudioParam(listener.forwardX, pose.forward.x, now);
    setAudioParam(listener.forwardY, pose.forward.y, now);
    setAudioParam(listener.forwardZ, pose.forward.z, now);
    setAudioParam(listener.upX, pose.up.x, now);
    setAudioParam(listener.upY, pose.up.y, now);
    setAudioParam(listener.upZ, pose.up.z, now);
    return;
  }
  const legacy = listener as AudioListener & {
    setPosition?: (x: number, y: number, z: number) => void;
    setOrientation?: (
      ...values: [number, number, number, number, number, number]
    ) => void;
  };
  legacy.setPosition?.(pose.position.x, pose.position.y, pose.position.z);
  legacy.setOrientation?.(
    pose.forward.x,
    pose.forward.y,
    pose.forward.z,
    pose.up.x,
    pose.up.y,
    pose.up.z,
  );
}

function stopState(state: SoundState): void {
  if (state.source) {
    try {
      state.source.stop();
    } catch {
      // The source may already have ended.
    }
    state.source.disconnect();
  }
  state.gain?.disconnect();
  state.panner?.disconnect();
  state.source = null;
  state.gain = null;
  state.panner = null;
  state.loading = false;
}

type StartSound = (
  sound: PrefabSoundSpec,
  state: SoundState,
  initialGain: number,
) => void;

function updateLoopSound(
  graph: SfxAudioGraph,
  sound: PrefabSoundSpec,
  state: SoundState,
  clearance: number,
  start: StartSound,
): void {
  const inside = clearance >= 0;
  const gain = sound.volume * loopWeight(sound, clearance);
  state.inside = inside;
  if (!inside) {
    if (state.source) stopState(state);
    return;
  }
  if (!state.source) start(sound, state, gain);
  state.gain?.gain.setValueAtTime(gain, graph.context.currentTime);
}

function updateEnterSound(
  sound: PrefabSoundSpec,
  state: SoundState,
  inside: boolean,
  start: StartSound,
): void {
  if (inside && !state.inside && !state.source) {
    start(sound, state, sound.volume);
  }
  state.inside = inside;
}

export function createSoundSceneController(): SoundSceneController {
  let sceneKey: string | null = null;
  let sceneGeneration = 0;
  let sounds: readonly PrefabSoundSpec[] = [];
  const states = new Map<string, SoundState>();
  const failedSoundUrls = new Set<string>();

  function clear(): void {
    sceneGeneration += 1;
    for (const state of states.values()) stopState(state);
    states.clear();
  }

  function stateFor(id: string): SoundState {
    let state = states.get(id);
    if (!state) {
      state = { inside: false, loading: false, source: null, gain: null, panner: null };
      states.set(id, state);
    }
    return state;
  }

  async function startSource(
    graph: SfxAudioGraph,
    sound: PrefabSoundSpec,
    state: SoundState,
    initialGain: number,
  ): Promise<void> {
    if (state.loading || state.source || failedSoundUrls.has(sound.soundUrl)) return;
    state.loading = true;
    const generation = sceneGeneration;
    try {
      const buffer = await loadSfxBuffer(sound.soundUrl);
      if (
        generation !== sceneGeneration ||
        !states.has(sound.id) ||
        (sound.playback === 'loop' && !state.inside)
      ) {
        return;
      }
      const source = graph.context.createBufferSource();
      const gain = graph.context.createGain();
      source.buffer = buffer;
      source.loop = sound.playback === 'loop';
      gain.gain.value = initialGain;
      source.connect(gain);

      let panner: PannerNode | null = null;
      if (sound.mode === 'spatial') {
        panner = graph.context.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.refDistance = 0.1;
        panner.maxDistance = spatialMaxDistance(sound);
        panner.rolloffFactor = 1;
        if ('positionX' in panner) {
          setAudioParam(panner.positionX, sound.position.x, graph.context.currentTime);
          setAudioParam(panner.positionY, sound.position.y, graph.context.currentTime);
          setAudioParam(panner.positionZ, sound.position.z, graph.context.currentTime);
        } else {
          panner.setPosition(sound.position.x, sound.position.y, sound.position.z);
        }
        gain.connect(panner).connect(graph.bus);
      } else {
        gain.connect(graph.bus);
      }

      state.source = source;
      state.gain = gain;
      state.panner = panner;
      source.addEventListener('ended', () => {
        if (state.source !== source) return;
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
        state.source = null;
        state.gain = null;
        state.panner = null;
      });
      source.start();
    } catch (error) {
      if (!failedSoundUrls.has(sound.soundUrl)) {
        failedSoundUrls.add(sound.soundUrl);
        console.warn(`Scene sound failed for ${sound.soundUrl}`, error);
      }
    } finally {
      if (generation === sceneGeneration) state.loading = false;
    }
  }

  return {
    setScene(key, nextSounds) {
      if (key === sceneKey && nextSounds === sounds) return;
      clear();
      sceneKey = key;
      sounds = nextSounds;
    },
    update(listener) {
      if (!sceneKey || sounds.length === 0) return;
      const graph = getSfxAudioGraph();
      if (!graph) return;
      setListenerPose(graph, listener);
      const start: StartSound = (sound, state, initialGain) => {
        void startSource(graph, sound, state, initialGain);
      };
      for (const sound of sounds) {
        const state = stateFor(sound.id);
        const clearance = zoneClearance(sound, listener.position);
        if (sound.playback === 'loop') {
          updateLoopSound(graph, sound, state, clearance, start);
          continue;
        }
        updateEnterSound(sound, state, clearance >= 0, start);
      }
    },
    dispose() {
      clear();
      sceneKey = null;
      sounds = [];
    },
  };
}
