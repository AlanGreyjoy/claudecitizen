import { DEFAULT_BIOME_RECIPE } from './planets/schema';
import { getActivePlanetConfig } from './planets/runtime';

/** Default retained for validation and older call sites; runtime uses the active recipe. */
export const COAST_TREATMENT_MAX_HEIGHT_METERS =
  DEFAULT_BIOME_RECIPE.coastMaxHeightMeters;

/**
 * Lift the visible ocean into the flattened coastal shelf. Twenty metres leaves
 * a narrow dry coast band below the shore-treatment ceiling while filling the broad
 * coastal inlets that otherwise read as dry riverbeds.
 */
export const OCEAN_WATER_LEVEL_METERS =
  DEFAULT_BIOME_RECIPE.oceanWaterLevelMeters;

/**
 * Compress terrain around sea level into a broad shallow shelf. The cubic is
 * intentionally almost flat at the shoreline while leaving inland relief and
 * deep ocean terrain unchanged outside the coastal band.
 */
export function oceanWaterLevelMeters(): number {
  return getActivePlanetConfig().biomes.oceanWaterLevelMeters;
}

export function coastTreatmentMaxHeightMeters(): number {
  return getActivePlanetConfig().biomes.coastMaxHeightMeters;
}

export function coastalShelfHalfWidthNormalized(): number {
  return getActivePlanetConfig().biomes.coastalShelfHalfWidthNormalized;
}

export function applyCoastalShelf(elevationNormalized: number): number {
  const halfWidth = Math.max(0, coastalShelfHalfWidthNormalized());
  if (halfWidth === 0) return elevationNormalized;
  const magnitude = Math.abs(elevationNormalized);
  if (magnitude >= halfWidth) return elevationNormalized;

  const t = magnitude / halfWidth;
  const flattenedMagnitude = halfWidth * t * t * t;
  return Math.sign(elevationNormalized) * flattenedMagnitude;
}
