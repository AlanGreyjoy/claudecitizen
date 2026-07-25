import { getActivePlanetConfig } from './planets/runtime';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';

// Low-frequency mask that partitions land into macro regions (flat plains,
// rolling hills, mountain ranges) independently of continent elevation, so
// mountains form distinct ranges instead of covering all elevated land.

export interface TerrainRegions {
  /** 0 = no mountains here, 1 = full mountain range. */
  mountainRegion: number;
  /** 0 = flat plains, 1 = full rolling hills (excludes mountain regions). */
  hillRegion: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function sampleTerrainRegions(
  seed: number,
  nx: number,
  ny: number,
  nz: number,
): TerrainRegions {
  const { regions } = getActivePlanetConfig();
  const regionNoise = getNoise3D(seed + regions.noiseSeedOffset);
  const raw = fbm3d(
    regionNoise,
    nx,
    ny,
    nz,
    regions.noiseOctaves,
    0.5,
    2.0,
    regions.noiseScale,
  );
  const regionValue = clamp01(0.5 + raw * regions.contrast * 0.5);

  const mountainRegion = smoothstep(
    regions.mountainRegionStart,
    regions.mountainRegionFull,
    regionValue,
  );
  const hillRegion =
    smoothstep(regions.hillRegionStart, regions.hillRegionFull, regionValue) *
    (1 - mountainRegion);

  return { hillRegion, mountainRegion };
}
