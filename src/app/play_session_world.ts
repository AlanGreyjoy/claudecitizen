import type { LoadingScreenHandle } from './loading_screen';
import { CLAUDECITIZEN_PLANET, DEFAULT_PLANET_ID, DEFAULT_PLANET_SEED } from '../world/planet';
import { activatePlanetDocument } from '../world/planets/runtime';
import { loadPlanetDocument } from '../world/planets/loader';
import { createDefaultPlanetDocument } from '../world/planets/schema';
import { loadSystemDocument } from '../world/systems/loader';
import {
  activateSystemDocument,
  DEFAULT_SYSTEM_ID,
  getSystemStationEntriesForPlanetDocument,
  pickPrimarySystemStation,
  resolveStationAltitudeMeters,
} from '../world/systems/runtime';
import { hydrateSpawnPackFromUrl } from '../cache/spawn_pack';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station_runtime';
import {
  orbitHintFromSystemOffset,
  setStationLayoutOverride,
  setStationOrbitHint,
  getStationFrameAt,
  type StationFrame,
} from '../world/station';
import type { Planet } from '../types';
import type { PlanetDocument } from '../world/planets/schema';
import type { PrefabDocument } from '../world/prefabs/schema';

const DEFAULT_STATION_PREFAB_ID = 'demo-station';

export interface PlayWorldParams {
  planetId: string;
  systemId: string;
  spawnSurface: boolean;
  fromEditor: boolean;
  stationPrefabOverride: string | null;
}

export function readPlayWorldParams(): PlayWorldParams {
  const playParams = new URLSearchParams(window.location.search);
  return {
    planetId: playParams.get('planetId') ?? DEFAULT_PLANET_ID,
    systemId: playParams.get('systemId') ?? DEFAULT_SYSTEM_ID,
    spawnSurface: playParams.get('spawn') === 'surface',
    fromEditor: playParams.get('from') === 'editor',
    stationPrefabOverride: import.meta.env.DEV ? playParams.get('stationPrefab') : null,
  };
}

async function resolveStationPrefab(preferredId?: string | null): Promise<PrefabDocument | null> {
  const params = new URLSearchParams(window.location.search);
  const id = import.meta.env.DEV
    ? params.get('stationPrefab') ?? preferredId ?? DEFAULT_STATION_PREFAB_ID
    : preferredId ?? DEFAULT_STATION_PREFAB_ID;

  const doc = await loadPrefabDocument(id);
  if (!doc) {
    console.warn(`Station prefab "${id}" not found; using the procedural station.`);
    return null;
  }
  const layout = await buildStationLayoutFromPrefab(doc);
  if (!layout) {
    console.warn(`Station prefab "${id}" is not walkable; using the procedural station.`);
    return null;
  }
  setStationLayoutOverride(layout);
  console.info(`Station prefab active: "${id}".`);
  return doc;
}

export interface PlayWorldContext {
  params: PlayWorldParams;
  planetDocument: PlanetDocument;
  planet: Planet;
  seed: number;
  systemDocument: Awaited<ReturnType<typeof loadSystemDocument>>;
  primaryStation: ReturnType<typeof pickPrimarySystemStation>;
  stationPrefab: PrefabDocument | null;
  additionalStations: Array<{ prefab: PrefabDocument; frame: StationFrame }>;
}

async function loadAdditionalStations(
  systemStations: ReturnType<typeof getSystemStationEntriesForPlanetDocument>,
  primaryStation: ReturnType<typeof pickPrimarySystemStation>,
  planet: Planet,
): Promise<Array<{ prefab: PrefabDocument; frame: StationFrame }>> {
  const additionalStations: Array<{ prefab: PrefabDocument; frame: StationFrame }> = [];
  for (const entry of systemStations) {
    if (primaryStation && entry.id === primaryStation.id) continue;
    const prefab = await loadPrefabDocument(entry.stationPrefabId);
    if (!prefab) {
      console.warn(`Secondary station prefab "${entry.stationPrefabId}" missing; skipping.`);
      continue;
    }
    const hint = orbitHintFromSystemOffset(
      entry.offsetMeters,
      resolveStationAltitudeMeters(entry),
    );
    additionalStations.push({
      prefab,
      frame: getStationFrameAt(planet, hint.latRadians, hint.lonRadians, hint.altitudeMeters),
    });
  }
  if (additionalStations.length > 0) {
    console.info(
      `Spawned ${additionalStations.length} secondary system station(s) as visual roots (primary owns walk physics).`,
    );
  }
  return additionalStations;
}

export async function loadPlayWorldContext(
  loading: LoadingScreenHandle | undefined,
): Promise<PlayWorldContext> {
  const params = readPlayWorldParams();
  const planetDocument =
    (await loadPlanetDocument(params.planetId))
    ?? createDefaultPlanetDocument(params.planetId, params.planetId);
  const planetConfig = activatePlanetDocument(planetDocument);
  const seed = planetConfig.seed || DEFAULT_PLANET_SEED;
  const planet = planetConfig.planet.name
    ? planetConfig.planet
    : { ...CLAUDECITIZEN_PLANET, ...planetConfig.planet };

  if (params.spawnSurface) {
    loading?.setStatus('Seeding spawn tile cache...');
    await hydrateSpawnPackFromUrl(planetDocument.id);
  } else {
    loading?.setStatus('Loading orbital station...');
  }
  loading?.setProgress(0.22);

  const systemDocument =
    (await loadSystemDocument(params.systemId))
    ?? (params.systemId !== DEFAULT_SYSTEM_ID
      ? await loadSystemDocument(DEFAULT_SYSTEM_ID)
      : null);
  if (systemDocument) {
    activateSystemDocument(systemDocument);
    console.info(`System active: "${systemDocument.id}" (${systemDocument.name}).`);
  } else {
    console.warn(
      `System "${params.systemId}" not found; station placement falls back to the default orbital frame.`,
    );
    setStationOrbitHint(null);
  }

  const systemStations = systemDocument
    ? getSystemStationEntriesForPlanetDocument(systemDocument, planetDocument.id)
    : [];
  const primaryStation = pickPrimarySystemStation(systemStations, params.stationPrefabOverride);
  if (primaryStation) {
    setStationOrbitHint(
      orbitHintFromSystemOffset(
        primaryStation.offsetMeters,
        resolveStationAltitudeMeters(primaryStation),
      ),
    );
    console.info(
      `Primary station instance "${primaryStation.id}" (${primaryStation.stationPrefabId}) from system map.`,
    );
  } else {
    setStationOrbitHint(null);
  }

  const stationPrefab = await resolveStationPrefab(
    primaryStation?.stationPrefabId ?? DEFAULT_STATION_PREFAB_ID,
  );

  const additionalStations = await loadAdditionalStations(systemStations, primaryStation, planet);

  console.info(
    `Planet active: "${planetDocument.id}" seed=${seed}${params.spawnSurface ? ' (surface spawn)' : ''}.`,
  );

  return {
    params,
    planetDocument,
    planet,
    seed,
    systemDocument,
    primaryStation,
    stationPrefab,
    additionalStations,
  };
}
