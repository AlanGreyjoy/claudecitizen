import { normalize, vec3 } from '../math/vec3';
import { sampleSurfaceHeight } from './elevation';
import type { Planet, Vec3 } from '../types';

// Fixed probe directions spread across all six cube faces. Sampling the terrain
// at these points fingerprints the generation algorithm itself: any edit to the
// noise stack changes the probed heights, which changes the fingerprint, which
// invalidates stale disk-cached tiles automatically (no manual version bumps).
const PROBE_DIRECTIONS: Vec3[] = [
  vec3(1, 0.31, -0.42),
  vec3(-1, -0.57, 0.13),
  vec3(0.23, 1, 0.68),
  vec3(-0.71, -1, -0.29),
  vec3(0.44, -0.16, 1),
  vec3(-0.35, 0.82, -1),
  vec3(0.61, 0.61, 0.61),
  vec3(-0.19, 0.04, -0.93),
].map(normalize);

const fingerprintCache = new Map<string, string>();

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function terrainFingerprint(planet: Planet, seed: number): string {
  const cacheKey = `${planet.name ?? 'planet'}:${planet.radiusMeters}:${planet.terrainAmplitudeMeters}:${seed}`;
  const cached = fingerprintCache.get(cacheKey);
  if (cached) return cached;

  const probedHeights = PROBE_DIRECTIONS.map((direction) => {
    const position = vec3(
      direction.x * planet.radiusMeters,
      direction.y * planet.radiusMeters,
      direction.z * planet.radiusMeters,
    );
    return sampleSurfaceHeight(planet, seed, position).toFixed(3);
  });

  const fingerprint = fnv1a32(probedHeights.join('|'));
  fingerprintCache.set(cacheKey, fingerprint);
  return fingerprint;
}
