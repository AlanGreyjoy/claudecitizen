import type { Planet, TileInfo, Vec3, VegetationCacheStats } from '../../../types';
import { distance } from '../../../math/vec3';
import {
  getGrassDistanceMeters,
  MAX_CACHED_VEGETATION_TILES,
  VEGETATION_SELECTION_BUDGET,
} from '../domain/constants';
import { tileKey } from '../../planet_tiles/domain/tile-key';
import {
  isVegetationVisibleAtAltitude,
  selectVegetationTiles,
  shouldShowGrassOnTile,
} from '../domain/visibility';
import { hasSelectedTileAncestor } from '../../planet_tiles/domain/tile-coverage';
import { updateVegetationWind } from './wind';
import type { VegetationRenderGroup } from './vegetation-group';
import type { VegetationTileEntry } from '../cache/tile-runtime';

interface ResolvedVegetationTile {
  key: string;
  renderGroup: VegetationRenderGroup;
  tileInfo: TileInfo;
}

export interface VegetationFrameCtx {
  activeKeys: Set<string>;
  buildFocusPosition: Vec3 | null;
  builtThisFrame: number;
  evictedThisFrame: number;
  frameNumber: number;
  grassLayerVisible: boolean;
  landingGrove: VegetationRenderGroup;
  lastGrassFocus: Vec3 | null;
  lastTreeLodFocus: Vec3 | null;
  planet: Planet;
  renderScale: number;
  tileCache: Map<string, VegetationTileEntry>;
  treeLodNearCheckRadius: number;
  treeLodUpdateMinMoveSq: number;
  grassRadiusUpdateMinMoveSq: number;
  treesLayerVisible: boolean;
  vegetationGroup: import('three').Group;
  drainBuildQueue: (bodyPosition: Vec3) => void;
  evictVegetation: (keepKeys: Set<string>) => void;
  resolveBestAvailableVegetation: (tileInfo: TileInfo) => {
    key: string;
    renderGroup: VegetationRenderGroup;
    tileInfo: TileInfo;
  };
  startAssetCatalogLoad: () => void;
  assetsLoading: boolean;
  assetsReady: boolean;
  cacheStats: {
    diskHits: number;
    diskMisses: number;
    peakCachedTiles: number;
    totalBuilds: number;
    totalEvictions: number;
  };
  countReadyEntries: () => number;
}

export function createVegetationFrameUpdate(ctx: VegetationFrameCtx) {
  function shouldUpdateRenderGroupLod(
    renderGroup: VegetationRenderGroup,
    bodyPosition: Vec3,
  ): boolean {
    return renderGroup.hasTreeNearFocus(bodyPosition, ctx.treeLodNearCheckRadius);
  }

  function hasTreeLodFocusMoved(bodyPosition: Vec3): boolean {
    if (!ctx.lastTreeLodFocus) return true;

    const dx = bodyPosition.x - ctx.lastTreeLodFocus.x;
    const dy = bodyPosition.y - ctx.lastTreeLodFocus.y;
    const dz = bodyPosition.z - ctx.lastTreeLodFocus.z;
    return dx * dx + dy * dy + dz * dz >= ctx.treeLodUpdateMinMoveSq;
  }

  function hasGrassFocusMoved(bodyPosition: Vec3): boolean {
    if (!ctx.lastGrassFocus) return true;
    const dx = bodyPosition.x - ctx.lastGrassFocus.x;
    const dy = bodyPosition.y - ctx.lastGrassFocus.y;
    const dz = bodyPosition.z - ctx.lastGrassFocus.z;
    return dx * dx + dy * dy + dz * dz >= ctx.grassRadiusUpdateMinMoveSq;
  }

  function updateGrassRadiusForVisible(
    bodyPosition: Vec3,
    selectedKeys: Set<string>,
    newlyVisibleKeys: Set<string>,
  ): void {
    const focusMoved = hasGrassFocusMoved(bodyPosition);
    if (!focusMoved && newlyVisibleKeys.size === 0) return;

    if (focusMoved) {
      ctx.lastGrassFocus = {
        x: bodyPosition.x,
        y: bodyPosition.y,
        z: bodyPosition.z,
      };
    }

    if (focusMoved || newlyVisibleKeys.has('landing-grove')) {
      if (
        distance(ctx.landingGrove.anchor, bodyPosition) < getGrassDistanceMeters() + 80
      ) {
        ctx.landingGrove.updateGrassRadius(bodyPosition);
      }
    }

    for (const key of selectedKeys) {
      if (!focusMoved && !newlyVisibleKeys.has(key)) continue;
      const entry = ctx.tileCache.get(key);
      if (entry?.status !== 'ready' || !entry.tileInfo) continue;
      if (!shouldShowGrassOnTile(entry.tileInfo, bodyPosition)) continue;
      entry.renderGroup.updateGrassRadius(bodyPosition);
    }
  }

  function updateTreeLodForVisible(
    bodyPosition: Vec3,
    selectedKeys: Set<string>,
    newlyVisibleKeys: Set<string>,
  ): void {
    const focusMoved = hasTreeLodFocusMoved(bodyPosition);
    if (!focusMoved && newlyVisibleKeys.size === 0) return;

    if (focusMoved) {
      ctx.lastTreeLodFocus = {
        x: bodyPosition.x,
        y: bodyPosition.y,
        z: bodyPosition.z,
      };
    }

    const updateLandingGrove =
      focusMoved || newlyVisibleKeys.has('landing-grove');
    if (
      updateLandingGrove &&
      shouldUpdateRenderGroupLod(ctx.landingGrove, bodyPosition)
    ) {
      ctx.landingGrove.updateTreeLod(bodyPosition);
    }

    for (const key of selectedKeys) {
      if (!focusMoved && !newlyVisibleKeys.has(key)) continue;

      const entry = ctx.tileCache.get(key);
      if (entry?.status !== 'ready') continue;
      if (!shouldUpdateRenderGroupLod(entry.renderGroup, bodyPosition)) continue;
      entry.renderGroup.updateTreeLod(bodyPosition);
    }
  }

  function selectVisibleVegetationTiles(
    bodyPosition: Vec3,
    altitudeMeters: number,
    selectedTiles: TileInfo[],
    selectedKeys: Set<string>,
    keepKeys: Set<string>,
  ): void {
    const decoratedTiles = selectVegetationTiles(
      ctx.planet,
      selectedTiles,
      bodyPosition,
      altitudeMeters,
      VEGETATION_SELECTION_BUDGET,
    );
    const resolvedCandidates = new Map<string, ResolvedVegetationTile>();
    for (const tileInfo of decoratedTiles) {
      const targetKey = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
      keepKeys.add(targetKey);
      const resolved = ctx.resolveBestAvailableVegetation(tileInfo);
      resolvedCandidates.set(resolved.key, resolved);
      keepKeys.add(resolved.key);
    }

    const orderedCandidates = [...resolvedCandidates.values()].sort(
      (a, b) => a.tileInfo.level - b.tileInfo.level,
    );
    for (const { key, renderGroup, tileInfo } of orderedCandidates) {
      if (hasSelectedTileAncestor(tileInfo, selectedKeys)) continue;
      renderGroup.group.visible = true;
      renderGroup.setTreesVisible(ctx.treesLayerVisible);
      const showGrass =
        ctx.grassLayerVisible &&
        (shouldShowGrassOnTile(tileInfo, bodyPosition) ||
          distance(renderGroup.anchor, bodyPosition) <
            getGrassDistanceMeters() + tileInfo.spanMeters);
      renderGroup.setGrassVisible(showGrass);
      selectedKeys.add(key);
    }
  }

  function hideInactiveVegetationTiles(selectedKeys: Set<string>): void {
    for (const key of ctx.activeKeys) {
      if (selectedKeys.has(key)) continue;
      const entry = ctx.tileCache.get(key);
      if (entry) entry.group.visible = false;
    }
  }

  function collectNewlyVisibleKeys(selectedKeys: Set<string>, vegetationVisible: boolean): Set<string> {
    const newlyVisibleKeys = new Set<string>();
    for (const key of selectedKeys) {
      if (!ctx.activeKeys.has(key)) newlyVisibleKeys.add(key);
    }
    if (vegetationVisible && !ctx.activeKeys.has('landing-grove')) {
      newlyVisibleKeys.add('landing-grove');
    }
    return newlyVisibleKeys;
  }

  function refreshLandingGroveLayers(
    bodyPosition: Vec3,
    selectedKeys: Set<string>,
    newlyVisibleKeys: Set<string>,
  ): void {
    ctx.landingGrove.setTreesVisible(ctx.treesLayerVisible);
    const showGroveGrass =
      ctx.grassLayerVisible &&
      distance(ctx.landingGrove.anchor, bodyPosition) < getGrassDistanceMeters() + 80;
    ctx.landingGrove.setGrassVisible(showGroveGrass);
    if (ctx.grassLayerVisible) {
      updateGrassRadiusForVisible(bodyPosition, selectedKeys, newlyVisibleKeys);
    }
    if (ctx.treesLayerVisible) {
      updateTreeLodForVisible(bodyPosition, selectedKeys, newlyVisibleKeys);
    }
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
    timeSeconds: number,
  ): VegetationCacheStats {
    ctx.frameNumber += 1;
    updateVegetationWind(timeSeconds);
    ctx.builtThisFrame = 0;
    ctx.evictedThisFrame = 0;
    ctx.buildFocusPosition = bodyPosition;
    const selectedKeys = new Set<string>();
    const keepKeys = new Set<string>();
    const vegetationInRange = isVegetationVisibleAtAltitude(altitudeMeters);
    if (vegetationInRange && !ctx.assetsReady && !ctx.assetsLoading) {
      ctx.startAssetCatalogLoad();
    }
    const vegetationVisible = vegetationInRange && ctx.assetsReady;

    if (vegetationVisible) {
      selectVisibleVegetationTiles(
        bodyPosition,
        altitudeMeters,
        selectedTiles,
        selectedKeys,
        keepKeys,
      );
    }

    ctx.drainBuildQueue(bodyPosition);
    hideInactiveVegetationTiles(selectedKeys);
    const newlyVisibleKeys = collectNewlyVisibleKeys(selectedKeys, vegetationVisible);

    ctx.activeKeys.clear();
    for (const key of selectedKeys) ctx.activeKeys.add(key);
    if (vegetationVisible) ctx.activeKeys.add('landing-grove');
    ctx.evictVegetation(keepKeys);

    ctx.vegetationGroup.position.set(
      -bodyPosition.x * ctx.renderScale,
      -bodyPosition.y * ctx.renderScale,
      -bodyPosition.z * ctx.renderScale,
    );

    if (vegetationVisible) {
      refreshLandingGroveLayers(bodyPosition, selectedKeys, newlyVisibleKeys);
    }

    return {
      activeTiles: selectedKeys.size,
      builtThisFrame: ctx.builtThisFrame,
      cacheLimit: MAX_CACHED_VEGETATION_TILES,
      cachedTiles: ctx.countReadyEntries(),
      diskHits: ctx.cacheStats.diskHits,
      diskMisses: ctx.cacheStats.diskMisses,
      evictedThisFrame: ctx.evictedThisFrame,
      peakCachedTiles: ctx.cacheStats.peakCachedTiles,
      totalBuilds: ctx.cacheStats.totalBuilds,
      totalEvictions: ctx.cacheStats.totalEvictions,
    };
  }

  return { update };
}
