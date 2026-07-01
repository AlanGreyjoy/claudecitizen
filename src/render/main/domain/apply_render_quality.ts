import { configureTileLod } from '../../planet_tiles/domain/constants';
import { configureVegetationDensity } from '../../vegetation/domain/constants';
import { resolveRenderQuality } from './render_quality';

export function applyRenderQualitySettings(): void {
  const quality = resolveRenderQuality();
  configureTileLod(quality.minProjectedError);
  configureVegetationDensity({
    grassSampleCount: quality.grassSampleCount,
    treeSampleCount: quality.treeSampleCount,
    vegetationTileDistanceMeters: quality.vegetationTileDistanceMeters,
  });
}
