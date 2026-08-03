import type { GameBootstrap } from '../../net/api';
import type {
  StationEnterStationMarker,
  StationSceneExitMarker,
} from '../../world/station';

/**
 * Where a `scene-exit` sends the player: the scene document to load, and the
 * authoritative cell to land in.
 *
 * `scene-exit` is the only mechanism that moves a player between places during
 * Play. Nothing else — not the scene's own kind, not an elevator — may decide
 * this, or the two rules silently disagree and the player ends up rendering one
 * place while being simulated in another.
 */
export interface SceneExitTarget {
  sceneId: string;
  /** Empty when the exit only swaps the scene and stays in the current cell. */
  instanceId: string;
  roomId: string;
  /**
   * Pose the player arrives in. A fly-through exit is a continuous act — the
   * session is rebuilt around them, so they must come out of it still flying
   * rather than standing at the destination's Player Start.
   */
  arrival: 'default' | 'in-ship';
  /**
   * Hangar scene the player left. Open-space fly-throughs use System Map
   * ownership (`hangarSceneId`) to find the family's `hangar-open-space-exit`.
   */
  fromHangarSceneId?: string;
  /**
   * Legacy Station prefab override when ownership cannot resolve. Prefer
   * System Map `hangarSceneId` ownership for scene-backed stations.
   */
  stationPrefabId?: string;
}

/**
 * Resolve an authored `networkInstanceId` against the session.
 *
 * The private instances are keyed per player, so a prefab document cannot name
 * them — it names a token and the runtime fills it in. An unknown token
 * resolves to nothing rather than being passed through as a literal: the server
 * would reject `@apartment` as an instance id and drop the session, and a
 * typo in authored content should not be able to do that.
 */
export function resolveSceneExitInstanceId(
  networkInstanceId: string,
  bootstrap: GameBootstrap | null,
  systemId: string,
): string {
  const authored = networkInstanceId.trim();
  if (!authored) return '';
  if (!authored.startsWith('@')) return authored;
  switch (authored) {
    case '@apartment':
      return bootstrap?.spawn.apartmentInstanceId ?? '';
    case '@hangar':
      return bootstrap?.spawn.hangarInstanceId ?? '';
    case '@space':
      return systemId ? `space:${systemId}` : '';
    default:
      console.warn(`Unknown scene-exit instance token "${authored}"; staying in the current cell.`);
      return '';
  }
}

/**
 * An `exit-hangar` always hands the player out flying, even when the author
 * chose the on-foot `interact` trigger: the destination is the owning station
 * body's bay mouth in Open Space, and there is nowhere to stand there. A plain
 * `scene-exit` only flies you out when it is a fly-through mouth.
 */
function exitArrivalMode(marker: StationSceneExitMarker): 'default' | 'in-ship' {
  if (marker.origin === 'exit-hangar') return 'in-ship';
  return marker.trigger === 'fly-through' ? 'in-ship' : 'default';
}

export function sceneExitTarget(
  marker: StationSceneExitMarker,
  bootstrap: GameBootstrap | null,
  systemId: string,
  options: { fromHangarSceneId?: string | null } = {},
): SceneExitTarget {
  const stationPrefabId = marker.stationPrefabId.trim();
  const fromHangarSceneId = options.fromHangarSceneId?.trim() ?? '';
  const arrival = exitArrivalMode(marker);
  const inShip = arrival === 'in-ship';
  return {
    sceneId: marker.sceneId,
    instanceId: resolveSceneExitInstanceId(marker.networkInstanceId, bootstrap, systemId),
    roomId: marker.arrivalRoomId,
    arrival,
    ...(inShip && fromHangarSceneId ? { fromHangarSceneId } : {}),
    ...(stationPrefabId ? { stationPrefabId } : {}),
  };
}

/**
 * Open Space → hangar. The destination scene is resolved by the caller from
 * System Map ownership (the station body does not know which map entry placed
 * it), so an unresolved family yields no target rather than a broken hop.
 *
 * Arrival is `default`: the ship is parked on its assigned pad by the hangar's
 * own delivery logic and the player walks in, exactly as an AVMS To Hangar hop
 * does today.
 */
export function enterStationTarget(
  marker: StationEnterStationMarker,
  bootstrap: GameBootstrap | null,
  systemId: string,
  hangarSceneId: string,
): SceneExitTarget | null {
  const sceneId = hangarSceneId.trim();
  if (!sceneId) return null;
  return {
    sceneId,
    instanceId: resolveSceneExitInstanceId('@hangar', bootstrap, systemId),
    roomId: marker.arrivalRoomId,
    arrival: 'default',
  };
}

/**
 * Has a ship crossed this marker?
 *
 * Deliberately a sphere test against the ship body rather than a plane
 * crossing: a hangar mouth is authored as one marker with a radius, and a pilot
 * who clips the edge of the opening at speed should still leave.
 */
export function shipCrossedExit(
  marker: { right: number; up: number; forward: number; radius: number },
  shipLocal: { right: number; up: number; forward: number },
): boolean {
  return (
    Math.hypot(
      shipLocal.right - marker.right,
      shipLocal.up - marker.up,
      shipLocal.forward - marker.forward,
    ) <= marker.radius
  );
}
