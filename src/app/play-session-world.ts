import type { LoadingScreenHandle } from './loading-screen';
import { CLAUDECITIZEN_PLANET, DEFAULT_PLANET_ID, DEFAULT_PLANET_SEED } from '../world/planet';
import { activatePlanetDocument, getActivePlanetConfig } from '../world/planets/runtime';
import { loadPlanetDocument } from '../world/planets/loader';
import { createDefaultPlanetDocument } from '../world/planets/schema';
import { loadSystemDocument } from '../world/systems/loader';
import {
  activateSystemDocument,
  DEFAULT_SYSTEM_ID,
  getActiveSystemDocument,
  getSystemStationEntriesForPlanetDocument,
  pickPrimarySystemStation,
  findSystemStationEntry,
  resolveStationFamilyByHangarSceneId,
  stationEntrySourceId,
} from '../world/systems/runtime';
import { loadStationEntryDocument } from '../world/systems/station-source';
import type { SystemDocument, SystemStationEntry } from '../world/systems/schema';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station-runtime';
import {
  orbitHintFromOrigin,
  setStationLayoutOverride,
  setStationOrbitHint,
  getStationFrame,
  getStationFrameFromOrigin,
  stationLocalToWorld,
  type StationFrame,
} from '../world/station';
import { stationBodyWorldPosition } from '../world/systems/placement';
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

/** Clearance above a station body when arriving without a bay-mouth marker. */
const STATION_ORBIT_FALLBACK_OFFSET_METERS = 400;

/** URL-driven play predates scene content declarations, so it boots everything. */
const ALL_CONTENT: ScenePlayContent = { planet: true, ship: true, station: true };

export interface PlayWorldParams {
  planetId: string;
  systemId: string;
  spawnSurface: boolean;
  fromEditor: boolean;
  stationPrefabOverride: string | null;
  /**
   * System Map station instance to prefer as primary (open-space fly-through
   * ownership). Wins over scene/prefab matching in `pickPrimarySystemStation`.
   */
  stationEntryOverride: string | null;
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
    stationEntryOverride: null,
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
    stationEntryOverride: null,
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
      stationEntryOverride: base.stationEntryOverride,
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

/**
 * Every other station body in the system, placed at its true map position.
 *
 * Not filtered to the active planet's children: Open Space is the whole star
 * system, so a station orbiting a different planet — or parked on the star — is
 * still a body in this host. It is placed here and the secondary-station loader
 * decides whether its mesh is worth building yet from distance alone.
 */
async function loadAdditionalStations(
  systemDocument: SystemDocument | null,
  primaryStation: ReturnType<typeof pickPrimarySystemStation>,
  planet: Planet,
  activePlanetDocumentId: string,
  playedSceneId: string | null,
): Promise<Array<{ prefab: PrefabDocument; frame: StationFrame }>> {
  if (!systemDocument) return [];
  const additionalStations: Array<{ prefab: PrefabDocument; frame: StationFrame }> = [];
  for (const entry of systemDocument.stations) {
    if (primaryStation && entry.id === primaryStation.id) continue;
    // The scene being played is already the station around the player; drawing
    // it a second time as an orbital body would double it.
    if (playedSceneId && entry.sceneId === playedSceneId) continue;
    const prefab = await loadStationEntryDocument(entry);
    if (!prefab) continue;
    additionalStations.push({
      prefab,
      frame: getStationFrameFromOrigin(
        planet,
        stationBodyWorldPosition(
          systemDocument,
          activePlanetDocumentId,
          planet.radiusMeters,
          entry,
        ),
      ),
    });
  }
  if (additionalStations.length > 0) {
    console.info(
      `Placed ${additionalStations.length} secondary system station body/bodies at map meters `
      + '(primary owns walk physics; meshes stream in on approach).',
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
  planet: Planet,
  planetDocumentId: string,
): Promise<{
  systemDocument: Awaited<ReturnType<typeof loadSystemDocument>>;
  systemStations: ReturnType<typeof getSystemStationEntriesForPlanetDocument>;
  primaryStation: ReturnType<typeof pickPrimarySystemStation>;
}> {
  // An `exit-hangar` arrival names its station family directly, and that family
  // is what supplies the orbit frame the mouth pose is built in — so the system
  // document has to load even for a host scene that streams no terrain.
  const needsSystem = params.content.planet || params.stationEntryOverride !== null;
  const systemDocument = !needsSystem
    ? null
    : (await loadSystemDocument(params.systemId))
      ?? (params.systemId !== DEFAULT_SYSTEM_ID
        ? await loadSystemDocument(DEFAULT_SYSTEM_ID)
        : null);
  if (systemDocument) {
    activateSystemDocument(systemDocument);
    console.info(`System active: "${systemDocument.id}" (${systemDocument.name}).`);
  } else if (needsSystem) {
    console.warn(
      `System "${params.systemId}" not found; station placement falls back to the default orbital frame.`,
    );
  }

  const systemStations = systemDocument
    ? getSystemStationEntriesForPlanetDocument(systemDocument, planetDocumentId)
    : [];
  // An explicit arrival entry outranks the active-planet filter. `systemStations`
  // only holds bodies parented to the planet this scene names, and
  // `pickPrimarySystemStation` returns null on an empty list *before* it ever
  // looks at `entryId` — so filtering first would silently drop the very family
  // the player just flew out of and leave the orbit hint unset.
  const primaryStation =
    (systemDocument && params.stationEntryOverride
      ? findSystemStationEntry(systemDocument, { entryId: params.stationEntryOverride })
      : null)
    ?? pickPrimarySystemStation(systemStations, {
      entryId: params.stationEntryOverride,
      prefabId: params.stationPrefabOverride,
      sceneId: params.scene?.id ?? null,
    });
  if (primaryStation && systemDocument) {
    // Through the placement module, so a station orbiting another planet lands
    // at its real map position instead of that offset applied to this planet.
    setStationOrbitHint(
      orbitHintFromOrigin(
        planet,
        stationBodyWorldPosition(
          systemDocument,
          planetDocumentId,
          planet.radiusMeters,
          primaryStation,
        ),
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
 * Ship pose beside a station body when the body is known but its bay mouth is
 * not. Sits at the station's own ecliptic orbit, offset "up" so the hull is not
 * inside the hull, facing along the orbit track.
 *
 * The point is that a missing marker must never drop the player to the planet:
 * the generic open-space spawn is 1.5× atmosphere height above the landing
 * site, which for a station megameters out reads as "it teleported me home".
 */
function stationOrbitFallbackPose(frame: StationFrame): HangarOpenSpaceExitWorldPose {
  return {
    position: stationLocalToWorld(frame, {
      right: 0,
      up: STATION_ORBIT_FALLBACK_OFFSET_METERS,
      forward: 0,
    }),
    forward: frame.forward,
    up: frame.up,
  };
}

/**
 * World pose for flying out of a station hangar into open space.
 *
 * Loads the station family document only to read its `hangar-open-space-exit`
 * marker — does not replace the session's walkable station layout.
 *
 * The frame comes from **this entry's** System Map offset, not from
 * `getStationFrame`. That global reads a module-level orbit hint set elsewhere
 * during world load; when it is unset or belongs to a different body, the mouth
 * gets built at the default landing site 200 km over the planet instead of at
 * the station — which is exactly the "it flew me down to the planet" symptom.
 * Deriving the frame from the entry removes the ordering dependency entirely.
 */
export async function resolveHangarOpenSpaceArrivalPose(
  planet: Planet,
  entry: SystemStationEntry,
): Promise<HangarOpenSpaceExitWorldPose | null> {
  const frame = getStationFrameFromOrigin(
    planet,
    stationBodyWorldPosition(
      getActiveSystemDocument(),
      getActivePlanetConfig().planetId,
      planet.radiusMeters,
      entry,
    ),
  );
  const doc = await loadStationEntryDocument(entry);
  const label = stationEntrySourceId(entry);
  if (!doc) {
    console.warn(
      `Open-space arrival station "${entry.id}" (${label}) not found; arriving beside its map orbit instead.`,
    );
    return stationOrbitFallbackPose(frame);
  }
  const layout = await buildStationLayoutFromPrefab(doc);
  const marker = layout?.hangarOpenSpaceExit ?? null;
  if (!marker) {
    console.warn(
      `Station "${entry.id}" (${label}) has no hangar-open-space-exit marker; `
      + 'arriving beside its map orbit. Add the marker at the bay mouth.',
    );
    return stationOrbitFallbackPose(frame);
  }
  return hangarOpenSpaceExitWorldPose(frame, marker);
}

/** Legacy prefab-only mouth when the exit names a hull not on the System Map. */
async function resolveHangarOpenSpaceArrivalPoseFromPrefab(
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

/**
 * Station family for an open-space fly-through: System Map hangar ownership
 * first, then a legacy prefab id match on the map.
 */
function resolveOpenSpaceArrivalStation(
  system: SystemDocument | null,
  fromHangarSceneId: string,
  legacyStationPrefabId: string,
): SystemStationEntry | null {
  if (!system) return null;
  if (fromHangarSceneId) {
    const byHangar = resolveStationFamilyByHangarSceneId(system, fromHangarSceneId);
    if (byHangar) return byHangar;
  }
  if (!legacyStationPrefabId) return null;
  return (
    system.stations.find((station) => station.stationPrefabId === legacyStationPrefabId) ?? null
  );
}

async function loadSystemDocumentForPlay(systemId: string): Promise<SystemDocument | null> {
  return (
    (await loadSystemDocument(systemId))
    ?? (systemId !== DEFAULT_SYSTEM_ID ? await loadSystemDocument(DEFAULT_SYSTEM_ID) : null)
  );
}

/** Prefer the owning family as primary so orbit matches the hangar mouth. */
async function worldParamsForOpenSpaceArrival(
  base: PlayWorldParams,
  fromHangarSceneId: string,
  legacyStationPrefabId: string,
): Promise<PlayWorldParams> {
  if (!fromHangarSceneId && !legacyStationPrefabId) return base;
  const systemDocument = await loadSystemDocumentForPlay(base.systemId);
  const owning = resolveOpenSpaceArrivalStation(
    systemDocument,
    fromHangarSceneId,
    legacyStationPrefabId,
  );
  if (owning) {
    return {
      ...base,
      stationEntryOverride: owning.id,
      // Scene-backed families must not force the legacy prefab layout path.
      stationPrefabOverride: owning.sceneId ? null : (owning.stationPrefabId ?? null),
    };
  }
  if (legacyStationPrefabId) {
    return { ...base, stationPrefabOverride: legacyStationPrefabId };
  }
  return base;
}

async function resolveOpenSpaceSpawnPose(
  world: PlayWorldContext,
  fromHangarSceneId: string,
  legacyStationPrefabId: string,
): Promise<HangarOpenSpaceExitWorldPose | null> {
  const owning =
    resolveOpenSpaceArrivalStation(
      world.systemDocument,
      fromHangarSceneId,
      legacyStationPrefabId,
    )
    ?? world.primaryStation;
  if (owning) return resolveHangarOpenSpaceArrivalPose(world.planet, owning);
  if (legacyStationPrefabId) {
    return resolveHangarOpenSpaceArrivalPoseFromPrefab(world.planet, legacyStationPrefabId);
  }
  // Nothing on the map claims this hangar, so there is no orbit to arrive at —
  // the generic planet-relative spawn is all that is left. Name the authoring
  // fix, because the symptom (dropped near the planet) does not suggest it.
  console.warn(
    'Open-space departure: no System Map station lists this hangar as its Hangar Scene '
    + `(fromHangarSceneId="${fromHangarSceneId}"), so there is no orbit to arrive at. `
    + 'Set that station entry\'s Hangar Scene on the System Map. Falling back to the '
    + 'generic open-space spawn above the planet.',
  );
  return null;
}

/** Fly-through `@space` arrival: ownership finds orbit + hangar mouth pose. */
export async function resolveOpenSpaceFlyThroughWorld(
  loading: LoadingScreenHandle | undefined,
  options: {
    worldParams?: PlayWorldParams;
    networkTarget?: {
      arrival?: 'default' | 'in-ship';
      fromHangarSceneId?: string;
      stationPrefabId?: string;
    } | null;
  },
): Promise<{
  world: PlayWorldContext;
  arrival: 'default' | 'in-ship';
  spaceSpawnPose: HangarOpenSpaceExitWorldPose | null;
}> {
  const arrival = options.networkTarget?.arrival ?? 'default';
  const inShip = arrival === 'in-ship';
  const fromHangarSceneId = inShip
    ? options.networkTarget?.fromHangarSceneId?.trim() ?? ''
    : '';
  const legacyStationPrefabId = inShip
    ? options.networkTarget?.stationPrefabId?.trim() ?? ''
    : '';
  const baseParams = options.worldParams ?? (await readPlayWorldParamsFromScene());
  const worldParams = inShip
    ? await worldParamsForOpenSpaceArrival(baseParams, fromHangarSceneId, legacyStationPrefabId)
    : baseParams;
  const world = await loadPlayWorldContext(loading, worldParams);
  const spaceSpawnPose = inShip
    ? await resolveOpenSpaceSpawnPose(world, fromHangarSceneId, legacyStationPrefabId)
    : null;
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

  const { systemDocument, primaryStation } = await activatePlayWorldSystem(
    params,
    planet,
    planetDocument.id,
  );

  const stationPrefab = await resolvePlayStation(params, primaryStation);

  const additionalStations = await loadAdditionalStations(
    systemDocument,
    primaryStation,
    planet,
    planetDocument.id,
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
