import { Fn, dot, float, floor, fract, mix, vec3 } from 'three/tsl';
import type TslBaseNode from 'three/src/nodes/core/Node.js';

type Tsl = TslBaseNode;

/**
 * Shared TSL value noise for the post stack and the cloud deck.
 *
 * The volumetric fog raymarch, the night-sky band, and the cloud coverage
 * field all sample the same noise, so it lives here rather than being pasted
 * into each node builder — copies of a hash are copies that drift.
 */

/** Value-noise hash from the GLSL original, kept bit-for-bit in structure. */
export const hash31 = Fn(([p]: [Tsl]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});

export const noise3 = Fn(([p]: [Tsl]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  const n000 = hash31(i.add(vec3(0, 0, 0)));
  const n100 = hash31(i.add(vec3(1, 0, 0)));
  const n010 = hash31(i.add(vec3(0, 1, 0)));
  const n110 = hash31(i.add(vec3(1, 1, 0)));
  const n001 = hash31(i.add(vec3(0, 0, 1)));
  const n101 = hash31(i.add(vec3(1, 0, 1)));
  const n011 = hash31(i.add(vec3(0, 1, 1)));
  const n111 = hash31(i.add(vec3(1, 1, 1)));
  const nx00 = mix(n000, n100, f.x);
  const nx10 = mix(n010, n110, f.x);
  const nx01 = mix(n001, n101, f.x);
  const nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
});

/** Highest octave count `fbm3` will build a shader function for. */
export const MAX_FBM_OCTAVES = 6;

function buildFbm(octaves: number) {
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += 0.5 ** (octave + 1);
  }
  // Normalized so the result keeps `noise3`'s 0..1 range and 0.5 mean whatever
  // the octave count is. Without this, amplitude — and therefore any threshold
  // compared against it — shifts every time `detail` changes.
  const normalize = 1 / total;
  return Fn(([position]: [Tsl]) => {
    const sum = float(0).toVar();
    let amplitude = 0.5;
    let frequency = 1;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum.addAssign(noise3(position.mul(frequency)).mul(amplitude));
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return sum.mul(normalize);
  });
}

/**
 * One compiled fBm per octave count.
 *
 * The octave loop has to unroll at graph-build time, so the count cannot be a
 * uniform — an authored `clouds.detail` of 4 and one of 2 are different
 * shaders. Building all of them up front keeps that an implementation detail
 * of this module instead of a branch at every call site.
 */
const FBM_BY_OCTAVES = Array.from({ length: MAX_FBM_OCTAVES }, (_unused, index) =>
  buildFbm(index + 1),
);

/** Fractal Brownian motion over `noise3`. `octaves` is clamped to 1..6. */
export function fbm3(position: Tsl, octaves: number) {
  const index = Math.min(MAX_FBM_OCTAVES, Math.max(1, Math.round(octaves))) - 1;
  return FBM_BY_OCTAVES[index](position);
}
