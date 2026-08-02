/**
 * Rolling main-thread frame cost, split by phase.
 *
 * The question this exists to answer is not "which of our functions is slow"
 * but the one before it: **is the time even in our JavaScript?** `total` is the
 * wall clock between frame starts; `sim + render` is what our code spent. When
 * those two diverge — 60 ms total against 5 ms of JS — the frame is being spent
 * outside the loop entirely (GPU submit/present stalls, compositor, vsync, or
 * another renderer sharing the device), and profiling our call tree is wasted
 * effort.
 *
 * Deliberately allocation-free: fixed ring buffers written per frame.
 */

const WINDOW_FRAMES = 120;

interface Channel {
  samples: Float64Array;
  index: number;
  count: number;
}

function createChannel(): Channel {
  return { count: 0, index: 0, samples: new Float64Array(WINDOW_FRAMES) };
}

function record(channel: Channel, ms: number): void {
  channel.samples[channel.index] = ms;
  channel.index = (channel.index + 1) % WINDOW_FRAMES;
  if (channel.count < WINDOW_FRAMES) channel.count += 1;
}

function average(channel: Channel): number {
  if (channel.count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < channel.count; i += 1) sum += channel.samples[i]!;
  return sum / channel.count;
}

function percentile(channel: Channel, fraction: number): number {
  if (channel.count === 0) return 0;
  const sorted = Array.from(channel.samples.subarray(0, channel.count)).sort(
    (a, b) => a - b,
  );
  const rank = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[rank]!;
}

const simChannel = createChannel();
const renderChannel = createChannel();
const totalChannel = createChannel();
let lastFrameStartMs = 0;

/**
 * Attribution for the single worst frame in the window.
 *
 * Vegetation tile construction and WebGPU pipeline compilation both land inside
 * `render`, and they need opposite fixes — one is a build-budget problem, the
 * other a shader warm-up gap. Recording what the worst frame was *doing* tells
 * them apart: a spike with tile builds is construction, a spike with zero
 * builds is the driver compiling a shader variant that first came into view.
 */
let vegetationBuildsThisFrame = 0;
const worstFrame = { builds: 0, renderMs: 0, totalMs: 0 };

export function recordVegetationBuilds(count: number): void {
  vegetationBuildsThisFrame = count;
}

/**
 * Time inside the graphics submit alone (`postStack.render` / `renderer.render`),
 * separated from the scene-update work that shares the same `render` bucket.
 * Pipeline compiles and per-object GPU resource setup land here; terrain and
 * vegetation selection land in the remainder.
 */
const submitChannel = createChannel();

export function recordSubmitMs(ms: number): void {
  record(submitChannel, ms);
}

export function recordFrameStart(nowMs: number): void {
  if (lastFrameStartMs > 0) {
    const totalMs = nowMs - lastFrameStartMs;
    record(totalChannel, totalMs);
    // Attribute the frame that just ended, whose render time is already in.
    if (totalMs > worstFrame.totalMs) {
      worstFrame.totalMs = totalMs;
      worstFrame.renderMs = lastRenderMs;
      worstFrame.builds = vegetationBuildsThisFrame;
    }
  }
  lastFrameStartMs = nowMs;
  vegetationBuildsThisFrame = 0;
}

export function recordSimMs(ms: number): void {
  record(simChannel, ms);
}

let lastRenderMs = 0;

export function recordRenderMs(ms: number): void {
  lastRenderMs = ms;
  record(renderChannel, ms);
}

/** Clears the worst-frame high-water mark so a fresh stall can be captured. */
export function resetWorstFrame(): void {
  worstFrame.builds = 0;
  worstFrame.renderMs = 0;
  worstFrame.totalMs = 0;
}

export interface FrameTimingSnapshot {
  frames: number;
  jsMs: number;
  outsideJsMs: number;
  renderMs: number;
  simMs: number;
  totalMs: number;
  totalP95Ms: number;
  submitMs: number;
  worstBuilds: number;
  worstRenderMs: number;
  worstTotalMs: number;
}

export function getFrameTimingSnapshot(): FrameTimingSnapshot {
  const simMs = average(simChannel);
  const renderMs = average(renderChannel);
  const totalMs = average(totalChannel);
  return {
    frames: totalChannel.count,
    jsMs: simMs + renderMs,
    outsideJsMs: Math.max(0, totalMs - simMs - renderMs),
    renderMs,
    simMs,
    totalMs,
    totalP95Ms: percentile(totalChannel, 0.95),
    submitMs: average(submitChannel),
    worstBuilds: worstFrame.builds,
    worstRenderMs: worstFrame.renderMs,
    worstTotalMs: worstFrame.totalMs,
  };
}
