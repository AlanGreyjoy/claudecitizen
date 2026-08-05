#!/usr/bin/env node
/**
 * Get the JavaScript stack out of a wedged renderer.
 *
 * A main thread stuck in an infinite loop reports nothing: no console line
 * (nothing returns to the event loop to print it), no telemetry flush, no
 * responsive DevTools window, no crash dump. Force-quitting throws away the one
 * piece of evidence that would name the bug in a single line.
 *
 * The DevTools Protocol still gets in. `Debugger.pause` raises a V8 interrupt
 * that fires at the next statement *inside* the running loop, so the paused
 * event carries the exact call stack of the wedge. If no pause arrives, the
 * thread is not executing JavaScript at all — a GPU/driver stall or a blocking
 * native call — which is just as decisive an answer.
 *
 * Usage:
 *
 *   CLAUDECITIZEN_DEBUG_PORT=9222 npm run editor:dev     # in one terminal
 *   ...reproduce the freeze...
 *   node scripts/wedge_stack.mjs                          # in another
 *
 * Options:
 *   --port <n>       DevTools port. Default 9222.
 *   --target <text>  Substring of the target title/url to attach to. Default:
 *                    every page target, tried in turn.
 *   --profile        Also record a 3s CPU profile and print the hottest frames.
 *                    Useful when the loop is slow rather than infinite.
 *   --wait <ms>      How long to wait for the pause. Default 8000.
 */

const DEFAULT_PORT = 9222;
const DEFAULT_WAIT_MS = 8_000;
const MAX_FRAMES = 40;
const PROFILE_MS = 3_000;

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, target: null, profile: false, wait: DEFAULT_WAIT_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--profile') args.profile = true;
    else if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--target') args.target = argv[++i];
    else if (flag === '--wait') args.wait = Number(argv[++i]);
    else {
      process.stderr.write(`Unknown option "${flag}". See the header of this file.\n`);
      process.exit(1);
    }
  }
  return args;
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
  if (!response?.ok) {
    process.stderr.write(
      `No DevTools endpoint on 127.0.0.1:${port}.\n`
      + 'Start the app with CLAUDECITIZEN_DEBUG_PORT=9222 first.\n',
    );
    process.exit(1);
  }
  return response.json();
}

/** Minimal CDP client: one socket, id-matched replies, event listeners. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data);
    if (frame.id != null) {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (frame.error) entry.reject(new Error(frame.error.message));
      else entry.resolve(frame.result);
      return;
    }
    for (const handler of listeners.get(frame.method) ?? []) handler(frame.params);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error(`Cannot open ${url}`)));
  });

  return {
    ready,
    close: () => socket.close(),
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) ?? []), handler]);
    },
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

function shortenUrl(url) {
  if (!url) return '<anonymous>';
  // Vite dev URLs carry a query and an absolute origin; neither identifies the
  // file any better than the path does.
  return url.replace(/^[a-z-]+:\/\/[^/]+/i, '').replace(/\?.*$/, '');
}

function printCallFrames(callFrames) {
  process.stdout.write('\nWEDGED AT (innermost first):\n');
  for (const frame of callFrames.slice(0, MAX_FRAMES)) {
    const name = frame.functionName || '<anonymous>';
    const { url, lineNumber, columnNumber } = frame.location
      ? { url: frame.url, ...frame.location }
      : frame;
    process.stdout.write(
      `  ${name}  ${shortenUrl(url)}:${(lineNumber ?? 0) + 1}:${(columnNumber ?? 0) + 1}\n`,
    );
  }
  if (callFrames.length > MAX_FRAMES) {
    process.stdout.write(`  ... ${callFrames.length - MAX_FRAMES} more\n`);
  }
}

/** Self time per function, so an infinite loop sorts to the top by construction. */
function printProfile(profile) {
  const selfByNode = new Map();
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const deltaUs = profile.timeDeltas?.[index] ?? 0;
    selfByNode.set(id, (selfByNode.get(id) ?? 0) + deltaUs);
  }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const ranked = [...selfByNode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  process.stdout.write('\nHOTTEST FRAMES (self time):\n');
  for (const [id, micros] of ranked) {
    const frame = byId.get(id)?.callFrame;
    if (!frame) continue;
    process.stdout.write(
      `  ${Math.round(micros / 1000)
        .toString()
        .padStart(6)} ms  ${frame.functionName || '(anonymous)'}`
      + `  ${shortenUrl(frame.url)}:${(frame.lineNumber ?? 0) + 1}\n`,
    );
  }
}

async function inspectTarget(target, args) {
  process.stdout.write(`\n=== ${target.title || target.url} ===\n`);
  const client = connect(target.webSocketDebuggerUrl);
  await client.ready;

  const paused = new Promise((resolve) => {
    client.on('Debugger.paused', resolve);
  });
  await client.send('Debugger.enable');

  let profilePromise = null;
  if (args.profile) {
    await client.send('Profiler.enable');
    await client.send('Profiler.start');
    profilePromise = new Promise((resolve) => {
      setTimeout(() => resolve(client.send('Profiler.stop')), PROFILE_MS);
    });
  }

  void client.send('Debugger.pause').catch(() => {});
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), args.wait);
  });
  const event = await Promise.race([paused, timeout]);

  if (event) {
    printCallFrames(event.callFrames);
    process.stdout.write(`  reason: ${event.reason}\n`);
  } else {
    process.stdout.write(
      '\nNo pause within the wait window.\n'
      + 'The thread is not running JavaScript — suspect a GPU/driver stall or a\n'
      + 'blocking native call, not an engine loop.\n',
    );
  }

  if (profilePromise) {
    const result = await profilePromise.catch(() => null);
    if (result?.profile) printProfile(result.profile);
    await client.send('Profiler.disable').catch(() => {});
  }

  // Leave the app exactly as it was found, so the same freeze can be sampled
  // more than once.
  await client.send('Debugger.resume').catch(() => {});
  await client.send('Debugger.disable').catch(() => {});
  client.close();
}

const args = parseArgs(process.argv.slice(2));
const targets = (await listTargets(args.port)).filter(
  (target) => target.type === 'page' && target.webSocketDebuggerUrl,
);
const matched = args.target
  ? targets.filter((target) => `${target.title} ${target.url}`.includes(args.target))
  : targets;

if (matched.length === 0) {
  process.stderr.write('No matching page target. Available:\n');
  for (const target of targets) {
    process.stderr.write(`  ${target.title} — ${target.url}\n`);
  }
  process.exit(1);
}

for (const target of matched) {
  await inspectTarget(target, args).catch((error) => {
    process.stderr.write(`  failed: ${error.message}\n`);
  });
}
