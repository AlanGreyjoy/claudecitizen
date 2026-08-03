import type { LoadingScreenHandle } from './loading-screen';
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
  stationEntrySourceId,
} from '../world/systems/runtime';
import { loadStationEntryDocument } from '../world/systems/station-source';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station-runtime';
import {
  orbitHintFromSystemOffset,
  setStationLayoutOverride,
  setStationOrbitHint,
  getStationFrame,
  getStationFrameAt,
  type StationFrame,
} from '../world/station';
import {
  hangarOpenSpaceExitWorldPose,
  type HangarOpenSpaceExitWorldPose,
} from '../world/hangar-open-space-exit';
import type { Planet } from '../types';
import type { PlanetDocument } from '../world/planets/schema';
import type { PrefabDocument } from '../world/prefabs/schema';
import type { SceneDocument } from '../world/scenes/schema';
import { resolveScenePlayConfig, type ScenePlayContent, type SceneEnvironmentConfig, DEFAULT_SCENE_ENVIRONMENT } from '../world/scenes/scene-runtime';
import { buildSceneStationDocument } from '../world/scenes/scene-station';
import { AUTHORING_ENABLED } from '../build-mode';

const DEFAULT_STATION_PREFAB_ID = 'demo-station';

/** URL-driven play predates scene content declarations, so it boots everything. */
const ALL_CONTENT: ScenePlayContent = { planet: true, ship: true, station: true };

export interface PlayWorldParams {
  planetId: string;
  systemId: string;
  spawnSurface: boolean;
  fromEditor: boolean;
  stationPrefabOverride: string | null;
  /**
   * Ship prefab the scene placed, when it placed one. Without this the session
   * falls back to `DEFAULT_SHIP_PREFAB_ID`, which is why playing a ship prefab
   * used to hand you the Starhopper instead of the hull you had open.
   */
  shipPrefabOverride: string | null;
  /**
   * Editor ship playtest: the stage exists only to fly this hull, so the ship
   * spawns boardable (ramp down) instead of sealed like a story spawn.
   */
  shipTest: boolean;
  /**
   * Scene being played, when there is one. Its GameObjects are the station the
   * player walks on (`buildSceneStationDocument`), which is why the document
   * travels with the params instead of just its resolved ids.
   */
  scene: SceneDocument | null;
  /**
   * Subsystems the scene asked for. A planet document is still resolved when
   * `content.planet` is false — station frames and gravity need one — but the
   * terrain, vegetation, surface-spawn, and space environment stacks stay off.
   */
  content: ScenePlayContent;
  /** Normalized scene lighting / skybox overrides (outdoor + auto when unset). */
  environment: SceneEnvironmentConfig;
}

export function readPlayWorldParams(): PlayWorldParams {
  const playParams = new URLSearchParams(window.location.search);
  return {
    planetId: playParams.get('planetId') ?? DEFAULT_PLANET_ID,
    systemId: playParams.get('systemId') ?? DEFAULT_SYSTEM_ID,
    spawnSurface: playParams.get('spawn') === 'surface',
    fromEditor: playParams.get('from') === 'editor',
    stationPrefabOverride: AUTHORING_ENABLED ? playParams.get('stationPrefab') : null,
    shipPrefabOverride: AUTHORING_ENABLED ? playParams.get('shipPrefab') : null,
    shipTest: false,
    scene: null,
    content: { ...ALL_CONTENT },
    environment: { ...DEFAULT_SCENE_ENVIRONMENT },
  };
}

/** Resolve world config straight from a scene document's GameObjects. */
export function playWorldParamsFromScene(
  scene: SceneDocument,
  overrides: Partial<PlayWorldParams> = {},
): PlayWorldParams {
  const config = resolveScenePlayConfig(scene);
  return {
    planetId: config.planetId ?? DEFAULT_PLANET_ID,
    systemId: config.systemId ?? DEFAULT_SYSTEM_ID,
    spawnSurface: config.spawn === 'surface',
    fromEditor: false,
    stationPrefabOverride: config.stationPrefabId,
    shipPrefabOverride: config.shipPrefabId,
    shipTest: scene.kind === 'prefab-stage' && config.shipPrefabId !== null,
    scene,
    content: config.content,
    environment: config.environment,
    ...overrides,
  };
}

/**
 * When Play launches with `?scene=`, prefer GameObject-resolved config from
 * the scene document (GameManager / Planet / prefab-instance) over bare URL
 * params. URL params still win when the scene has no matching components.
 */
export async function readPlayWorldParamsFromScene(): Promise<PlayWorldParams> {
  const base = readPlayWorldParams();
  const sceneId = new URLSearchParams(window.location.search).get('scene');
  if (!sceneId) return base;
  try {
    const { loadSceneDocument } = await import('../world/scenes/loader');
    const { resolveScenePlayConfig } = await import('../world/scenes/scene-runtime');
    const scene = await loadSceneDocument(sceneId);
    if (!scene || (scene.gameObjects?.length ?? 0) === 0) return base;
    const config = resolveScenePlayConfig(scene);
    return {
      planetId: config.planetId ?? base.planetId,
      systemId: config.systemId ?? base.systemId,
      spawnSurface: config.spawn === 'surface',
      fromEditor: base.fromEditor,
      stationPrefabOverride:
        config.stationPrefabId
        ?? base.stationPrefabOverride,
      shipPrefabOverride: config.shipPrefabId ?? base.shipPrefabOverride,
      shipTest: scene.kind === 'prefab-stage' && config.shipPrefabId !== null,
      scene,
      content: config.content,
      environment: config.environment,
    };
  } catch {
    return base;
  }
}

/**
 * Makes a station document authoritative for gameplay: its colliders, spawn
 * point and markers replace the procedural station's. Scene-authored and
 * prefab-authored stations are the same document shape, so they share this.
 */
async function applyStationLayout(
  doc: PrefabDocument,
  label: string,
): Promise<PrefabDocument | null> {
  const layout = await buildStationLayoutFromPrefab(doc);
  if (!layout) {
    console.warn(`Station ${label} is not walkable; using the procedural station.`);
    return null;
  }
  setStationLayoutOverride(layout);
  console.info(`Station active: ${label}.`);
  return doc;
}

async function resolveStationPrefab(id: string): Promise<PrefabDocument | null> {
  const doc = await loadPrefabDocument(id);
  if (!doc) {
    console.warn(`Station prefab "${id}" not found; using the procedural station.`);
    return null;
  }
  return applyStationLayout(doc, `prefab "${id}"`);
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
  playedSceneId: string | null,
): Promise<Array<{ prefab: PrefabDocument; frame: StationFrame }>> {
  const additionalStations: Array<{ prefab: PrefabDocument; frame: StationFrame }> = [];
  for (const entry of systemStations) {
    if (primaryStation && entry.id === primaryStation.id) continue;
    // The scene being played is already the station around the player; drawing
    // it a second time as an orbital body would double it.
    if (playedSceneId && entry.sceneId === playedSceneId) continue;
    const prefab = await loadStationEntryDocument(entry);
    if (!prefab) continue;
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

/**
 * Resolves the system a scene sits in and the station instance it orbits.
 *
 * A scene that never named a planet is not placed in a system at all: skipping
 * the lookup also skips the secondary station prefabs, which are large
 * authoring packs an interior scene has no use for.
 */
async function activatePlayWorldSystem(
  params: PlayWorldParams,
  planetDocumentId: string,
): Promise<{
  systemDocument: Awaited<ReturnType<typeof loadSystemDocument>>;
  systemStations: ReturnType<typeof getSystemStationEntriesForPlanetDocument>;
  primaryStation: ReturnType<typeof pickPrimarySystemStation>;
}> {
  const systemDocument = !params.content.planet
    ? null
    : (await loadSystemDocument(params.systemId))
      ?? (params.systemId !== DEFAULT_SYSTEM_ID
        ? await loadSystemDocument(DEFAULT_SYSTEM_ID)
        : null);
  if (systemDocument) {
    activateSystemDocument(systemDocument);
    console.info(`System active: "${systemDocument.id}" (${systemDocument.name}).`);
  } else if (params.content.planet) {
    console.warn(
      `System "${params.systemId}" not found; station placement falls back to the default orbital frame.`,
    );
  }

  const systemStations = systemDocument
    ? getSystemStationEntriesForPlanetDocument(systemDocument, planetDocumentId)
    : [];
  const primaryStation = pickPrimarySystemStation(systemStations, {
    prefabId: params.stationPrefabOverride,
    sceneId: params.scene?.id ?? null,
  });
  if (primaryStation) {
    setStationOrbitHint(
      orbitHintFromSystemOffset(
        primaryStation.offsetMeters,
        resolveStationAltitudeMeters(primaryStation),
      ),
    );
    console.info(
      `Primary station instance "${primaryStation.id}" (${stationEntrySourceId(primaryStation)}) from system map.`,
    );
  } else {
    setStationOrbitHint(null);
  }
  return { systemDocument, systemStations, primaryStation };
}

/**
 * The station the player walks on this session.
 *
 * The scene they launched wins: its own GameObjects — inline geometry,
 * colliders, spawn point, placed prefabs — are compiled into a station
 * document. Only a scene that authors no station of its own falls back to the
 * system map's primary station, and then to the demo station (and that last
 * fallback only for scenes that expect a world around them).
 */
async function resolvePlayStation(
  params: PlayWorldParams,
  primaryStation: ReturnType<typeof pickPrimarySystemStation>,
): Promise<PrefabDocument | null> {
  const sceneStation = params.scene
    ? await buildSceneStationDocument(params.scene)
    : null;
  if (sceneStation) {
    return applyStationLayout(sceneStation, `scene "${sceneStation.id}"`);
  }
  if (primaryStation?.sceneId && !params.stationPrefabOverride) {
    const document = await loadStationEntryDocument(primaryStation);
    if (document) {
      return applyStationLayout(document, `scene "${primaryStation.sceneId}"`);
    }
  }
  const stationPrefabId =
    params.stationPrefabOverride
    ?? primaryStation?.stationPrefabId
    ?? (params.content.planet ? DEFAULT_STATION_PREFAB_ID : null);
  return stationPrefabId ? resolveStationPrefab(stationPrefabId) : null;
}

/**
 * World pose for flying out of a station hangar into open space.
 *
 * Loads the named station prefab only to read its `hangar-open-space-exit`
 * marker — does not replace the session's walkable station layout. Orbit frame
 * must already be set for that station (via `stationPrefabOverride` / primary).
 */
export async function resolveHangarOpenSpaceArrivalPose(
  planet: Planet,
  stationPrefabId: string,
): Promise<HangarOpenSpaceExitWorldPose | null> {
  const id = stationPrefabId.trim();
  if (!id) return null;
  const doc = await loadPrefabDocument(id);
  if (!doc) {
    console.warn(
      `Open-space arrival station prefab "${id}" not found; using default open-space spawn.`,
    );
    return null;
  }
  const layout = await buildStationLayoutFromPrefab(doc);
  const marker = layout?.hangarOpenSpaceExit ?? null;
  if (!marker) {
    console.warn(
      `Station prefab "${id}" has no hangar-open-space-exit marker; using default open-space spawn.`,
    );
    return null;
  }
  return hangarOpenSpaceExitWorldPose(getStationFrame(planet), marker);
}

/** Fly-through `@space` arrival: prefer the exit's station for orbit + mouth pose. */
export async function resolveOpenSpaceFlyThroughWorld(
  loading: LoadingScreenHandle | undefined,
  options: {
    worldParams?: PlayWorldParams;
    networkTarget?: {
      arrival?: 'default' | 'in-ship';
      stationPrefabId?: string;
    } | null;
  },
): Promise<{
  world: PlayWorldContext;
  arrival: 'default' | 'in-ship';
  spaceSpawnPose: HangarOpenSpaceExitWorldPose | null;
}> {
  const arrival = options.networkTarget?.arrival ?? 'default';
  const arrivalStationPrefabId =
    arrival === 'in-ship' ? options.networkTarget?.stationPrefabId?.trim() ?? '' : '';
  let worldParams = options.worldParams;
  if (arrivalStationPrefabId) {
    const base = worldParams ?? (await readPlayWorldParamsFromScene());
    worldParams = { ...base, stationPrefabOverride: arrivalStationPrefabId };
  }
  const world = await loadPlayWorldContext(loading, worldParams);
  const spaceSpawnPose =
    arrival === 'in-ship' && arrivalStationPrefabId
      ? await resolveHangarOpenSpaceArrivalPose(world.planet, arrivalStationPrefabId)
      : null;
  if (arrival === 'in-ship' && !arrivalStationPrefabId) {
    console.warn(
      'Open-space fly-through scene-exit has no stationPrefabId; using default open-space spawn.',
    );
  }
  return { world, arrival, spaceSpawnPose };
}

export async function loadPlayWorldContext(
  loading: LoadingScreenHandle | undefined,
  paramsOverride?: PlayWorldParams,
): Promise<PlayWorldContext> {
  const params = paramsOverride ?? (await readPlayWorldParamsFromScene());
  const planetDocument =
    (await loadPlanetDocument(params.planetId))
    ?? createDefaultPlanetDocument(params.planetId, params.planetId);
  const planetConfig = activatePlanetDocument(planetDocument);
  const seed = planetConfig.seed || DEFAULT_PLANET_SEED;
  const planet = planetConfig.planet.name
    ? planetConfig.planet
    : { ...CLAUDECITIZEN_PLANET, ...planetConfig.planet };

  loading?.setStatus(
    params.spawnSurface ? 'Loading surface...' : 'Loading orbital station...',
  );
  loading?.setProgress(0.22);

  const { systemDocument, systemStations, primaryStation } = await activatePlayWorldSystem(
    params,
    planetDocument.id,
  );

  const stationPrefab = await resolvePlayStation(params, primaryStation);

  const additionalStations = await loadAdditionalStations(
    systemStations,
    primaryStation,
    planet,
    params.scene?.id ?? null,
  );

  console.info(
    params.content.planet
      ? `Planet active: "${planetDocument.id}" seed=${seed}${params.spawnSurface ? ' (surface spawn)' : ''}.`
      : `Interior scene: planet "${planetDocument.id}" supplies frame math only (no terrain streaming).`,
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
