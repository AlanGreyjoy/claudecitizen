/**
 * Periodic frame-health samples and freeze detection.
 *
 * Frames are sampled, never traced. At 60 fps a span per frame is 60 records a
 * second per player — unaffordable to store and unreadable once stored. The
 * engine already aggregates frame cost into ring buffers with percentiles and
 * worst-frame attribution; this module exports that summary on an interval and
 * adds a separate event for the outliers a summary hides.
 *
 * Nothing here measures anything new. Every field already existed and was
 * visible only in a dev HUD behind `?debug=1`.
 */

import { getFrameTimingSnapshot, resetWorstFrame } from '../render/main/frame-timing';
import { enqueueTelemetry } from './sink';

const SAMPLE_INTERVAL_MS = 10_000;
/**
 * A frame this long is not a slow frame, it is a stall the player felt. Well
 * above the ~33 ms of a bad frame and below the 500 ms that usually means the
 * tab was backgrounded.
 */
const FREEZE_THRESHOLD_MS = 250;
/** Beyond this the tab was almost certainly suspended, not stalled. */
const FREEZE_IMPLAUSIBLE_MS = 5_000;
/** A stall storm must not become a telemetry storm. */
const MAX_FREEZES_PER_SAMPLE = 5;

let sampleTimer: ReturnType<typeof setInterval> | null = null;
let watchdogHandle: number | null = null;
let lastFrameMs = 0;
let freezesThisWindow = 0;

/**
 * `window.__claudecitizenRenderStats` is written by the renderer every frame and
 * is null before the first frame and after a world reset.
 */
function readRenderStats(): Record<string, number | boolean> {
  const stats = window.__claudecitizenRenderStats;
  if (!stats) return {};
  return {
    drawCalls: stats.gpu.drawCalls,
    geometries: stats.gpu.geometries,
    pendingSourceReleases: stats.gpu.pendingSourceReleases,
    terrainActiveTiles: stats.terrain.activeTiles,
    // The EWMA and peak of tile construction cost. A planet that stutters while
    // `outsideJsMs` stays low is usually this number climbing.
    terrainBuildMsAverage: stats.terrain.buildMsAverage,
    terrainBuildMsPeak: stats.terrain.buildMsPeak,
    terrainCachedTiles: stats.terrain.cachedTiles,
    terrainPendingTiles: stats.terrain.pendingTiles,
    // False means the worker pool died and tiles are being built on the main
    // thread — a top suspect for planet-surface stutter, and otherwise only
    // visible in the dev HUD.
    terrainWorkerBuilds: stats.terrain.workerBuildsEnabled,
    textureBytes: stats.gpu.estimatedTextureBytes,
    textures: stats.gpu.textures,
    vegetationActiveTiles: stats.vegetation.activeTiles,
    vegetationCachedTiles: stats.vegetation.cachedTiles,
  };
}

/** Chromium-only, and the engine is WebGPU-gated, so every supported client has it. */
function readHeap(): Record<string, number> {
  const memory = (performance as { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } })
    .memory;
  if (!memory) return {};
  const toMb = (bytes: number): number => Math.round(bytes / (1024 * 1024));
  return {
    heapLimitMb: toMb(memory.jsHeapSizeLimit),
    heapUsedMb: toMb(memory.usedJSHeapSize),
  };
}

function sample(): void {
  const timing = getFrameTimingSnapshot();
  if (timing.frames === 0) return;
  enqueueTelemetry({
    at: new Date().toISOString(),
    frameMs: timing.totalMs,
    frameP95Ms: timing.totalP95Ms,
    frames: timing.frames,
    // Throughput, not an average of instantaneous rates — the latter is biased
    // toward fast frames and lets a visible stutter read as healthy.
    fps: timing.totalMs > 0 ? 1000 / timing.totalMs : 0,
    jsMs: timing.jsMs,
    kind: 'frame',
    /**
     * The first question, before any profiling: is the time even in our
     * JavaScript? A high `outsideJsMs` against a low `jsMs` means GPU submit,
     * compositor or vsync — and profiling the call tree is wasted effort.
     */
    outsideJsMs: timing.outsideJsMs,
    renderMs: timing.renderMs,
    scene: window.location.search,
    simMs: timing.simMs,
    submitMs: timing.submitMs,
    // Zero builds on the worst frame points at shader compilation rather than
    // tile construction; the two need opposite fixes.
    worstFrameBuilds: timing.worstBuilds,
    worstFrameMs: timing.worstTotalMs,
    worstFrameRenderMs: timing.worstRenderMs,
    ...readHeap(),
    ...readRenderStats(),
  });
  // The high-water mark is per-window, or one early stall would dominate every
  // sample for the rest of the session.
  resetWorstFrame();
  freezesThisWindow = 0;
}

/**
 * Standalone `requestAnimationFrame` loop rather than a hook inside the game
 * loop: stalls during loading, menus and scene switches matter as much as
 * stalls during play, and those run outside `createGameLoop` entirely.
 */
function watchdog(nowMs: number): void {
  watchdogHandle = requestAnimationFrame(watchdog);
  if (lastFrameMs > 0) {
    const gapMs = nowMs - lastFrameMs;
    if (
      gapMs >= FREEZE_THRESHOLD_MS &&
      gapMs < FREEZE_IMPLAUSIBLE_MS &&
      // A hidden tab is throttled to roughly one frame a second by design.
      document.visibilityState === 'visible' &&
      freezesThisWindow < MAX_FREEZES_PER_SAMPLE
    ) {
      freezesThisWindow += 1;
      const timing = getFrameTimingSnapshot();
      enqueueTelemetry({
        at: new Date().toISOString(),
        durationMs: gapMs,
        kind: 'freeze',
        renderMs: timing.renderMs,
        simMs: timing.simMs,
        url: window.location.href,
        ...readRenderStats(),
      });
    }
  }
  lastFrameMs = nowMs;
}

export function startFrameSampling(): void {
  if (sampleTimer !== null) return;
  sampleTimer = setInterval(sample, SAMPLE_INTERVAL_MS);
  watchdogHandle = requestAnimationFrame(watchdog);
}

export function stopFrameSampling(): void {
  if (sampleTimer !== null) clearInterval(sampleTimer);
  sampleTimer = null;
  if (watchdogHandle !== null) cancelAnimationFrame(watchdogHandle);
  watchdogHandle = null;
  lastFrameMs = 0;
}
