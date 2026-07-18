import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance, dot, normalize, scale } from '../../../math/vec3';
import { parentTileInfo } from '../../planet_tiles/domain/tile_info';
import {
  getGrassDistanceMeters,
  getVegetationTileDistanceMeters,
  grassSampleMultiplier,
  VEGETATION_ALTITUDE_CUTOFF_METERS,
  VEGETATION_MIN_TILE_LEVEL,
  VEGETATION_TILE_DOT_THRESHOLD,
} from './constants';

export function shouldDecorateTile(
  tileInfo: TileInfo,
  bodyPosition: Vec3,
  altitudeMeters: number,
): boolean {
  if (altitudeMeters > VEGETATION_ALTITUDE_CUTOFF_METERS) return false;
  if (tileInfo.level < VEGETATION_MIN_TILE_LEVEL) return false;
  if (dot(tileInfo.centerDirection, normalize(bodyPosition)) < VEGETATION_TILE_DOT_THRESHOLD)
    return false;
  return distance(tileInfo.centerPosition, bodyPosition) < getVegetationTileDistanceMeters();
}

/**
 * Horizontal-ish distance from the player to a tile center.
 *
 * `tileInfo.centerPosition` is on the sea-level sphere; the player sits on
 * terrain (often hundreds of meters above that). A raw 3D distance would look
 * like "always ~elevation away" and hide all grass. Project the tile center
 * out to the player's radius first.
 */
function distanceToTileCenter(tileInfo: TileInfo, bodyPosition: Vec3): number {
  const bodyRadius = Math.hypot(bodyPosition.x, bodyPosition.y, bodyPosition.z);
  if (bodyRadius < 1e-6) return distance(tileInfo.centerPosition, bodyPosition);
  const tileAtBodyRadius = scale(tileInfo.centerDirection, bodyRadius);
  return distance(tileAtBodyRadius, bodyPosition);
}

/**
 * Enable grass draw calls when a fine LOD tile can intersect the player
 * radius. `spanMeters` is the tile diagonal — use the full diagonal (not half)
 * so a player standing on a far corner still keeps that tile eligible; CPU
 * packing then keeps only the configured grass-distance disk.
 */
export function shouldShowGrassOnTile(
  tileInfo: TileInfo,
  bodyPosition: Vec3,
): boolean {
  if (grassSampleMultiplier(tileInfo.level) <= 0) return false;
  const reachMeters = getGrassDistanceMeters() + tileInfo.spanMeters;
  return distanceToTileCenter(tileInfo, bodyPosition) < reachMeters;
}

function tileSelectionKey(tileInfo: TileInfo): string {
  return `${tileInfo.face}:${tileInfo.level}:${tileInfo.x}:${tileInfo.y}`;
}

interface VegetationSiblingGroup {
  children: TileInfo[];
  parent: TileInfo;
}

function collectVegetationSiblingGroups(
  planet: Planet,
  selected: ReadonlyMap<string, TileInfo>,
  protectedKeys: ReadonlySet<string>,
): VegetationSiblingGroup[] {
  const siblingGroups = new Map<string, VegetationSiblingGroup>();
  for (const [key, tileInfo] of selected) {
    if (protectedKeys.has(key) || tileInfo.level <= VEGETATION_MIN_TILE_LEVEL) continue;
    const parent = parentTileInfo(tileInfo, planet);
    if (!parent || parent.level < VEGETATION_MIN_TILE_LEVEL) continue;
    const parentKey = tileSelectionKey(parent);
    const group = siblingGroups.get(parentKey);
    if (group) group.children.push(tileInfo);
    else siblingGroups.set(parentKey, { children: [tileInfo], parent });
  }
  return [...siblingGroups.values()];
}

function isCompleteSiblingGroup(group: VegetationSiblingGroup): boolean {
  if (group.children.length !== 4) return false;
  const quadrants = new Set(
    group.children.map((child) => `${child.x & 1}:${child.y & 1}`),
  );
  return quadrants.size === 4;
}

function collapseVegetationSiblingLevel(
  planet: Planet,
  selected: Map<string, TileInfo>,
  protectedKeys: ReadonlySet<string>,
  bodyPosition: Vec3,
  targetTileCount: number,
): boolean {
  const collapsible = collectVegetationSiblingGroups(
    planet,
    selected,
    protectedKeys,
  )
    .filter(isCompleteSiblingGroup)
    // Coarsen the farthest complete regions first; nearby tree placement and
    // every grass-bearing tile retain their finest selected level.
    .sort(
      (a, b) =>
        distance(b.parent.centerPosition, bodyPosition) -
        distance(a.parent.centerPosition, bodyPosition),
    );

  let collapsedAny = false;
  for (const group of collapsible) {
    if (selected.size <= targetTileCount) break;
    const childKeys = group.children.map(tileSelectionKey);
    if (!childKeys.every((key) => selected.has(key))) continue;
    for (const childKey of childKeys) selected.delete(childKey);
    selected.set(tileSelectionKey(group.parent), group.parent);
    collapsedAny = true;
  }
  return collapsedAny;
}

/**
 * Preserve vegetation coverage without allowing fine terrain LODs to consume
 * every cache slot. Complete distant sibling quartets can share one parent
 * vegetation tile because placement resolves against the canonical fine
 * surface. Near grass tiles stay at their selected terrain level.
 */
export function selectVegetationTiles(
  planet: Planet,
  selectedTiles: readonly TileInfo[],
  bodyPosition: Vec3,
  altitudeMeters: number,
  targetTileCount: number,
): TileInfo[] {
  const selected = new Map<string, TileInfo>();
  const protectedKeys = new Set<string>();

  for (const tileInfo of selectedTiles) {
    if (!shouldDecorateTile(tileInfo, bodyPosition, altitudeMeters)) continue;
    const key = tileSelectionKey(tileInfo);
    selected.set(key, tileInfo);
    if (shouldShowGrassOnTile(tileInfo, bodyPosition)) protectedKeys.add(key);
  }

  while (selected.size > targetTileCount) {
    if (
      !collapseVegetationSiblingLevel(
        planet,
        selected,
        protectedKeys,
        bodyPosition,
        targetTileCount,
      )
    ) break;
  }

  // The cache limit is a soft target, never a reason to punch vegetation holes.
  // If an irregular quadtree cannot collapse cleanly, keep the remaining tiles.
  return [...selected.values()].sort(
    (a, b) =>
      distance(a.centerPosition, bodyPosition) -
      distance(b.centerPosition, bodyPosition),
  );
}

export function isVegetationVisibleAtAltitude(altitudeMeters: number): boolean {
  return altitudeMeters <= VEGETATION_ALTITUDE_CUTOFF_METERS;
}
