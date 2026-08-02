import type { PlanetCloudLayerRecipe } from './planets/sky-schema';

/**
 * Cloud-deck helpers shared by the renderer.
 *
 * The deck itself is authored per planet (`sky.clouds` in the planet
 * document); this module only owns the seed-to-phase mapping and the drift
 * bookkeeping that has to be identical for every layer.
 *
 * The coverage field itself lives in TSL in
 * `src/render/effects/clouds/shell-node-material.ts`. There is deliberately no
 * CPU mirror of it: nothing outside the shader samples cloud cover, and a
 * hand-maintained JS copy of a GPU noise field drifts out of parity the first
 * time either side is tuned.
 */

/** Decorrelates each layer's noise field from the others. */
export function phaseFromSeed(seed: number, layerIndex: number): number {
  return (((seed + layerIndex * 131) % 997) / 997) * Math.PI * 2;
}

/**
 * Radians the deck has rotated about the planet's spin axis at `nowSeconds`.
 *
 * Wind is authored in meters per second, which is the unit an author can
 * reason about; the deck is a rotating shell, so it has to become an angular
 * rate. Dividing by the shell radius is that conversion, and it is what keeps
 * "12 m/s" looking like 12 m/s on a moon as well as on a gas giant.
 */
export function cloudDriftAngle(
  layer: PlanetCloudLayerRecipe,
  shellRadiusMeters: number,
  nowSeconds: number,
): number {
  return (nowSeconds * layer.windMetersPerSecond) / Math.max(shellRadiusMeters, 1);
}
