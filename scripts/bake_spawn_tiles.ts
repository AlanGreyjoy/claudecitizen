/**
 * Bake a spawn-corridor terrain pack into public/cache/spawn/
 * for IndexedDB hydration on cold boot.
 *
 * Usage: npm run bake:spawn-tiles
 *        npm run bake:spawn-tiles -- asteron 500
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TERRAIN_CACHE_VERSION,
  VEGETATION_CACHE_VERSION,
  terrainStorageKey,
} from '../src/cache/cache_keys';
import type { SpawnPackManifest, SpawnPackTerrainRecord } from '../src/cache/spawn_pack';
import { buildTerrainTileBuffers } from '../src/render/planet_tiles/build/terrain_buffers';
import { collectTilesNearPosition } from '../src/render/planet_tiles/domain/spawn_tiles';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import { resolveLandingSite } from '../src/world/landing_sites';
import { activatePlanetDocument } from '../src/world/planets/runtime';
import { parsePlanetDocument } from '../src/world/planets/schema';
import { warmRiverNetwork } from '../src/world/rivers';

const PLANET_ID = process.argv[2] ?? 'asteron';
const RADIUS_METERS = Number(process.argv[3] ?? 500);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'cache', 'spawn');

async function main(): Promise<void> {
  const planetPath = path.join(
    ROOT,
    'src',
    'world',
    'planets',
    'data',
    `${PLANET_ID}.planet.json`,
  );
  const document = parsePlanetDocument(JSON.parse(await readFile(planetPath, 'utf8')));
  if (!document) {
    throw new Error(`Planet document not found or invalid: ${planetPath}`);
  }
  const config = activatePlanetDocument(document);
  const { planet, seed } = config;
  warmRiverNetwork(planet, seed);

  const site = resolveLandingSite(planet, seed);
  const focus = cartesianFromLatLonAlt(
    site.latRadians,
    site.lonRadians,
    0,
    planet.radiusMeters,
  );

  const terrainTiles = collectTilesNearPosition(planet, focus, {
    minLevel: 12,
    maxLevel: 17,
    radiusMeters: RADIUS_METERS,
  });

  console.log(
    `Baking ${PLANET_ID} spawn pack @ lat=${site.latRadians.toFixed(4)} lon=${site.lonRadians.toFixed(4)}`,
  );
  console.log(`Terrain tiles: ${terrainTiles.length}`);

  const chunks: Buffer[] = [];
  let offset = 0;
  const terrainRecords: SpawnPackTerrainRecord[] = [];

  let index = 0;
  for (const info of terrainTiles) {
    index += 1;
    if (index % 20 === 0 || index === terrainTiles.length) {
      console.log(`  terrain ${index}/${terrainTiles.length}`);
    }
    const buffers = buildTerrainTileBuffers(info, planet, seed);
    const positions = Buffer.from(
      buffers.positions.buffer,
      buffers.positions.byteOffset,
      buffers.positions.byteLength,
    );
    const colors = Buffer.from(
      buffers.colors.buffer,
      buffers.colors.byteOffset,
      buffers.colors.byteLength,
    );
    const normals = Buffer.from(
      buffers.normals.buffer,
      buffers.normals.byteOffset,
      buffers.normals.byteLength,
    );

    const positionsOffset = offset;
    chunks.push(positions);
    offset += positions.byteLength;
    const colorsOffset = offset;
    chunks.push(colors);
    offset += colors.byteLength;
    const normalsOffset = offset;
    chunks.push(normals);
    offset += normals.byteLength;

    terrainRecords.push({
      key: terrainStorageKey(planet, seed, info.face, info.level, info.x, info.y),
      positionsOffset,
      positionsByteLength: positions.byteLength,
      colorsOffset,
      colorsByteLength: colors.byteLength,
      normalsOffset,
      normalsByteLength: normals.byteLength,
    });
  }

  const baseName = `${document.id}-${TERRAIN_CACHE_VERSION}`;
  const binName = `${baseName}.bin`;
  const manifest: SpawnPackManifest = {
    format: 2,
    planetId: document.id,
    seed,
    terrainCacheVersion: TERRAIN_CACHE_VERSION,
    vegetationCacheVersion: VEGETATION_CACHE_VERSION,
    bin: binName,
    terrain: terrainRecords,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const binPath = path.join(OUT_DIR, binName);
  const manifestPath = path.join(OUT_DIR, `${baseName}.json`);
  const binBuffer = Buffer.concat(chunks);
  await writeFile(binPath, binBuffer);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Wrote ${manifestPath} + ${binName} (${(binBuffer.byteLength / (1024 * 1024)).toFixed(2)} MiB, ${terrainRecords.length} tiles)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
