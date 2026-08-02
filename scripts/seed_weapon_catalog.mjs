/**
 * Seed ItemDefinition / WeaponDefinition rows for the generated weapon set.
 *
 *   node scripts/seed_weapon_catalog.mjs --out build/weapon-catalog.sql
 *   node scripts/seed_weapon_catalog.mjs --apply          # pipe into dev psql
 *
 * Emits SQL rather than talking to /admin/weapons because those routes need an
 * operator session. The generated statements mirror admin.rs create_item_tx /
 * create_weapon column-for-column, and every value is re-checked here against
 * the same rules the handler enforces, so a row that would be rejected by the
 * API never reaches the table.
 *
 * Idempotent: upserts by primary key, so re-running after editing
 * weapon_catalog_data.mjs updates in place instead of duplicating. Weapons in
 * EXISTING_WEAPON_IDS are skipped entirely — those are hand-authored.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMMO, EXISTING_WEAPON_IDS, WEAPONS } from './weapon_catalog_data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const DEFAULT_ICONS = join(repoRoot, 'build', 'weapon-icons');
const DEFAULT_SQL = join(repoRoot, 'build', 'weapon-catalog.sql');
const PG_CONTAINER = 'claude-citizen-postgres-1';
const VALID_FIRE_MODES = new Set(['single', 'burst3', 'auto', 'bolt']);

function parseArgs(argv) {
  const args = { icons: DEFAULT_ICONS, out: DEFAULT_SQL, apply: false, noIcons: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--icons') args.icons = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--out') args.out = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--no-icons') args.noIcons = true;
  }
  return args;
}

const quote = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;

function assertValid(weapon) {
  const problems = [];
  if (!weapon.name?.trim()) problems.push('name is empty');
  if (!weapon.description?.trim()) problems.push('description is empty');
  if (!['rifle', 'handgun', 'sword'].includes(weapon.slot)) {
    problems.push(`weaponSlotType "${weapon.slot}" is not rifle|handgun|sword`);
  }
  if (!Number.isInteger(weapon.magazineSize) || weapon.magazineSize < 1) {
    problems.push('magazineSize must be an integer >= 1');
  }
  if (!Array.isArray(weapon.fireModes) || weapon.fireModes.length === 0) {
    problems.push('fireModes must be a non-empty array');
  } else {
    for (const mode of weapon.fireModes) {
      if (!VALID_FIRE_MODES.has(mode)) problems.push(`fireModes contains "${mode}"`);
    }
    if (new Set(weapon.fireModes).size !== weapon.fireModes.length) {
      problems.push('fireModes contains duplicates');
    }
  }
  for (const field of ['roundsPerMinute', 'muzzleVelocityMps', 'maxRangeMeters']) {
    if (!(weapon[field] > 0)) problems.push(`${field} must be > 0`);
  }
  for (const field of ['bulletGravityMps2', 'damage']) {
    if (!(weapon[field] >= 0)) problems.push(`${field} must be >= 0`);
  }
  if (!Number.isInteger(weapon.costArc) || weapon.costArc < 0) {
    problems.push('costArc must be a non-negative integer');
  }
  return problems;
}

function itemUpsert(row) {
  return `INSERT INTO "ItemDefinition" `
    + `("id","name","description","itemType","subType","prefabId","iconUrl","stackMax","costArc","rarity","createdAt","updatedAt") VALUES (`
    + [
      quote(row.id),
      quote(row.name),
      quote(row.description),
      quote(row.itemType),
      quote(row.subType),
      quote(row.prefabId ?? null),
      quote(row.iconUrl ?? null),
      row.stackMax,
      row.costArc,
      quote(row.rarity),
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("id") DO UPDATE SET `
    + `"name"=EXCLUDED."name","description"=EXCLUDED."description","itemType"=EXCLUDED."itemType",`
    + `"subType"=EXCLUDED."subType","prefabId"=EXCLUDED."prefabId","iconUrl"=EXCLUDED."iconUrl",`
    + `"stackMax"=EXCLUDED."stackMax","costArc"=EXCLUDED."costArc","rarity"=EXCLUDED."rarity",`
    + `"updatedAt"=NOW();`;
}

function weaponUpsert(weapon) {
  return `INSERT INTO "WeaponDefinition" `
    + `("itemDefinitionId","weaponSlotType","ammoItemDefinitionId","magazineSize","fireModes",`
    + `"roundsPerMinute","muzzleVelocityMps","bulletGravityMps2","maxRangeMeters","damage","createdAt","updatedAt") VALUES (`
    + [
      quote(weapon.id),
      quote(weapon.slot),
      quote(weapon.ammo ?? null),
      weapon.magazineSize,
      `${quote(JSON.stringify(weapon.fireModes))}::jsonb`,
      weapon.roundsPerMinute,
      weapon.muzzleVelocityMps,
      weapon.bulletGravityMps2,
      weapon.maxRangeMeters,
      weapon.damage,
    ].join(',')
    + `,NOW(),NOW()) ON CONFLICT ("itemDefinitionId") DO UPDATE SET `
    + `"weaponSlotType"=EXCLUDED."weaponSlotType","ammoItemDefinitionId"=EXCLUDED."ammoItemDefinitionId",`
    + `"magazineSize"=EXCLUDED."magazineSize","fireModes"=EXCLUDED."fireModes",`
    + `"roundsPerMinute"=EXCLUDED."roundsPerMinute","muzzleVelocityMps"=EXCLUDED."muzzleVelocityMps",`
    + `"bulletGravityMps2"=EXCLUDED."bulletGravityMps2","maxRangeMeters"=EXCLUDED."maxRangeMeters",`
    + `"damage"=EXCLUDED."damage","updatedAt"=NOW();`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statements = ['BEGIN;'];
  let iconCount = 0;

  for (const ammo of AMMO) {
    statements.push(itemUpsert({ ...ammo, itemType: 'ammo', rarity: 'common', prefabId: null }));
  }

  const skipped = [];
  const failures = [];
  for (const weapon of WEAPONS) {
    const iconPathFor = join(args.icons, `${weapon.id}.png`);
    if (EXISTING_WEAPON_IDS.has(weapon.id)) {
      // Hand-authored stats stay authoritative; only fill in a missing icon so
      // the catalog renders consistently.
      skipped.push(weapon.id);
      if (!args.noIcons && existsSync(iconPathFor)) {
        const dataUrl = `data:image/png;base64,${(await readFile(iconPathFor)).toString('base64')}`;
        statements.push(
          `UPDATE "ItemDefinition" SET "iconUrl"=${quote(dataUrl)},"updatedAt"=NOW() `
          + `WHERE "id"=${quote(weapon.id)} AND "iconUrl" IS NULL;`,
        );
        iconCount += 1;
      }
      continue;
    }
    const problems = assertValid(weapon);
    if (problems.length > 0) {
      failures.push(`${weapon.id}: ${problems.join('; ')}`);
      continue;
    }
    let iconUrl = null;
    const iconPath = join(args.icons, `${weapon.id}.png`);
    if (!args.noIcons && existsSync(iconPath)) {
      iconUrl = `data:image/png;base64,${(await readFile(iconPath)).toString('base64')}`;
      iconCount += 1;
    } else if (!args.noIcons) {
      console.warn(`no icon for ${weapon.id} (run bake_weapon_icons.mjs)`);
    }
    statements.push(
      itemUpsert({
        id: weapon.id,
        name: weapon.name,
        description: weapon.description,
        itemType: 'weapon',
        subType: weapon.subType,
        prefabId: weapon.id,
        iconUrl,
        // create_weapon forces stackMax 1 for weapons; match it.
        stackMax: 1,
        costArc: weapon.costArc,
        rarity: weapon.rarity,
      }),
      weaponUpsert(weapon),
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`INVALID ${failure}`);
    throw new Error(`${failures.length} weapon(s) would be rejected by the API; nothing written.`);
  }

  statements.push('COMMIT;');
  const sql = `${statements.join('\n')}\n`;
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, sql, 'utf8');

  const weaponCount = WEAPONS.length - skipped.length;
  console.log(
    `${weaponCount} weapons + ${AMMO.length} ammo -> ${args.out} `
    + `(${iconCount} icons embedded, ${Math.round(sql.length / 1024)}KB)`,
  );
  if (skipped.length > 0) console.log(`skipped hand-authored: ${skipped.join(', ')}`);

  if (!args.apply) {
    console.log('\nreview, then re-run with --apply');
    return;
  }

  const child = spawn(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'claude', '-d', 'claude_citizen', '-v', 'ON_ERROR_STOP=1', '-q'],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  child.stdin.end(sql);
  const code = await new Promise((res) => child.on('close', res));
  if (code !== 0) throw new Error(`psql exited ${code}; transaction rolled back`);
  console.log('applied');
}

await main();
