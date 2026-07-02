import { clamp01, fbm3d, getNoise3D } from './terrain_noise';

// Low-frequency mask that partitions land into macro regions (flat plains,
// rolling hills, mountain ranges) independently of continent elevation, so
// mountains form distinct ranges instead of covering all elevated land.
const REGION_NOISE_SEED_OFFSET = 4242;
const REGION_NOISE_SCALE = 0.9;
const REGION_NOISE_OCTAVES = 4;
// FBM output rarely reaches +/-1, so stretch it to use the full [0, 1] range.
const REGION_CONTRAST = 1.6;

const MOUNTAIN_REGION_START = 0.55;
const MOUNTAIN_REGION_FULL = 0.75;
const HILL_REGION_START = 0.3;
const HILL_REGION_FULL = 0.5;

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
  const regionNoise = getNoise3D(seed + REGION_NOISE_SEED_OFFSET);
  const raw = fbm3d(
    regionNoise,
    nx,
    ny,
    nz,
    REGION_NOISE_OCTAVES,
    0.5,
    2.0,
    REGION_NOISE_SCALE,
  );
  const regionValue = clamp01(0.5 + raw * REGION_CONTRAST * 0.5);

  const mountainRegion = smoothstep(MOUNTAIN_REGION_START, MOUNTAIN_REGION_FULL, regionValue);
  const hillRegion =
    smoothstep(HILL_REGION_START, HILL_REGION_FULL, regionValue) * (1 - mountainRegion);

  return { hillRegion, mountainRegion };
}
