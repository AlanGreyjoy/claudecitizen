/**
 * Leaf module for the renderable-grid constants.
 *
 * These live apart from `renderable-surface.ts` because the height-page modules
 * need them at module-evaluation time while `renderable-surface.ts` imports the
 * page table back — a cycle that would leave these in the temporal dead zone
 * depending on which module the bundler happened to enter first. A leaf has no
 * imports, so it always finishes initialising before anything reads it.
 *
 * Mesh segment count must stay fixed: the low-poly triangle layout, foot
 * sampler, lake mesh, height rasters, and disk cache all assume this shared
 * grid resolution.
 */
export const RENDER_SURFACE_LEVEL = 17;
export const RENDER_SURFACE_SEGMENTS = 24;
