// Rolling window in wall-clock time rather than a fixed sample count, so the
// readout means the same thing at 30 and at 240 FPS.
const WINDOW_MS = 1_000;
// A frame gap longer than this is a pause, a tab switch, or a frozen render
// clock — not a slow frame. Sampling it would poison the window for a second.
const MAX_PLAUSIBLE_FRAME_MS = 500;

export interface FpsReadout {
  /** True throughput over the window: frames / elapsed. */
  fps: number;
  /** 99th-percentile frame time expressed as FPS — the number that hitches show up in. */
  onePercentLow: number;
  /** Worst single frame in the window, milliseconds. */
  worstFrameMs: number;
}

/**
 * Frame-rate readout.
 *
 * Deliberately *not* an average of instantaneous FPS values. Averaging
 * reciprocals is biased toward the fast frames: 27 frames at 8 ms plus 3 frames
 * at 100 ms averages to 113 FPS while real throughput is 58. That bias is what
 * lets a visible stutter coexist with a healthy-looking number, so this reports
 * frames-over-elapsed and surfaces the 1% low alongside it.
 */
export function createFpsCounter(fpsEl: HTMLElement) {
  const frameMs: number[] = [];
  let windowMs = 0;
  let lastMs: number | null = null;
  let readout: FpsReadout = { fps: 0, onePercentLow: 0, worstFrameMs: 0 };

  function recompute(): void {
    if (frameMs.length === 0 || windowMs <= 0) {
      readout = { fps: 0, onePercentLow: 0, worstFrameMs: 0 };
      return;
    }
    const sorted = [...frameMs].sort((left, right) => left - right);
    // Ceil so a short window still resolves to the slowest frame rather than
    // silently reporting the median.
    const percentileIndex = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * 0.99) - 1),
    );
    const worstFrameMs = sorted[sorted.length - 1];
    readout = {
      fps: (frameMs.length * 1000) / windowMs,
      onePercentLow: 1000 / sorted[percentileIndex],
      worstFrameMs,
    };
  }

  function update(nowMs: number): void {
    if (lastMs !== null) {
      const dt = nowMs - lastMs;
      // dt <= 0 means the render clock is frozen (the loop freezes it while
      // paused so camera easing holds). Skip rather than clamping to epsilon —
      // clamping is what used to display ~10,000,000 FPS on the pause menu.
      if (dt > 0 && dt <= MAX_PLAUSIBLE_FRAME_MS) {
        frameMs.push(dt);
        windowMs += dt;
        while (frameMs.length > 1 && windowMs > WINDOW_MS) {
          windowMs -= frameMs.shift()!;
        }
        recompute();
      } else if (dt > MAX_PLAUSIBLE_FRAME_MS) {
        frameMs.length = 0;
        windowMs = 0;
      }
    }
    if (nowMs !== lastMs) lastMs = nowMs;

    fpsEl.textContent = String(Math.round(readout.fps));
  }

  return {
    update,
    /** Stats panel reads this; the headline element only ever shows throughput. */
    getReadout(): FpsReadout {
      return readout;
    },
  };
}
