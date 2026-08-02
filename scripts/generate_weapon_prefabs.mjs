/**
 * Generate item prefabs for every weapon in weapon_catalog_data.mjs.
 *
 *   node scripts/generate_weapon_prefabs.mjs [--project <dir>] [--dry-run]
 *
 * Mirrors the hand-authored asteron-rifle layout: `item-frame` on the root, the
 * GLB as a child, `drawn-grip` + `weapon-combat` under the mesh, and — for
 * ranged weapons only — `muzzle-flash` / `barrel-end` empties placed on the
 * bore by weapon_glb_probe.mjs rather than by eye.
 *
 * Entity ids are hashed from (weapon id, role) so re-running is idempotent:
 * the same weapon always produces the same ids and the files stay diffable.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXISTING_WEAPON_IDS, WEAPONS } from './weapon_catalog_data.mjs';
import { findMuzzle } from './weapon_glb_probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT = '/home/alan/Documents/AsteronEngine/Asteron';
const OUTPUT_SUBDIR = 'assets/Prefabs/Weapons';

function parseArgs(argv) {
  const args = { project: DEFAULT_PROJECT, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') args.project = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

/** Stable per-(weapon, role) entity id, so regeneration is a no-op diff. */
function entityId(weaponId, role) {
  const digest = createHash('sha1').update(`${weaponId}:${role}`).digest('hex');
  return `e-${digest.slice(0, 8)}`;
}

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

const transformAt = (position) => ({
  ...structuredClone(IDENTITY),
  position: {
    x: round(position.x),
    y: round(position.y),
    z: round(position.z),
  },
});

const round = (value) => Math.round(value * 1e5) / 1e5;

function markerEntity(weapon, role, label, componentType, position) {
  return {
    id: entityId(weapon.id, role),
    name: label,
    transform: position ? transformAt(position) : structuredClone(IDENTITY),
    components: [{ type: componentType }],
  };
}

function buildPrefab(weapon, muzzle) {
  const meshChildren = [
    markerEntity(weapon, 'drawn-grip', 'Drawn Grip', 'drawn-grip', null),
    {
      id: entityId(weapon.id, 'weapon-combat'),
      name: 'Weapon Combat',
      transform: structuredClone(IDENTITY),
      components: [
        {
          type: 'weapon-combat',
          fireSoundUrl: null,
          dryFireSoundUrl: null,
          reloadSoundUrl: null,
          hitDecalUrl: null,
        },
      ],
    },
  ];

  const rootChildren = [
    {
      id: entityId(weapon.id, 'mesh'),
      name: weapon.meshName,
      transform: structuredClone(IDENTITY),
      asset: { url: weapon.assetUrl },
      children: meshChildren,
    },
  ];

  // Melee has no bore, so it gets no shot origin and no flash origin.
  if (!weapon.melee && muzzle) {
    rootChildren.push(
      markerEntity(weapon, 'muzzle-flash', 'Muzzle Flash', 'muzzle-flash', muzzle),
      markerEntity(weapon, 'barrel-end', 'Barrel End', 'barrel-end', muzzle),
    );
  }

  return {
    id: weapon.id,
    name: weapon.name,
    version: 1,
    kind: 'item',
    root: {
      id: 'root',
      name: weapon.name,
      transform: structuredClone(IDENTITY),
      components: [{ type: 'item-frame' }],
      children: rootChildren,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetsRoot = join(args.project, 'assets');
  const outputDir = join(args.project, OUTPUT_SUBDIR);
  if (!existsSync(assetsRoot)) {
    throw new Error(`No assets/ under project root: ${args.project}`);
  }
  if (!args.dryRun) await mkdir(outputDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  for (const weapon of WEAPONS) {
    // Hand-authored prefabs stay hand-authored; the generator never owns them.
    if (EXISTING_WEAPON_IDS.has(weapon.id)) {
      skipped += 1;
      continue;
    }
    const glbAbsolute = join(assetsRoot, weapon.glbPath);
    if (!existsSync(glbAbsolute)) {
      console.error(`SKIP ${weapon.id}: missing ${weapon.glbPath}`);
      continue;
    }
    const muzzle = weapon.melee ? null : findMuzzle(glbAbsolute).position;
    const prefab = buildPrefab(weapon, muzzle);
    const target = join(outputDir, `${weapon.id}.prefab.json`);
    if (!args.dryRun) await writeFile(target, `${JSON.stringify(prefab, null, 2)}\n`, 'utf8');
    const where = muzzle
      ? `muzzle y=${muzzle.y.toFixed(4)} z=${muzzle.z.toFixed(4)}`
      : 'melee';
    console.log(`${args.dryRun ? 'would write' : 'wrote'} ${weapon.id.padEnd(22)} ${where}`);
    written += 1;
  }
  console.log(
    `\n${written}/${WEAPONS.length - skipped} prefabs -> ${outputDir}`
    + (skipped > 0 ? ` (${skipped} hand-authored left alone)` : ''),
  );
}

await main();
