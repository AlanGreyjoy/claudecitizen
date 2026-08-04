/**
 * Dump local Postgres catalog → SQLx migration with ON CONFLICT DO NOTHING.
 *
 *   node scripts/dump_catalog_migration.mjs
 *   node scripts/dump_catalog_migration.mjs --out backend/migrations/0023_catalog_local_baseline.sql
 *
 * Inserts missing definition rows only — never rewrites operator-edited prod rows.
 * Ongoing promote: Deploy → Sync Catalog… (upsert). Stripe Price ids omitted.
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const DEFAULT_OUT = resolve(repoRoot, 'backend/migrations/0023_catalog_local_baseline.sql');
const PG_CONTAINER = 'claude-citizen-postgres-1';

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = resolve(argv[i + 1] ?? '');
  }
  return args;
}

const quote = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;

const quoteJson = (value) =>
  value === null || value === undefined ? 'NULL' : `${quote(JSON.stringify(value))}::jsonb`;

const quoteTextArray = (values) => {
  if (!Array.isArray(values)) return 'ARRAY[]::TEXT[]';
  if (values.length === 0) return 'ARRAY[]::TEXT[]';
  return `ARRAY[${values.map((v) => quote(v)).join(',')}]::TEXT[]`;
};

function psqlJson(sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        PG_CONTAINER,
        'psql',
        '-U',
        'claude',
        '-d',
        'claude_citizen',
        '-v',
        'ON_ERROR_STOP=1',
        '-t',
        '-A',
        '-c',
        sql,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `psql exited ${code}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolvePromise([]);
        return;
      }
      // Multiple rows, one JSON object per line when using json_agg we get one line.
      try {
        resolvePromise(JSON.parse(text));
      } catch (error) {
        reject(new Error(`JSON parse failed: ${error.message}\n${text.slice(0, 200)}`));
      }
    });
  });
}

async function fetchTable(table, orderBy = '"id"') {
  return psqlJson(
    `SELECT COALESCE(json_agg(row_to_json(t) ORDER BY ${orderBy}), '[]'::json) FROM "${table}" t;`,
  );
}

function itemInsert(row) {
  return (
    `INSERT INTO "ItemDefinition" `
    + `("id","name","description","itemType","subType","prefabId","iconUrl","stackMax","costArc","rarity","metadata","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.name),
      quote(row.description ?? ''),
      quote(row.itemType),
      quote(row.subType ?? 'generic'),
      quote(row.prefabId ?? null),
      quote(row.iconUrl ?? null),
      row.stackMax ?? 99,
      row.costArc ?? 0,
      quote(row.rarity ?? 'common'),
      quoteJson(row.metadata ?? null),
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING;`
  );
}

function weaponInsert(row) {
  return (
    `INSERT INTO "WeaponDefinition" `
    + `("itemDefinitionId","weaponSlotType","ammoItemDefinitionId","magazineSize","fireModes",`
    + `"roundsPerMinute","muzzleVelocityMps","bulletGravityMps2","maxRangeMeters","damage","createdAt","updatedAt") VALUES (`
    + [
      quote(row.itemDefinitionId),
      quote(row.weaponSlotType),
      quote(row.ammoItemDefinitionId ?? null),
      row.magazineSize,
      quoteJson(row.fireModes ?? ['single']),
      row.roundsPerMinute,
      row.muzzleVelocityMps,
      row.bulletGravityMps2 ?? 9.81,
      row.maxRangeMeters,
      row.damage ?? 0,
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("itemDefinitionId") DO NOTHING;`
  );
}

function backpackInsert(row) {
  return (
    `INSERT INTO "BackpackDefinition" `
    + `("itemDefinitionId","capacityLiters","emptyMassKg","createdAt","updatedAt") VALUES (`
    + [quote(row.itemDefinitionId), row.capacityLiters, row.emptyMassKg].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("itemDefinitionId") DO NOTHING;`
  );
}

function wearableInsert(row) {
  return (
    `INSERT INTO "WearableDefinition" `
    + `("itemDefinitionId","wearableSlotType","occupiedSlotTypes","sidekickPartPresetId","createdAt","updatedAt") VALUES (`
    + [
      quote(row.itemDefinitionId),
      quote(row.wearableSlotType),
      quoteTextArray(row.occupiedSlotTypes ?? [row.wearableSlotType]),
      row.sidekickPartPresetId,
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("itemDefinitionId") DO NOTHING;`
  );
}

function shipInsert(row) {
  return (
    `INSERT INTO "ShipDefinition" `
    + `("id","name","description","prefabId","iconUrl","costArc","maxHp","maxShields",`
    + `"shieldRegenPerSec","maxSpeedMps","throttleAccelMps2","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.name),
      quote(row.description ?? ''),
      quote(row.prefabId),
      quote(row.iconUrl ?? null),
      row.costArc,
      row.maxHp,
      row.maxShields,
      row.shieldRegenPerSec,
      row.maxSpeedMps,
      row.throttleAccelMps2,
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING;`
  );
}

function propInsert(row) {
  return (
    `INSERT INTO "PropDefinition" `
    + `("id","name","description","prefabId","costArc","category","maxPerHangar",`
    + `"allowRotateY","snapGridM","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.name),
      quote(row.description ?? ''),
      quote(row.prefabId),
      row.costArc,
      quote(row.category ?? 'decoration'),
      row.maxPerHangar ?? 'NULL',
      row.allowRotateY === false ? 'FALSE' : 'TRUE',
      row.snapGridM ?? 'NULL',
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING;`
  );
}

function creditPackInsert(row) {
  // stripePriceId always NULL in seed — env-specific.
  return (
    `INSERT INTO "CreditPack" `
    + `("id","name","description","credits","bonusCredits","priceCents","currency",`
    + `"stripePriceId","iconUrl","sortOrder","active","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.name),
      quote(row.description ?? ''),
      row.credits,
      row.bonusCredits ?? 0,
      row.priceCents,
      quote(row.currency ?? 'usd'),
      'NULL',
      quote(row.iconUrl ?? null),
      row.sortOrder ?? 0,
      row.active === false ? 'FALSE' : 'TRUE',
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING;`
  );
}

function mallInsert(row) {
  return (
    `INSERT INTO "MallListing" `
    + `("id","itemDefinitionId","priceCredits","category","sortOrder","featured",`
    + `"active","limitPerPlayer","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.itemDefinitionId),
      row.priceCredits,
      quote(row.category ?? 'consumable'),
      row.sortOrder ?? 0,
      row.featured ? 'TRUE' : 'FALSE',
      row.active === false ? 'FALSE' : 'TRUE',
      row.limitPerPlayer ?? 'NULL',
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING;`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [ships, props, items, weapons, backpacks, wearables, packs, mall] = await Promise.all([
    fetchTable('ShipDefinition'),
    fetchTable('PropDefinition'),
    fetchTable('ItemDefinition'),
    fetchTable('WeaponDefinition', '"itemDefinitionId"'),
    fetchTable('BackpackDefinition', '"itemDefinitionId"'),
    fetchTable('WearableDefinition', '"itemDefinitionId"'),
    fetchTable('CreditPack'),
    fetchTable('MallListing'),
  ]);

  const lines = [
    '-- Catalog baseline from local Postgres (DO NOTHING).',
    '-- Generated by scripts/dump_catalog_migration.mjs.',
    '-- Inserts missing rows only; Deploy → Sync Catalog upserts ongoing edits.',
    '-- Does not write PaymentProvider or CreditPack.stripePriceId.',
    '',
    'BEGIN;',
    '',
    '-- Items first (weapon/backpack/wearable/mall FKs).',
    ...items.map(itemInsert),
    '',
    '-- Weapon / backpack / wearable extensions.',
    ...weapons.map(weaponInsert),
    ...backpacks.map(backpackInsert),
    ...wearables.map(wearableInsert),
    '',
    '-- Ships + props.',
    ...ships.map(shipInsert),
    ...props.map(propInsert),
    '',
    '-- Commerce metadata (no stripePriceId).',
    ...packs.map(creditPackInsert),
    ...mall.map(mallInsert),
    '',
    'COMMIT;',
    '',
  ];

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, lines.join('\n'), 'utf8');
  console.log(
    `Wrote ${args.out} (${items.length} items, ${weapons.length} weapons, ${ships.length} ships, ${props.length} props).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
