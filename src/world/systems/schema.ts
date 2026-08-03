/**
 * System documents place planets and orbital stations on a flat ecliptic
 * around a single star. Files live under src/world/systems/data/<id>.system.json.
 *
 * Stations are scene-first (concourse `sceneId`) with optional Hab/Hangar
 * ownership (`habSceneId` / `hangarSceneId`). Legacy `stationPrefabId` remains
 * as an XOR geometry source.
 *
 * Coordinates (v1):
 * - Star sits at (0, 0) on the ecliptic.
 * - `positionMeters.x/z` and `offsetMeters.x/z` are meters from the star /
 *   parent; there is no `y` / out-of-ecliptic placement in v1.
 * - Those meters are **play meters**: with the active planet at world origin,
 *   a station's `offsetMeters` is its ecliptic world position (y = 0).
 * - Display may convert to AU (`1 AU ≈ 1.496e11 m`); authoring uses meters.
 *
 * Default seed distances: planets near `SYSTEM_MAP_PLANET_DISTANCE_METERS`
 * (1e10 m ≈ 0.067 AU) so several bodies stay draggable on the 2D canvas.
 * Station offsets are often megameter-scale — that range is what you see from
 * the deck, not map-only decoration.
 */

export const SYSTEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parent id for stations orbiting the star directly. */
export const SYSTEM_STAR_PARENT_ID = 'star';

/**
 * Suggested planet distance from star for new / seed entries (meters).
 * ~1e10 m keeps several planets readable on a flat map; not Earth AU scale.
 */
export const SYSTEM_MAP_PLANET_DISTANCE_METERS = 10_000_000_000;

/** Suggested station offset magnitude from parent on the map (meters). */
export const SYSTEM_MAP_STATION_OFFSET_METERS = 50_000_000;

/**
 * Minimum clearance above the parent surface when `|offsetMeters|` is too short
 * to clear the crust. Far map offsets use the offset magnitude as orbital range.
 */
export const DEFAULT_STATION_ALTITUDE_METERS = 200_000;

export interface SystemEclipticMeters {
  x: number;
  z: number;
}

export interface SystemStar {
  name: string;
}

export interface SystemPlanetEntry {
  /** Unique within the system (often equals `planetId`). */
  id: string;
  /** References `PlanetDocument.id`. */
  planetId: string;
  /** Override display name; else use the planet document name. */
  name?: string;
  /** Ecliptic position in meters from the star. */
  positionMeters: SystemEclipticMeters;
}

export interface SystemStationEntry {
  /** Unique instance id within the system. */
  id: string;
  /**
   * Station geometry source. Exactly one is set: a station prefab document, or
   * a scene whose GameObjects author the station (compiled to the same shape by
   * `buildSceneStationDocument`).
   */
  stationPrefabId?: string;
  /** Scene id whose GameObjects author this station (concourse / shared lobby). */
  sceneId?: string;
  /**
   * Instanced Hab scene owned by this station family. Not a map marker — only
   * ownership for travel / boot wiring. Empty means family incomplete.
   */
  habSceneId?: string;
  /**
   * Instanced Hangar scene owned by this station family. AVMS To Hangar falls
   * back here when the terminal leaves `hangarSceneId` blank. Hangar → open
   * space fly-through uses this to find the family's `hangar-open-space-exit`.
   */
  hangarSceneId?: string;
  name: string;
  /** `"star"` or a `SystemPlanetEntry.id`. */
  parentBodyId: string;
  /** Offset from parent in system meters (ecliptic) — true play meters. */
  offsetMeters: SystemEclipticMeters;
  /**
   * Minimum orbit clearance above the parent surface. Used when `|offsetMeters|`
   * would place the station inside `radius + altitude`; otherwise the map
   * offset magnitude is the orbital range from the planet center.
   */
  altitudeMeters?: number;
}

export interface SystemDocument {
  id: string;
  name: string;
  star: SystemStar;
  planets: SystemPlanetEntry[];
  stations: SystemStationEntry[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readEclipticMeters(raw: unknown): SystemEclipticMeters | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  if (!isFiniteNumber(src.x) || !isFiniteNumber(src.z)) return null;
  return { x: src.x, z: src.z };
}

function readOptionalAltitude(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isFiniteNumber(raw)) return undefined;
  return raw;
}

/** Optional scene id; empty/missing → undefined; invalid pattern → sentinel fail. */
function readOptionalOwnedSceneId(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id) return undefined;
  if (!SYSTEM_ID_PATTERN.test(id)) return null;
  return id;
}

function parsePlanetEntry(raw: unknown): SystemPlanetEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  const planetId = typeof src.planetId === 'string' ? src.planetId.trim() : '';
  if (!SYSTEM_ID_PATTERN.test(id) || !SYSTEM_ID_PATTERN.test(planetId)) return null;
  const positionMeters = readEclipticMeters(src.positionMeters);
  if (!positionMeters) return null;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : undefined;
  return { id, planetId, name, positionMeters };
}

/** Exactly one geometry source: station prefab XOR concourse scene. */
function readStationGeometrySource(
  src: Record<string, unknown>,
): { stationPrefabId?: string; sceneId?: string } | null {
  const stationPrefabId =
    typeof src.stationPrefabId === 'string' ? src.stationPrefabId.trim() : '';
  const sceneId = typeof src.sceneId === 'string' ? src.sceneId.trim() : '';
  if (Boolean(stationPrefabId) === Boolean(sceneId)) return null;
  if (stationPrefabId && !SYSTEM_ID_PATTERN.test(stationPrefabId)) return null;
  if (sceneId && !SYSTEM_ID_PATTERN.test(sceneId)) return null;
  return {
    ...(stationPrefabId ? { stationPrefabId } : {}),
    ...(sceneId ? { sceneId } : {}),
  };
}

function readStationFamilyScenes(
  src: Record<string, unknown>,
): { habSceneId?: string; hangarSceneId?: string } | null {
  const habSceneId = readOptionalOwnedSceneId(src.habSceneId);
  const hangarSceneId = readOptionalOwnedSceneId(src.hangarSceneId);
  if (habSceneId === null || hangarSceneId === null) return null;
  return {
    ...(habSceneId ? { habSceneId } : {}),
    ...(hangarSceneId ? { hangarSceneId } : {}),
  };
}

function parseStationEntry(raw: unknown): SystemStationEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  const parentBodyId =
    typeof src.parentBodyId === 'string' ? src.parentBodyId.trim() : '';
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!SYSTEM_ID_PATTERN.test(id) || !name) return null;
  if (parentBodyId !== SYSTEM_STAR_PARENT_ID && !SYSTEM_ID_PATTERN.test(parentBodyId)) {
    return null;
  }
  const geometry = readStationGeometrySource(src);
  const family = readStationFamilyScenes(src);
  const offsetMeters = readEclipticMeters(src.offsetMeters);
  if (!geometry || !family || !offsetMeters) return null;
  return {
    id,
    ...geometry,
    ...family,
    name,
    parentBodyId,
    offsetMeters,
    altitudeMeters: readOptionalAltitude(src.altitudeMeters),
  };
}

function parsePlanetEntries(raw: unknown): SystemPlanetEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const planets: SystemPlanetEntry[] = [];
  const planetIds = new Set<string>();
  for (const entry of raw) {
    const planet = parsePlanetEntry(entry);
    if (!planet || planetIds.has(planet.id)) return null;
    planetIds.add(planet.id);
    planets.push(planet);
  }
  return planets;
}

function parseStationEntries(
  raw: unknown,
  planetIds: ReadonlySet<string>,
): SystemStationEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const stations: SystemStationEntry[] = [];
  const stationIds = new Set<string>();
  for (const entry of raw) {
    const station = parseStationEntry(entry);
    if (!station || stationIds.has(station.id)) return null;
    if (station.parentBodyId !== SYSTEM_STAR_PARENT_ID && !planetIds.has(station.parentBodyId)) {
      return null;
    }
    stationIds.add(station.id);
    stations.push(station);
  }
  return stations;
}

/** Validates and normalizes unknown JSON into a SystemDocument. */
export function parseSystemDocument(raw: unknown): SystemDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!SYSTEM_ID_PATTERN.test(id)) return null;
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : id;

  const starRaw = src.star && typeof src.star === 'object' ? (src.star as Record<string, unknown>) : {};
  const starName =
    typeof starRaw.name === 'string' && starRaw.name.trim() ? starRaw.name.trim() : 'Star';

  const planets = parsePlanetEntries(src.planets);
  if (!planets) return null;
  const planetIds = new Set(planets.map((planet) => planet.id));
  const stations = parseStationEntries(src.stations, planetIds);
  if (!stations) return null;

  return {
    id,
    name,
    star: { name: starName },
    planets,
    stations,
  };
}

export function createDefaultSystemDocument(
  id = 'default',
  name = 'Asteron System',
): SystemDocument {
  return {
    id,
    name,
    star: { name: 'Asteron Prime' },
    planets: [
      {
        id: 'asteron',
        planetId: 'asteron',
        name: 'Asteron',
        positionMeters: { x: SYSTEM_MAP_PLANET_DISTANCE_METERS, z: 0 },
      },
    ],
    stations: [
      {
        id: 'blackmarket-orbit',
        sceneId: 'blackmarket',
        habSceneId: 'blackmarkethab',
        hangarSceneId: 'blackmarkethanger',
        name: 'Black Market Station',
        parentBodyId: 'asteron',
        offsetMeters: {
          x: -SYSTEM_MAP_STATION_OFFSET_METERS,
          z: SYSTEM_MAP_STATION_OFFSET_METERS,
        },
        altitudeMeters: DEFAULT_STATION_ALTITUDE_METERS,
      },
    ],
  };
}
