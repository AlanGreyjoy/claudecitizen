import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  clamp,
  float,
  floor,
  fract,
  mix,
  oneMinus,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type {
  HyperspaceMaterialFactory,
  HyperspaceMaterialHandle,
} from './quantum-bubble';

const TAU = Math.PI * 2;

type FloatNode = ReturnType<typeof float>;

/**
 * Quantum tunnel shader — procedural, no texture dependency.
 *
 * The previous version sampled two protected flow maps and fell back to a 1×1
 * grey texture when the pack was absent, which is every release build: the
 * shader ran, sampled a constant, and drew a flat dark capsule. Nothing about
 * the look survived the fallback. Everything here is ALU, so the effect is
 * identical in the editor and in a shipped build, and it is cheap enough to be
 * the *only* thing on screen during a jump.
 *
 * Shape follows Star Citizen's quantum: a rushing barrel of stretched light
 * streaks, deep blue walls with white-hot cores, spiralling, converging into a
 * bright throat ahead. Two counter-swirling streak layers give parallax without
 * a second pass.
 */

/** Cheap per-strip randomness; strips are the vertical bands streaks ride in. */
function hash11(n: FloatNode): FloatNode {
  return fract(sin(n.mul(127.1)).mul(43758.5453));
}

interface StreakLayerParams {
  /** Angular coordinate in turns (0..1 around the tunnel), pre-swirled. */
  turns: FloatNode;
  /** Axial coordinate, 0 behind the ship → 1 ahead of it. */
  axis: FloatNode;
  elapsed: FloatNode;
  /** 0 = spool-up drift, 1 = full travel rush. */
  warp: FloatNode;
  strips: number;
  seedOffset: number;
}

/**
 * One band of comet-shaped streaks.
 *
 * Each angular strip draws its own seed, so speed, length and repeat differ
 * per strip — that irregularity is what reads as *travel* rather than as a
 * spinning texture. `pow(1 - head, tail)` is the comet: a sharp leading edge
 * with an exponential trail behind it, stretched as `warp` rises.
 */
function streakLayer({
  turns,
  axis,
  elapsed,
  warp,
  strips,
  seedOffset,
}: StreakLayerParams): FloatNode {
  const stripCoord = turns.mul(strips);
  const stripIndex = floor(stripCoord);
  const stripLocal = fract(stripCoord).sub(0.5).abs().mul(2);
  const seed = hash11(stripIndex.add(seedOffset));
  const seedB = hash11(stripIndex.add(seedOffset).add(19.19));

  const speed = mix(float(0.55), float(2.4), seed).mul(mix(float(0.3), float(1), warp));
  const repeat = mix(float(1.1), float(3.4), seedB);
  const head = fract(axis.mul(repeat).sub(elapsed.mul(speed)));
  // Bigger exponent = shorter dash. Spooling flickers in short arcs; travel
  // pulls them into long light-trails.
  const tail = mix(float(6), float(26), seed).mul(mix(float(2.4), float(1), warp));
  const body = pow(oneMinus(head), tail);
  // Edges ordered low → high: WGSL leaves `smoothstep` undefined when they are
  // reversed, so the fade is inverted after the fact rather than by swapping.
  const angular = oneMinus(smoothstep(0.08, 1, stripLocal));
  return body.mul(angular).mul(mix(float(0.4), float(1), seedB));
}

export const createWebGpuHyperspaceMaterial: HyperspaceMaterialFactory =
  (): HyperspaceMaterialHandle => {
    const intensity = uniform(0);
    const elapsed = uniform(0);
    const warp = uniform(0);
    const flash = uniform(0);

    const surfaceUv = uv();
    const axis = surfaceUv.y;
    // Spiral: the angular coordinate drifts with time and shears along the
    // tunnel, so streaks corkscrew instead of running dead straight.
    const swirl = surfaceUv.x.add(axis.mul(0.22)).add(elapsed.mul(0.05));
    const counterSwirl = surfaceUv.x.mul(-1).sub(axis.mul(0.13)).add(elapsed.mul(0.031));

    const near = streakLayer({
      turns: swirl,
      axis,
      elapsed,
      warp,
      strips: 96,
      seedOffset: 0,
    });
    const far = streakLayer({
      turns: counterSwirl,
      axis,
      elapsed,
      warp,
      strips: 184,
      seedOffset: 61.3,
    });
    const streaks = clamp(near.add(far.mul(0.65)), 0, 1.4);

    // Faint rolling haze on the barrel wall: keeps the tunnel from reading as
    // empty black between streaks and sells the bubble as a surface.
    const haze = float(0.09)
      .add(sin(swirl.mul(TAU).mul(3).add(elapsed.mul(0.9))).mul(0.028))
      .add(sin(axis.mul(TAU).mul(2).sub(elapsed.mul(1.7))).mul(0.02));

    // Soft ends — no hard geometric rim where the cylinder stops.
    const ends = smoothstep(0, 0.12, axis).mul(oneMinus(smoothstep(0.84, 1, axis)));
    // The throat: everything converges into light ahead of the ship.
    const throat = pow(axis, float(5)).mul(0.85);

    const wall = vec3(0.015, 0.06, 0.24);
    const beam = vec3(0.2, 0.62, 1);
    const core = vec3(0.9, 0.98, 1);
    const streakColor = mix(beam, core, clamp(streaks.sub(0.45).mul(1.8), 0, 1));

    const color = wall
      .mul(haze.mul(6).add(0.6))
      .add(streakColor.mul(streaks))
      .add(vec3(0.55, 0.85, 1).mul(throat))
      .add(core.mul(flash.mul(0.8)));
    const alpha = clamp(
      haze.mul(3).add(streaks).add(throat).add(flash.mul(0.5)),
      0,
      1,
    ).mul(intensity);

    const material = new NodeMaterial();
    material.name = 'quantum-hyperspace-node';
    // outputNode keeps this compatible with the gameplay scene's MRT pass; see
    // the note in lake_water/render/node-material.ts.
    material.outputNode = vec4(color.mul(intensity).mul(ends), alpha.mul(ends));
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.BackSide;
    material.toneMapped = false;

    return {
      material,
      setIntensity(value) {
        intensity.value = value;
      },
      setTime(value) {
        elapsed.value = value;
      },
      setWarp(value) {
        warp.value = value;
      },
      setFlash(value) {
        flash.value = value;
      },
      dispose() {
        material.dispose();
      },
    };
  };
