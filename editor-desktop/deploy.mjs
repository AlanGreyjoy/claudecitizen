/**
 * Backend + client deployment driven from the editor's Deploy tab.
 *
 * Runs entirely in the Electron main process. The renderer is `cceditor://app`
 * and has neither Node nor a route to the box — the same constraint that forces
 * backend calls through `/__editor/backend/*`.
 *
 * Configuration (including the root password) is stored per project root in
 * `~/.asteron/deploy.json` at mode 0600, alongside the `agent.json` the MCP
 * server already writes. It deliberately never touches `asteron.project.json`:
 * that file is committed with the project, and this repository's deploy README
 * is explicit that the server's address and credentials stay out of any repo.
 */

import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.asteron');
const CONFIG_PATH = join(CONFIG_DIR, 'deploy.json');
const CONNECT_TIMEOUT_MS = 20_000;
/** Kept small: a stuck `docker compose build` should surface, not hang forever. */
const STEP_TIMEOUT_MS = 30 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 15_000;

export class DeployError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DeployError';
    this.status = status;
  }
}

/**
 * Default remote pipeline, transcribed from `deploy/README.md`. Commands are
 * stored as templates so editing `remotePath` or `branch` in the UI flows
 * through without the user rewriting every step by hand.
 */
const DEFAULT_STEPS = [
  {
    id: 'fetch',
    label: 'Fetch',
    command: 'cd {{remotePath}} && git fetch {{gitRemote}} --prune',
    enabled: true,
  },
  {
    id: 'pull',
    label: 'Pull branch',
    command: 'cd {{remotePath}} && git checkout {{branch}} && git pull --ff-only {{gitRemote}} {{branch}}',
    enabled: true,
  },
  {
    id: 'revision',
    label: 'Record revision',
    command: 'cd {{remotePath}} && git rev-parse --short HEAD && git log -1 --pretty=%s',
    enabled: true,
  },
  {
    id: 'up',
    label: 'Rebuild containers',
    command: 'cd {{remotePath}} && {{compose}} up -d --build',
    enabled: true,
  },
  {
    id: 'ps',
    label: 'Container status',
    command: 'cd {{remotePath}} && {{compose}} ps',
    enabled: true,
  },
];

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  host: '',
  port: 22,
  username: 'root',
  password: '',
  privateKeyPath: '',
  remotePath: '/opt/claudecitizen',
  gitRemote: 'origin',
  branch: 'main',
  composeFiles: ['docker-compose.yml', 'deploy/docker-compose.prod.yml'],
  envFile: 'deploy/.env',
  healthUrl: '',
  netlifySite: '',
  steps: DEFAULT_STEPS,
};

function trimmedString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeSteps(value) {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_STEPS.map((step) => ({ ...step }));
  const steps = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const command = trimmedString(entry.command);
    if (!command) continue;
    steps.push({
      id: trimmedString(entry.id, `step-${index + 1}`),
      label: trimmedString(entry.label, `Step ${index + 1}`),
      command,
      enabled: entry.enabled !== false,
    });
  }
  return steps.length > 0 ? steps : DEFAULT_STEPS.map((step) => ({ ...step }));
}

function normalizeConfig(value) {
  const source = typeof value === 'object' && value !== null ? value : {};
  const port = Number.parseInt(String(source.port ?? ''), 10);
  const composeFiles = Array.isArray(source.composeFiles)
    ? source.composeFiles.map((file) => trimmedString(file)).filter(Boolean)
    : [];
  return {
    schemaVersion: 1,
    host: trimmedString(source.host),
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : 22,
    username: trimmedString(source.username, DEFAULT_CONFIG.username),
    password: typeof source.password === 'string' ? source.password : '',
    privateKeyPath: trimmedString(source.privateKeyPath),
    remotePath: trimmedString(source.remotePath, DEFAULT_CONFIG.remotePath),
    gitRemote: trimmedString(source.gitRemote, DEFAULT_CONFIG.gitRemote),
    branch: trimmedString(source.branch, DEFAULT_CONFIG.branch),
    composeFiles: composeFiles.length > 0 ? composeFiles : [...DEFAULT_CONFIG.composeFiles],
    envFile: trimmedString(source.envFile, DEFAULT_CONFIG.envFile),
    healthUrl: trimmedString(source.healthUrl),
    netlifySite: trimmedString(source.netlifySite),
    steps: normalizeSteps(source.steps),
  };
}

/** The `docker compose -f … --env-file …` prefix every remote step shares. */
function composePrefix(config) {
  const files = config.composeFiles.map((file) => `-f ${file}`).join(' ');
  return `docker compose ${files} --env-file ${config.envFile}`.replace(/\s+/g, ' ');
}

function renderCommand(command, config) {
  return command
    .replaceAll('{{remotePath}}', config.remotePath)
    .replaceAll('{{gitRemote}}', config.gitRemote)
    .replaceAll('{{branch}}', config.branch)
    .replaceAll('{{envFile}}', config.envFile)
    .replaceAll('{{compose}}', composePrefix(config));
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    // No store yet, or it was hand-edited into something unreadable. Defaults win.
    return {};
  }
}

async function writeStore(store) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // writeFile's mode only applies on create; re-assert it so an existing
  // world-readable file from an older version gets locked down too.
  await chmod(CONFIG_PATH, 0o600);
}

/** Runs a local command, streaming combined output through `onLine`. */
function runLocal(command, args, options, onLine) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    const emit = (chunk) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    };
    child.stdout?.on('data', emit);
    child.stderr?.on('data', emit);
    child.once('error', (error) => {
      resolveResult({ code: -1, error: error.message });
    });
    child.once('close', (code) => {
      if (pending) onLine(pending);
      resolveResult({ code: code ?? -1 });
    });
  });
}

/** Captures a local command's stdout without streaming it. Used for git preflight. */
function captureLocal(command, args, cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.once('error', () => resolveResult({ ok: false, out: '' }));
    child.once('close', (code) => resolveResult({ ok: code === 0, out: out.trim() }));
  });
}

/**
 * Compares this checkout against the branch the box will pull.
 *
 * The server builds the backend from source (`docker-compose.yml` has a `build:`
 * context) and gets that source with `git pull`, so a deploy ships the *pushed*
 * branch — never the working tree. Uncommitted or unpushed work silently does
 * not ship, which is the failure this check exists to make loud.
 */
export async function inspectLocalGit(repositoryRoot, config) {
  const branch = config.branch || 'main';
  const remote = config.gitRemote || 'origin';
  const [head, headSubject, remoteHead, dirty] = await Promise.all([
    captureLocal('git', ['rev-parse', '--short', 'HEAD'], repositoryRoot),
    captureLocal('git', ['log', '-1', '--pretty=%s'], repositoryRoot),
    captureLocal('git', ['rev-parse', '--short', `${remote}/${branch}`], repositoryRoot),
    captureLocal('git', ['status', '--porcelain'], repositoryRoot),
  ]);

  const dirtyFiles = dirty.ok && dirty.out ? dirty.out.split('\n').length : 0;
  const warnings = [];
  if (dirtyFiles > 0) {
    warnings.push(
      `${dirtyFiles} uncommitted file${dirtyFiles === 1 ? '' : 's'} in this checkout will not ship — the box builds from ${remote}/${branch}.`,
    );
  }
  if (head.ok && remoteHead.ok && head.out !== remoteHead.out) {
    warnings.push(
      `Local HEAD (${head.out}) differs from ${remote}/${branch} (${remoteHead.out}). Push first, or the deploy ships the older commit.`,
    );
  }
  if (!remoteHead.ok) {
    warnings.push(`Could not resolve ${remote}/${branch} locally. Run \`git fetch\` to refresh it.`);
  }

  return {
    head: head.ok ? head.out : '',
    headSubject: headSubject.ok ? headSubject.out : '',
    remoteHead: remoteHead.ok ? remoteHead.out : '',
    branch,
    remote,
    dirtyFiles,
    warnings,
  };
}

async function connectionOptions(config) {
  if (!config.host) throw new DeployError('Set the server host or IP before deploying.');
  const options = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: CONNECT_TIMEOUT_MS,
    keepaliveInterval: 15_000,
  };
  if (config.privateKeyPath) {
    try {
      options.privateKey = await readFile(config.privateKeyPath);
    } catch (error) {
      throw new DeployError(`Could not read the private key at ${config.privateKeyPath}: ${error.message}`);
    }
    if (config.password) options.passphrase = config.password;
  } else if (config.password) {
    options.password = config.password;
  } else {
    throw new DeployError('Set a password or a private key path before deploying.');
  }
  return options;
}

/** Opens an SSH session. `ssh2` is imported lazily so the editor boots without it. */
async function openSession(config) {
  const { Client } = await import('ssh2');
  const options = await connectionOptions(config);
  const client = new Client();
  await new Promise((resolveReady, rejectReady) => {
    client.once('ready', resolveReady);
    client.once('error', (error) => {
      rejectReady(new DeployError(`SSH connection to ${config.host} failed: ${error.message}`, 502));
    });
    client.connect(options);
  });
  return client;
}

/** Runs one remote command, streaming stdout and stderr line by line. */
function execRemote(client, command, onLine) {
  return new Promise((resolveResult) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const timer = setTimeout(() => {
      finish({ code: -1, error: `Timed out after ${Math.round(STEP_TIMEOUT_MS / 60_000)} minutes.` });
    }, STEP_TIMEOUT_MS);

    client.exec(command, { pty: false }, (error, stream) => {
      if (error) {
        finish({ code: -1, error: error.message });
        return;
      }
      let pending = '';
      const emit = (chunk) => {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) onLine(line.replace(/\r$/, ''));
      };
      stream.on('data', emit);
      stream.stderr.on('data', emit);
      stream.once('close', (code) => {
        if (pending) onLine(pending);
        finish({ code: typeof code === 'number' ? code : -1 });
      });
    });
  });
}

async function checkHealth(url, onLine) {
  onLine(`GET ${url}`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const body = (await response.text()).trim().slice(0, 400);
    onLine(`${response.status} ${response.statusText} ${body}`);
    return response.ok;
  } catch (error) {
    onLine(`Health check failed: ${error.message}`);
    return false;
  }
}

export function createDeployManager({ getRepository, repositoryRoot, npmCommand, onEvent }) {
  /** Guards against a second deploy starting while one is mid-flight. */
  let running = false;
  let activeClient = null;
  let canceled = false;

  const emit = (event) => onEvent(event);
  const log = (line) => emit({ phase: 'log', line });

  function projectKey() {
    const repository = getRepository();
    if (!repository) throw new DeployError('No AsteronEngine project is open.');
    return repository.projectRoot;
  }

  async function getConfig() {
    const store = await readStore();
    const config = normalizeConfig(store[projectKey()]);
    // The password never leaves the main process; the UI only learns whether one is set.
    const { password, ...safe } = config;
    return { config: { ...safe, hasPassword: password.length > 0 }, defaultSteps: DEFAULT_STEPS };
  }

  async function saveConfig(value) {
    const key = projectKey();
    const store = await readStore();
    const existing = normalizeConfig(store[key]);
    const incoming = typeof value === 'object' && value !== null ? value : {};
    // An omitted password means "leave it alone" — the UI never round-trips it.
    const password = typeof incoming.password === 'string' ? incoming.password : existing.password;
    const config = normalizeConfig({ ...incoming, password });
    store[key] = config;
    await writeStore(store);
    const { password: saved, ...safe } = config;
    return { saved: true, config: { ...safe, hasPassword: saved.length > 0 }, path: CONFIG_PATH };
  }

  async function loadConfig() {
    const store = await readStore();
    return normalizeConfig(store[projectKey()]);
  }

  async function preflight() {
    return inspectLocalGit(repositoryRoot, await loadConfig());
  }

  async function testConnection() {
    const config = await loadConfig();
    const client = await openSession(config);
    try {
      const lines = [];
      const collect = (line) => lines.push(line);
      await execRemote(client, 'uname -srm; docker --version; docker compose version', collect);
      const probe = await execRemote(client, `test -d ${JSON.stringify(config.remotePath)}/.git`, () => {});
      return {
        ok: true,
        detail: lines.filter(Boolean).join('\n'),
        remotePathIsRepo: probe.code === 0,
      };
    } finally {
      client.end();
    }
  }

  async function runBackendSteps(config) {
    const steps = config.steps.filter((step) => step.enabled);
    emit({
      phase: 'started',
      target: 'backend',
      steps: steps.map((step) => step.label),
      message: `Connecting to ${config.username}@${config.host}…`,
    });

    const client = await openSession(config);
    activeClient = client;
    log(`Connected to ${config.host}.`);
    try {
      for (const [index, step] of steps.entries()) {
        if (canceled) return { ok: false, message: 'Deploy canceled.' };
        const command = renderCommand(step.command, config);
        emit({ phase: 'step', stepIndex: index, label: step.label });
        log(`$ ${command}`);
        const result = await execRemote(client, command, log);
        if (result.code !== 0) {
          const detail = result.error ? ` (${result.error})` : '';
          return {
            ok: false,
            message: `Step "${step.label}" failed with exit code ${result.code}${detail}.`,
            failedStep: index,
          };
        }
      }
    } finally {
      activeClient = null;
      client.end();
    }

    if (config.healthUrl) {
      emit({ phase: 'step', stepIndex: steps.length, label: 'Health check' });
      const healthy = await checkHealth(config.healthUrl, log);
      if (!healthy) {
        return {
          ok: false,
          message: 'Containers restarted but the health check did not return OK. Check the logs above.',
        };
      }
    }
    return { ok: true, message: 'Backend deployed.' };
  }

  async function deployBackend() {
    if (running) throw new DeployError('A deploy is already running.');
    running = true;
    canceled = false;
    try {
      const config = await loadConfig();
      const result = await runBackendSteps(config);
      emit({ phase: result.ok ? 'success' : 'error', target: 'backend', ...result });
      return result;
    } catch (error) {
      const result = { ok: false, message: error.message };
      emit({ phase: 'error', target: 'backend', ...result });
      return result;
    } finally {
      running = false;
    }
  }

  /**
   * Client half: build the release, then hand the publish directory to Netlify.
   * `--no-build` matters — without it the CLI finds `docs/netlify.toml` and
   * uploads the documentation site instead.
   */
  async function deployClient() {
    if (running) throw new DeployError('A deploy is already running.');
    const repository = getRepository();
    if (!repository) throw new DeployError('No AsteronEngine project is open.');
    running = true;
    canceled = false;
    try {
      const config = await loadConfig();
      const projectRoot = repository.projectRoot;
      const { document: settings } = await repository.getProjectSettings();
      const outDir = join(projectRoot, settings.build.outDir);

      emit({
        phase: 'started',
        target: 'client',
        steps: ['Build web release', 'Netlify deploy'],
        message: 'Building web release…',
      });

      emit({ phase: 'step', stepIndex: 0, label: 'Build web release' });
      log(`$ npm run build:project-web -- --project ${projectRoot}`);
      const build = await runLocal(
        npmCommand,
        ['run', 'build:project-web', '--', '--project', projectRoot],
        { cwd: repositoryRoot, env: { ...process.env, CI: '1' } },
        log,
      );
      if (build.code !== 0) {
        const result = { ok: false, message: `Web build failed with exit code ${build.code}.` };
        emit({ phase: 'error', target: 'client', ...result });
        return result;
      }

      const args = ['netlify', 'deploy', '--dir', outDir, '--prod', '--no-build'];
      if (config.netlifySite) args.push('--site', config.netlifySite);
      emit({ phase: 'step', stepIndex: 1, label: 'Netlify deploy' });
      log(`$ npx ${args.join(' ')}`);
      const publish = await runLocal('npx', args, { cwd: projectRoot, env: process.env }, log);
      const result =
        publish.code === 0
          ? { ok: true, message: 'Client released to Netlify.' }
          : { ok: false, message: `Netlify deploy failed with exit code ${publish.code}.` };
      emit({ phase: result.ok ? 'success' : 'error', target: 'client', ...result });
      return result;
    } catch (error) {
      const result = { ok: false, message: error.message };
      emit({ phase: 'error', target: 'client', ...result });
      return result;
    } finally {
      running = false;
    }
  }

  function cancel() {
    if (!running) return { canceled: false };
    canceled = true;
    log('Cancel requested — closing the SSH session.');
    // Compose keeps running on the box; this only detaches the editor from it.
    activeClient?.end();
    return { canceled: true };
  }

  return { getConfig, saveConfig, preflight, testConnection, deployBackend, deployClient, cancel };
}
