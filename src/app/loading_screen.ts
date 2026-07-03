export interface LoadingScreenHandle {
  setProgress: (value: number) => void;
  setStatus: (text: string) => void;
  complete: () => Promise<void>;
  hide: () => void;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function showLoadingScreen(): LoadingScreenHandle {
  const screen = requireElement<HTMLElement>('loading-screen');
  const bar = requireElement<HTMLElement>('loading-bar');
  const fill = requireElement<HTMLElement>('loading-bar-fill');
  const statusEl = requireElement<HTMLElement>('loading-status');

  let displayedProgress = 0;
  let targetProgress = 0;
  let rafId = 0;
  let startTime = 0;
  let completed = false;

  const PLACEHOLDER_DURATION_MS = 2000;
  const PLACEHOLDER_CAP = 0.9;

  function applyProgress(value: number): void {
    displayedProgress = clamp01(value);
    const percent = Math.round(displayedProgress * 100);
    fill.style.setProperty('--progress', String(percent));
    bar.setAttribute('aria-valuenow', String(percent));
  }

  function tick(now: number): void {
    if (completed) return;

    if (!startTime) startTime = now;
    const elapsed = now - startTime;
    const eased = PLACEHOLDER_CAP * (1 - Math.exp(-elapsed / (PLACEHOLDER_DURATION_MS * 0.45)));
    targetProgress = Math.max(targetProgress, eased);
    applyProgress(displayedProgress + (targetProgress - displayedProgress) * 0.12);

    if (displayedProgress < targetProgress - 0.001) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function startPlaceholderAnimation(): void {
    startTime = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  function stopPlaceholderAnimation(): void {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  applyProgress(0);
  statusEl.textContent = 'Preparing Asteron...';
  screen.classList.remove('is-hidden');
  startPlaceholderAnimation();

  return {
    setProgress(value: number) {
      targetProgress = Math.max(targetProgress, clamp01(value));
      if (!rafId && !completed) {
        rafId = window.requestAnimationFrame(tick);
      }
    },

    setStatus(text: string) {
      statusEl.textContent = text;
    },

    async complete() {
      completed = true;
      stopPlaceholderAnimation();
      applyProgress(1);
      statusEl.textContent = 'Ready';
      await sleep(300);
    },

    hide() {
      completed = true;
      stopPlaceholderAnimation();
      screen.classList.add('is-hidden');
    },
  };
}
