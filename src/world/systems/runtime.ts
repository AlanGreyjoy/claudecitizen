import {
  createDefaultSystemDocument,
  DEFAULT_STATION_ALTITUDE_METERS,
  parseSystemDocument,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from './schema';

/**
 * Active system layout for the current play/editor session.
 * Play bootstrap activates a document via `?systemId=` (default `default`).
 */
const DEFAULT_DOCUMENT = createDefaultSystemDocument();

let activeDocument: SystemDocument = DEFAULT_DOCUMENT;

export const DEFAULT_SYSTEM_ID = DEFAULT_DOCUMENT.id;

export function getActiveSystemDocument(): SystemDocument {
  return activeDocument;
}

export function activateSystemDocument(document: SystemDocument): SystemDocument {
  activeDocument = document;
  return activeDocument;
}

export function parseAndActivateSystemDocument(raw: unknown): SystemDocument | null {
  const document = parseSystemDocument(raw);
  if (!document) return null;
  return activateSystemDocument(document);
}

export function listSystemPlanets(system: SystemDocument): SystemPlanetEntry[] {
  return system.planets;
}

/** Planet entry whose `planetId` matches the active PlanetDocument id. */
export function findPlanetEntryByPlanetId(
  system: SystemDocument,
  planetDocumentId: string,
): SystemPlanetEntry | undefined {
  return system.planets.find((entry) => entry.planetId === planetDocumentId);
}

/**
 * Stations parented to a system planet entry id (or the star).
 * Inactive-parent stations are excluded when callers pass only the active entry.
 */
export function getSystemStationEntriesForPlanet(
  system: SystemDocument,
  parentBodyId: string,
): SystemStationEntry[] {
  return system.stations.filter((station) => station.parentBodyId === parentBodyId);
}

/** Stations whose parent is the active planet document (via matching planet entry). */
export function getSystemStationEntriesForPlanetDocument(
  system: SystemDocument,
  planetDocumentId: string,
): SystemStationEntry[] {
  const entry = findPlanetEntryByPlanetId(system, planetDocumentId);
  if (!entry) return [];
  return getSystemStationEntriesForPlanet(system, entry.id);
}

export function resolveStationAltitudeMeters(station: SystemStationEntry): number {
  return station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS;
}

/**
 * Pick the primary interactable station for this session.
 * Prefers an explicit map instance, then the scene being played (concourse or
 * owned Hab/Hangar), then a legacy prefab id, else the first entry.
 */
export function pickPrimarySystemStation(
  stations: SystemStationEntry[],
  preferred: {
    entryId?: string | null;
    prefabId?: string | null;
    sceneId?: string | null;
  } = {},
): SystemStationEntry | null {
  if (stations.length === 0) return null;
  if (preferred.entryId) {
    const match = stations.find((station) => station.id === preferred.entryId);
    if (match) return match;
  }
  if (preferred.sceneId) {
    const sceneId = preferred.sceneId;
    const match = stations.find(
      (station) =>
        station.sceneId === sceneId
        || station.hangarSceneId === sceneId
        || station.habSceneId === sceneId,
    );
    if (match) return match;
  }
  if (preferred.prefabId) {
    const match = stations.find(
      (station) => station.stationPrefabId === preferred.prefabId,
    );
    if (match) return match;
  }
  return stations[0] ?? null;
}

/** Human-readable geometry source of a station entry (for logs and UI). */
export function stationEntrySourceId(station: SystemStationEntry): string {
  return station.sceneId ? `scene:${station.sceneId}` : station.stationPrefabId ?? 'unknown';
}

/**
 * Look up a system station entry by map instance id, concourse scene id, or an
 * owned Hab/Hangar scene id. Prefers `entryId`, then concourse, then hangar/hab.
 */
export function findSystemStationEntry(
  system: SystemDocument,
  query: {
    entryId?: string | null;
    sceneId?: string | null;
    hangarSceneId?: string | null;
    habSceneId?: string | null;
  },
): SystemStationEntry | null {
  if (query.entryId) {
    const byId = system.stations.find((station) => station.id === query.entryId);
    if (byId) return byId;
  }
  if (query.sceneId) {
    const byScene = system.stations.find((station) => station.sceneId === query.sceneId);
    if (byScene) return byScene;
  }
  if (query.hangarSceneId) {
    const hangarSceneId = query.hangarSceneId.trim();
    if (hangarSceneId) {
      const byHangar = system.stations.find(
        (station) => station.hangarSceneId === hangarSceneId,
      );
      if (byHangar) return byHangar;
    }
  }
  if (query.habSceneId) {
    const habSceneId = query.habSceneId.trim();
    if (habSceneId) {
      const byHab = system.stations.find((station) => station.habSceneId === habSceneId);
      if (byHab) return byHab;
    }
  }
  return null;
}

/** Hangar scene owned by the station family, or empty when unset / unknown. */
export function resolveStationFamilyHangarSceneId(
  system: SystemDocument,
  query: {
    entryId?: string | null;
    sceneId?: string | null;
    hangarSceneId?: string | null;
    habSceneId?: string | null;
  },
): string {
  return findSystemStationEntry(system, query)?.hangarSceneId?.trim() ?? '';
}

/**
 * Station family that owns this hangar scene on the System Map, or null when
 * no entry lists it as `hangarSceneId`.
 */
export function resolveStationFamilyByHangarSceneId(
  system: SystemDocument,
  hangarSceneId: string,
): SystemStationEntry | null {
  return findSystemStationEntry(system, { hangarSceneId });
}

export function isStarParent(parentBodyId: string): boolean {
  return parentBodyId === SYSTEM_STAR_PARENT_ID;
}
