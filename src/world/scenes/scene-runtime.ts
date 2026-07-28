import type {
  PrefabComponent,
  PrefabEntity,
  SceneInstanceScope,
  SceneUiScreen,
} from '../prefabs/schema';
import type { SceneDocument } from './schema';
import { sceneHasStationContent } from './scene-station';

/**
 * What a scene's GameObjects actually ask the runtime to boot.
 *
 * Play used to start the same monolithic world for every gameplay scene, so an
 * interior scene still paid for planet streaming and a default player ship it
 * never referenced. These flags let `play-session` boot only the subsystems the
 * author placed in the scene.
 */
export interface ScenePlayContent {
  /** Scene names a planet (`game-manager` / `planet`) or spawns on the surface. */
  planet: boolean;
  /** Scene places a ship prefab instance. */
  ship: boolean;
  /** Scene authors a station: inline geometry/markers or a placed prefab. */
  station: boolean;
}

export interface ScenePlayConfig {
  /** Null when the scene never authored a `game-manager`. */
  systemId: string | null;
  /** Null when the scene authored neither `game-manager` nor `planet`. */
  planetId: string | null;
  spawn: 'station' | 'surface';
  /** Auth surface. Null when unset — the boot scene mounts title UI itself. */
  titleSceneId: string | null;
  /**
   * Character-creator scene when the signed-in player has no appearance.
   * Null when unset — callers may use the inline create gate.
   */
  characterCreateSceneId: string | null;
  /**
   * Hab / gameplay scene `game-manager` sends the player to after auth.
   * Null when unset — callers fall back to `scene-link`.
   */
  startingSceneId: string | null;
  /** Open-space scene the `@space` scene-exit token resolves to. */
  openSpaceSceneId: string | null;
  /** Scene shown between hops. Null uses the built-in loading overlay. */
  loadingSceneId: string | null;
  /** Null when the scene never authored it — the flow defaults it to true. */
  requireAuth: boolean | null;
  /** Signed-in players bypass the title surface. */
  skipTitleWhenSignedIn: boolean;
  /** First authoritative station prefab instance in the scene, if any. */
  stationPrefabId: string | null;
  /** First ship prefab instance in the scene, if any. */
  shipPrefabId: string | null;
  /** All prefab-instance references in document order. */
  prefabInstances: Array<{
    entityId: string;
    prefabId: string;
    prefabKind?: 'station' | 'ship' | 'site' | 'prop' | 'item';
    transform: PrefabEntity['transform'];
  }>;
  /** UI surfaces the scene mounts, in document order. */
  uiScreens: Array<{ screen: SceneUiScreen; menuId?: string }>;
  /** Scene transitions authored on this scene's GameObjects. */
  sceneLinks: Array<{
    entityId: string;
    sceneId: string;
    auto: boolean;
    delaySeconds: number;
  }>;
  /** Set when the scene is per-player instanced content (hab, hangar). */
  instanceScope: SceneInstanceScope | null;
  /** Subsystems the scene's GameObjects actually reference. */
  content: ScenePlayContent;
}

function walkEntities(
  entities: PrefabEntity[],
  visit: (entity: PrefabEntity) => void,
): void {
  for (const entity of entities) {
    visit(entity);
    if (entity.children?.length) walkEntities(entity.children, visit);
  }
}

function findComponent<T extends PrefabComponent['type']>(
  entity: PrefabEntity,
  type: T,
): Extract<PrefabComponent, { type: T }> | null {
  for (const component of entity.components ?? []) {
    if (component.type === type) {
      return component as Extract<PrefabComponent, { type: T }>;
    }
  }
  return null;
}

/** Hop fields copied verbatim from `game-manager` onto the play config. */
const SCENE_FLOW_REF_KEYS = [
  'titleSceneId',
  'characterCreateSceneId',
  'startingSceneId',
  'openSpaceSceneId',
  'loadingSceneId',
] as const;

type SceneFlowRefKey = (typeof SCENE_FLOW_REF_KEYS)[number];

interface ScenePlayAccum extends Record<SceneFlowRefKey, string | null> {
  systemId: string | null;
  planetId: string | null;
  spawn: ScenePlayConfig['spawn'];
  requireAuth: boolean | null;
  skipTitleWhenSignedIn: boolean;
  stationPrefabId: string | null;
  shipPrefabId: string | null;
  instanceScope: SceneInstanceScope | null;
  requiresPlanet: boolean;
  prefabInstances: ScenePlayConfig['prefabInstances'];
  uiScreens: ScenePlayConfig['uiScreens'];
  sceneLinks: ScenePlayConfig['sceneLinks'];
}

function collectGameManagerFields(
  entity: PrefabEntity,
  out: ScenePlayAccum,
): void {
  const gameManager = findComponent(entity, 'game-manager');
  if (!gameManager) return;
  out.systemId = gameManager.systemId;
  out.planetId = gameManager.planetId;
  out.spawn = gameManager.spawn;
  for (const key of SCENE_FLOW_REF_KEYS) {
    const sceneId = gameManager[key];
    if (sceneId) out[key] = sceneId;
  }
  if (gameManager.requireAuth !== undefined) out.requireAuth = gameManager.requireAuth;
  if (gameManager.skipTitleWhenSignedIn !== undefined) {
    out.skipTitleWhenSignedIn = gameManager.skipTitleWhenSignedIn;
  }
  out.requiresPlanet = true;
}

function collectPrefabInstanceFields(
  entity: PrefabEntity,
  out: ScenePlayAccum,
): void {
  const instance = findComponent(entity, 'prefab-instance');
  if (!instance) return;
  out.prefabInstances.push({
    entityId: entity.id,
    prefabId: instance.prefabId,
    prefabKind: instance.prefabKind,
    transform: entity.transform,
  });
  if (
    !out.stationPrefabId
    && (instance.prefabKind === 'station' || instance.prefabKind === undefined)
  ) {
    out.stationPrefabId = instance.prefabId;
  }
  if (!out.shipPrefabId && instance.prefabKind === 'ship') {
    out.shipPrefabId = instance.prefabId;
  }
}

function collectScenePlayEntity(entity: PrefabEntity, out: ScenePlayAccum): void {
  collectGameManagerFields(entity, out);
  const planet = findComponent(entity, 'planet');
  if (planet) {
    out.planetId = planet.planetId;
    out.requiresPlanet = true;
  }
  const playerStart = findComponent(entity, 'player-start');
  if (playerStart) {
    out.spawn = playerStart.spawn;
    if (playerStart.spawn === 'surface') out.requiresPlanet = true;
  }
  collectPrefabInstanceFields(entity, out);
  const uiScreen = findComponent(entity, 'ui-screen');
  if (uiScreen) {
    out.uiScreens.push({
      screen: uiScreen.screen,
      ...(uiScreen.menuId ? { menuId: uiScreen.menuId } : {}),
    });
  }
  const sceneLink = findComponent(entity, 'scene-link');
  // An unset target is a placeholder the author has not filled in yet.
  if (sceneLink?.sceneId) {
    out.sceneLinks.push({
      entityId: entity.id,
      sceneId: sceneLink.sceneId,
      auto: sceneLink.auto === true,
      delaySeconds: sceneLink.delaySeconds ?? 0,
    });
  }
  const instanced = findComponent(entity, 'instanced-scene');
  if (instanced) out.instanceScope = instanced.scope;
}

/** Resolve Unity-style scene GameObject components into play config. */
export function resolveScenePlayConfig(scene: SceneDocument): ScenePlayConfig {
  const out: ScenePlayAccum = {
    systemId: null,
    planetId: null,
    spawn: 'station',
    titleSceneId: null,
    characterCreateSceneId: null,
    startingSceneId: null,
    openSpaceSceneId: null,
    loadingSceneId: null,
    requireAuth: null,
    skipTitleWhenSignedIn: false,
    stationPrefabId: null,
    shipPrefabId: null,
    instanceScope: null,
    // Naming a planet or spawning on the surface is what makes a scene need the
    // terrain stack; placing a station in orbit on its own does not.
    requiresPlanet: false,
    prefabInstances: [],
    uiScreens: [],
    sceneLinks: [],
  };

  walkEntities(scene.gameObjects ?? [], (entity) => collectScenePlayEntity(entity, out));

  return {
    systemId: out.systemId,
    planetId: out.planetId,
    spawn: out.spawn,
    titleSceneId: out.titleSceneId,
    characterCreateSceneId: out.characterCreateSceneId,
    startingSceneId: out.startingSceneId,
    openSpaceSceneId: out.openSpaceSceneId,
    loadingSceneId: out.loadingSceneId,
    requireAuth: out.requireAuth,
    skipTitleWhenSignedIn: out.skipTitleWhenSignedIn,
    stationPrefabId: out.stationPrefabId,
    shipPrefabId: out.shipPrefabId,
    prefabInstances: out.prefabInstances,
    uiScreens: out.uiScreens,
    sceneLinks: out.sceneLinks,
    instanceScope: out.instanceScope,
    content: {
      planet: out.requiresPlanet,
      ship: out.shipPrefabId !== null,
      // A scene can author its station inline (GLB GameObjects, colliders,
      // spawn point) instead of placing a station prefab.
      station: out.stationPrefabId !== null || sceneHasStationContent(scene),
    },
  };
}

/**
 * The authored game pipeline: every hop plus the world knobs the boot scene
 * hands down to whatever scene it sends the player to.
 *
 * This travels with the session rather than being re-read per scene, because
 * the scenes it points at (Title, Character Create) deliberately author no
 * `game-manager` of their own — the flow is configured in exactly one place.
 */
export interface SceneEntryFlow {
  titleSceneId: string | null;
  characterCreateSceneId: string | null;
  startingSceneId: string | null;
  openSpaceSceneId: string | null;
  loadingSceneId: string | null;
  requireAuth: boolean;
  skipTitleWhenSignedIn: boolean;
  systemId: string | null;
  planetId: string | null;
  spawn: 'station' | 'surface';
}

/**
 * Snapshot the Game Manager flow when the scene authors any hop, or whenever
 * the scene is the boot document — a bare boot Game Manager still has to hand
 * its system / planet / spawn down to the scene it launches.
 */
export function resolveSceneEntryFlow(scene: SceneDocument): SceneEntryFlow | null {
  const config = resolveScenePlayConfig(scene);
  const authorsHop = SCENE_FLOW_REF_KEYS.some((key) => config[key] !== null);
  if (!authorsHop && scene.kind !== 'boot') return null;
  return {
    titleSceneId: config.titleSceneId,
    characterCreateSceneId: config.characterCreateSceneId,
    startingSceneId: config.startingSceneId,
    openSpaceSceneId: config.openSpaceSceneId,
    loadingSceneId: config.loadingSceneId,
    // Unset means "yes": every shipped flow so far required a player record,
    // and an author who wants an offline game says so explicitly.
    requireAuth: config.requireAuth ?? true,
    skipTitleWhenSignedIn: config.skipTitleWhenSignedIn,
    systemId: config.systemId,
    planetId: config.planetId,
    spawn: config.spawn,
  };
}

/** Where the flow is being evaluated from. */
export type SceneFlowStage = 'boot' | 'post-auth';

/**
 * What the runtime should do next. `sceneId: null` on a UI step means "mount
 * that surface on the current scene" — the legacy shape where the entry scene
 * is also the title surface.
 */
export type SceneFlowStep =
  | { kind: 'sign-in'; sceneId: string | null }
  | { kind: 'character-create'; sceneId: string | null }
  | { kind: 'play'; sceneId: string }
  | { kind: 'unconfigured'; missing: string };

/**
 * The single answer to "given this flow and this player, what happens next".
 *
 * Pure and stage-driven so the boot scene and the post-auth Title hand-off run
 * the exact same precedence rules; they only differ in whether sign-in has
 * already happened.
 */
export function resolveSceneFlowStep(input: {
  flow: SceneEntryFlow;
  stage: SceneFlowStage;
  signedIn: boolean;
  /** Null when bootstrap was not fetched or the request failed. */
  hasAppearance: boolean | null;
  resumeSceneId?: string | null;
}): SceneFlowStep {
  const { flow, stage, signedIn, hasAppearance } = input;
  // A deep link the player opened before signing in outranks the authored hop:
  // they asked for a specific place and auth was only in the way.
  if (input.resumeSceneId) return { kind: 'play', sceneId: input.resumeSceneId };
  if (flow.requireAuth && !signedIn) return { kind: 'sign-in', sceneId: flow.titleSceneId };
  if (
    stage === 'boot'
    && flow.titleSceneId
    && !flow.skipTitleWhenSignedIn
  ) {
    return { kind: 'sign-in', sceneId: flow.titleSceneId };
  }
  if (hasAppearance === false) {
    return { kind: 'character-create', sceneId: flow.characterCreateSceneId };
  }
  if (flow.startingSceneId) return { kind: 'play', sceneId: flow.startingSceneId };
  return { kind: 'unconfigured', missing: 'startingSceneId' };
}

/**
 * Resolve a `scene-exit`'s authored scene id against the flow.
 *
 * `@space` is a token, not a scene id: the open-space document is a project
 * decision, so an exit names the token and the Game Manager names the scene.
 * Unknown tokens resolve to nothing rather than being passed through — a typo
 * must not reach `loadSceneDocument` as a literal.
 */
export function resolveSceneExitSceneId(
  sceneId: string,
  flow: SceneEntryFlow | null,
): string {
  const authored = sceneId.trim();
  if (!authored.startsWith('@')) return authored;
  if (authored === '@space') {
    const target = flow?.openSpaceSceneId ?? '';
    if (!target) {
      console.warn('Scene exit targets @space but no Open Space Scene is set on the Game Manager.');
    }
    return target;
  }
  console.warn(`Unknown scene-exit scene token "${authored}"; the exit goes nowhere.`);
  return '';
}

/**
 * True when playing this scene must resolve a signed-in player first.
 *
 * Player-scoped instances need the player's authoritative instance id and
 * bootstrap-backed systems such as apartment building even when the scene is
 * launched directly from Editor Play instead of through the boot flow.
 */
export function sceneRequiresAuth(scene: SceneDocument): boolean {
  if (scene.kind === 'boot' || scene.kind === 'title') return true;
  const config = resolveScenePlayConfig(scene);
  return config.instanceScope === 'player'
    || resolveSceneEntryFlow(scene)?.requireAuth === true;
}

/**
 * Next scene after a menu surface. `game-manager.startingSceneId` wins so the
 * flow can pick a starting hab without also authoring a `scene-link`.
 */
export function resolveMenuAdvanceSceneId(scene: SceneDocument): string | null {
  const config = resolveScenePlayConfig(scene);
  if (config.startingSceneId) return config.startingSceneId;
  return config.sceneLinks.find((link) => !link.auto)?.sceneId ?? null;
}
