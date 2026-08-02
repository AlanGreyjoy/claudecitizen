/**
 * Counters for atmosphere work that is supposed to be rare.
 *
 * `atmosphere-idle-bypass.ts` makes `requestIdleCallback` synchronous so
 * takram's time-sliced LUT compute completes in one turn — which also means
 * every one of those passes runs inline on the main thread. The LUT is meant to
 * refill only when a parameter version bumps, and the star render target only
 * when stars are actually visible. If either counter tracks the frame count,
 * that per-frame cost is the bug.
 *
 * Kept in its own module so debug readouts can import the numbers without
 * pulling `three/webgpu` and the takram graph into their bundle.
 */
export const atmosphereWork = {
  frames: 0,
  lutFills: 0,
  starFills: 0,
};

export function getAtmosphereWorkCounters(): {
  frames: number;
  lutFills: number;
  starFills: number;
} {
  return { ...atmosphereWork };
}
