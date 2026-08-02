/**
 * Compose the baked weapon icons into labelled contact sheets for review.
 *
 *   node scripts/weapon_icon_sheet.mjs [--in <dir>] [--out <dir>] [--columns 6]
 *
 * Named weapons are easy to get wrong when the names were written before
 * anyone looked at the models, so this exists to put all 60-odd icons and
 * their names on one page and make the mismatches obvious.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CELL = 200;
const LABEL_HEIGHT = 34;
const PER_SHEET = 24;

function parseArgs(argv) {
  const args = {
    in: join(repoRoot, 'build', 'weapon-icons'),
    out: join(repoRoot, 'build', 'weapon-icons'),
    columns: 6,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.in = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--out') args.out = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--columns') args.columns = Number(argv[i + 1] ?? 6);
  }
  return args;
}

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  const jobsPath = process.env.SHEET_JOBS;
  const outDir = process.env.SHEET_OUT;

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 400, height: 400 });
    const { sheets, columns } = JSON.parse(await readFile(jobsPath, 'utf8'));
    const written = [];
    await win.loadURL('data:text/html,<body></body>');
    for (const [index, sheet] of sheets.entries()) {
      const rows = Math.ceil(sheet.length / columns);
      const payload = JSON.stringify({ sheet, columns, rows, CELL, LABEL_HEIGHT });
      const dataUrl = await win.webContents.executeJavaScript(`(async () => {
        const { sheet, columns, rows, CELL, LABEL_HEIGHT } = ${payload};
        const canvas = document.createElement('canvas');
        canvas.width = columns * CELL;
        canvas.height = rows * (CELL + LABEL_HEIGHT);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#12171f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < sheet.length; i++) {
          const cx = (i % columns) * CELL;
          const cy = Math.floor(i / columns) * (CELL + LABEL_HEIGHT);
          const img = new Image();
          await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = sheet[i].data; });
          ctx.drawImage(img, cx + 8, cy + 4, CELL - 16, CELL - 16);
          ctx.fillStyle = '#e8f2ff';
          ctx.font = '600 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(sheet[i].name, cx + CELL / 2, cy + CELL + 4, CELL - 10);
          ctx.fillStyle = '#7f93ab';
          ctx.font = '12px monospace';
          ctx.fillText(sheet[i].id, cx + CELL / 2, cy + CELL + 22, CELL - 10);
        }
        return canvas.toDataURL('image/png');
      })()`);
      const target = join(outDir, `_sheet-${index + 1}.png`);
      await writeFile(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
      written.push(target);
    }
    process.stdout.write(`\n__SHEET__${JSON.stringify(written)}__SHEET__\n`);
    win.destroy();
    app.exit(0);
  });
} else {
  const args = parseArgs(process.argv.slice(2));
  const { WEAPONS } = await import('./weapon_catalog_data.mjs');
  const available = new Set((await readdir(args.in)).filter((n) => n.endsWith('.png')));

  const cells = [];
  for (const weapon of WEAPONS) {
    const file = `${weapon.id}.png`;
    if (!available.has(file)) continue;
    const data = `data:image/png;base64,${(await readFile(join(args.in, file))).toString('base64')}`;
    cells.push({ id: weapon.id, name: weapon.name, data });
  }
  const sheets = [];
  for (let i = 0; i < cells.length; i += PER_SHEET) sheets.push(cells.slice(i, i + PER_SHEET));

  await mkdir(args.out, { recursive: true });
  const workDir = await mkdtemp(join(tmpdir(), 'asteron-sheet-'));
  const jobsPath = join(workDir, 'jobs.json');
  await writeFile(jobsPath, JSON.stringify({ sheets, columns: args.columns }), 'utf8');

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, SHEET_JOBS: jobsPath, SHEET_OUT: args.out },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', () => {});
  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__SHEET__([\s\S]*?)__SHEET__/);
  if (!match) {
    console.error(`sheet build produced no result (electron exit ${exitCode})`);
    process.exit(1);
  }
  for (const file of JSON.parse(match[1])) console.log(file);
}
