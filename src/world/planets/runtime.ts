import type { Planet } from '../../types';
import {
  createDefaultPlanetDocument,
  parsePlanetDocument,
  planetPhysicsFromDocument,
  type PlanetBiomePalette,
  type PlanetDocument,
  type PlanetHeightRecipe,
  type PlanetHydrologyRecipe,
  type PlanetRegionRecipe,
} from './schema';

/**
 * Active generation context for the currently loaded planet. Elevation, lakes,
 * rivers, regions, and terrain palette read from here so the existing
 * sample*(planet, seed, …) call sites stay stable. Workers activate the
 * config from their message before building a tile.
 */
export interface PlanetRuntimeConfig {
  document: PlanetDocument;
  planet: Planet;
  planetId: string;
  seed: number;
  height: PlanetHeightRecipe;
  regions: PlanetRegionRecipe;
  hydrology: PlanetHydrologyRecipe;
  palette: PlanetBiomePalette;
  /** Shallow ocean blend color (hex). */
  oceanShallow: string;
}

const DEFAULT_DOCUMENT = createDefaultPlanetDocument();

function configFromDocument(document: PlanetDocument): PlanetRuntimeConfig {
  return {
    document,
    planet: planetPhysicsFromDocument(document),
    planetId: document.id,
    seed: document.seed,
    height: document.height,
    regions: document.regions,
    hydrology: document.hydrology,
    palette: document.palette,
    oceanShallow: '#3f7898',
  };
}

let activeConfig: PlanetRuntimeConfig = configFromDocument(DEFAULT_DOCUMENT);

export function getActivePlanetConfig(): PlanetRuntimeConfig {
  return activeConfig;
}

export function activatePlanetDocument(document: PlanetDocument): PlanetRuntimeConfig {
  activeConfig = configFromDocument(document);
  return activeConfig;
}

export function activatePlanetConfig(config: PlanetRuntimeConfig): PlanetRuntimeConfig {
  activeConfig = config;
  return activeConfig;
}

export function planetConfigFromDocument(document: PlanetDocument): PlanetRuntimeConfig {
  return configFromDocument(document);
}

export function parseAndActivatePlanetDocument(raw: unknown): PlanetRuntimeConfig | null {
  const document = parsePlanetDocument(raw);
  if (!document) return null;
  return activatePlanetDocument(document);
}

/** Default Asteron physics used by call sites that only need Planet fields. */
export const CLAUDECITIZEN_PLANET: Planet = planetPhysicsFromDocument(DEFAULT_DOCUMENT);

export const DEFAULT_PLANET_ID = DEFAULT_DOCUMENT.id;
export const DEFAULT_PLANET_SEED = DEFAULT_DOCUMENT.seed;
