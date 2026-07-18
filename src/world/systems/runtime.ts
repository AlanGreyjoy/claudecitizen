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
 * Prefers an entry whose prefab matches `preferredPrefabId`, else the first.
 */
export function pickPrimarySystemStation(
  stations: SystemStationEntry[],
  preferredPrefabId: string | null,
): SystemStationEntry | null {
  if (stations.length === 0) return null;
  if (preferredPrefabId) {
    const match = stations.find((station) => station.stationPrefabId === preferredPrefabId);
    if (match) return match;
  }
  return stations[0] ?? null;
}

export function isStarParent(parentBodyId: string): boolean {
  return parentBodyId === SYSTEM_STAR_PARENT_ID;
}
