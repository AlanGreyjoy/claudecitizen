import type { GameBootstrap } from '../../net/api';
import type { StationSceneExitMarker } from '../../world/station';

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
   * Station prefab whose `hangar-open-space-exit` is the open-space arrival
   * mouth. Empty when the exit is not an open-space fly-through.
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

export function sceneExitTarget(
  marker: StationSceneExitMarker,
  bootstrap: GameBootstrap | null,
  systemId: string,
): SceneExitTarget {
  const stationPrefabId = marker.stationPrefabId.trim();
  return {
    sceneId: marker.sceneId,
    instanceId: resolveSceneExitInstanceId(marker.networkInstanceId, bootstrap, systemId),
    roomId: marker.arrivalRoomId,
    arrival: marker.trigger === 'fly-through' ? 'in-ship' : 'default',
    ...(stationPrefabId ? { stationPrefabId } : {}),
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
  marker: StationSceneExitMarker,
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
