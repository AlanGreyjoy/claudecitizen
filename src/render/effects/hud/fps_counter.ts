const SAMPLE_COUNT = 30;

export function createFpsCounter(fpsEl: HTMLElement) {
  const samples: number[] = [];
  let lastMs: number | null = null;

  function update(nowMs: number): void {
    if (lastMs !== null) {
      const dt = Math.max(0.0001, nowMs - lastMs);
      samples.push(1000 / dt);
      if (samples.length > SAMPLE_COUNT) samples.shift();
    }
    lastMs = nowMs;

    const fps =
      samples.length > 0
        ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
        : 0;
    fpsEl.textContent = String(fps);
  }

  return { update };
}
