/**
 * Takram's atmosphere LUT fill (`AtmosphereLUTNode.updateTextures`) time-slices
 * its four compute passes with `requestIdleCallback`, and the helper binds
 * `window.requestIdleCallback` at **module load**.
 *
 * A continuous Play RAF loop never goes idle, so those callbacks never run,
 * the LUTs stay empty, and the sky is pitch black over lit terrain.
 *
 * Remap to a synchronous idle shim *before* `@takram/three-atmosphere` is
 * imported so the captured reference is already the shim. Sync (not
 * `setTimeout`) so all four LUT passes finish in the same turn — deferred
 * timeouts can still lose to a busy RAF under Electron.
 *
 * Import this module as the first side-effect import from `webgpu-atmosphere.ts`
 * and from the game/editor entries before any dynamic import that pulls the
 * post stack.
 */

type IdleCallback = (deadline: IdleDeadline) => void;

const root = globalThis as typeof globalThis & Window;

function installAtmosphereIdleBypass(): void {
  root.requestIdleCallback = ((callback: IdleCallback): number => {
    callback({
      didTimeout: false,
      timeRemaining: () => 16,
    });
    return 0;
  }) as typeof root.requestIdleCallback;

  root.cancelIdleCallback = (() => {
    // Synchronous shim never schedules work.
  }) as typeof root.cancelIdleCallback;
}

installAtmosphereIdleBypass();
