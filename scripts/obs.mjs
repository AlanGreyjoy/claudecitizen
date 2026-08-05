#!/usr/bin/env node
/**
 * Query the observability store from a terminal.
 *
 * Dashboards answer "is anything wrong". This answers "what exactly happened",
 * which is the shape a person or an agent needs when reading back a specific
 * failure. Output is compact JSON on stdout so it can be piped.
 *
 * Configuration (put these in a shell profile, or prefix the command):
 *
 *   OBS_URL       Base API URL, including org. Default http://localhost:5080/api/default
 *   OBS_USER      OpenObserve login email.     Default admin@claude-citizen.com
 *   OBS_PASSWORD  OpenObserve password.        Required.
 *   OBS_AUTH      Full Authorization header, used instead of user/password.
 *
 * Examples:
 *
 *   node scripts/obs.mjs errors --since 1h
 *   node scripts/obs.mjs slow-frames --since 24h
 *   node scripts/obs.mjs frames --session 4f1c... --since 6h
 *   node scripts/obs.mjs freezes --since 24h
 *   node scripts/obs.mjs tick --since 1h
 *   node scripts/obs.mjs logs --grep 'fan-out' --since 6h
 *   node scripts/obs.mjs sql 'SELECT * FROM "client" WHERE fps < 20' --since 2h
 *   node scripts/obs.mjs streams
 */

const DEFAULT_URL = 'http://localhost:5080/api/default';
const DEFAULT_USER = 'admin@claude-citizen.com';
/** Backend logs and traces land here; the client ingest writes its own stream. */
const LOG_STREAM = 'default';
const CLIENT_STREAM = 'client';
const DEFAULT_LIMIT = 50;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function authHeader() {
  if (process.env.OBS_AUTH) return process.env.OBS_AUTH;
  const password = process.env.OBS_PASSWORD;
  if (!password) {
    fail('Set OBS_PASSWORD (or OBS_AUTH). See the header of scripts/obs.mjs.');
  }
  const user = process.env.OBS_USER ?? DEFAULT_USER;
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** Accepts `90s`, `30m`, `6h`, `7d`. Bare numbers are minutes. */
function parseSince(value) {
  const match = /^(\d+)([smhd]?)$/.exec(value ?? '1h');
  if (!match) fail(`Could not read --since "${value}". Use forms like 30m, 6h, 7d.`);
  const amount = Number(match[1]);
  const unit = match[2] || 'm';
  const seconds = { d: 86400, h: 3600, m: 60, s: 1 }[unit];
  return amount * seconds * 1_000_000;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

/** Single-quote escaping for values interpolated into SQL. */
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function request(path, init) {
  const base = (process.env.OBS_URL ?? DEFAULT_URL).replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    fail(`Could not reach ${base}. Is OpenObserve running? (${error.message})`);
  }
  const text = await response.text();
  if (!response.ok) fail(`${response.status} ${response.statusText}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function search(sql, sinceMicros, limit) {
  const end = Date.now() * 1000;
  const result = await request('/_search?type=logs', {
    body: JSON.stringify({
      query: {
        end_time: end,
        from: 0,
        size: limit,
        sql,
        start_time: end - sinceMicros,
      },
    }),
    method: 'POST',
  });
  return result?.hits ?? [];
}

/** Metrics are read through the Prometheus-compatible endpoint, not SQL. */
async function promQuery(query, sinceMicros) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.floor(sinceMicros / 1_000_000);
  const params = new URLSearchParams({
    end: String(end),
    query,
    start: String(start),
    step: '60s',
  });
  const result = await request(`/prometheus/api/v1/query_range?${params}`, { method: 'GET' });
  return result?.data?.result ?? [];
}

function emit(rows) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

const COMMANDS = {
  /** Server-side 5xx, with the error chain and backtrace that Phase 1 added. */
  async errors({ since, limit }) {
    emit(
      await search(
        `SELECT _timestamp, level, message, error, error_chain, backtrace, request_id
         FROM "${LOG_STREAM}"
         WHERE message = 'request failed' OR level = 'ERROR'
         ORDER BY _timestamp DESC`,
        since,
        limit,
      ),
    );
  },

  /** Client stalls of 250 ms or more, worst first. */
  async freezes({ since, limit }) {
    emit(
      await search(
        `SELECT _timestamp, durationMs, sessionId, playerId, gpuVendor, gpuDevice,
                terrainWorkerBuilds, terrainBuildMsPeak, url
         FROM "${CLIENT_STREAM}"
         WHERE kind = 'freeze'
         ORDER BY durationMs DESC`,
        since,
        limit,
      ),
    );
  },

  /** Every frame sample, newest first. Narrow with --session. */
  async frames({ flags, since, limit }) {
    const filter =
      typeof flags.session === 'string' ? ` AND sessionId = ${quote(flags.session)}` : '';
    emit(
      await search(
        `SELECT _timestamp, fps, frameMs, frameP95Ms, worstFrameMs, simMs, renderMs,
                submitMs, outsideJsMs, jsMs, heapUsedMb, drawCalls, textureBytes,
                terrainBuildMsAverage, terrainBuildMsPeak, terrainWorkerBuilds,
                terrainPendingTiles, sessionId, playerId, gpuVendor, gpuDevice, buildId
         FROM "${CLIENT_STREAM}"
         WHERE kind = 'frame'${filter}
         ORDER BY _timestamp DESC`,
        since,
        limit,
      ),
    );
  },

  /** Free-text search over backend logs. */
  async logs({ flags, since, limit }) {
    const grep =
      typeof flags.grep === 'string' ? ` AND message LIKE ${quote(`%${flags.grep}%`)}` : '';
    const level = typeof flags.level === 'string' ? ` AND level = ${quote(flags.level)}` : '';
    emit(
      await search(
        `SELECT * FROM "${LOG_STREAM}" WHERE 1 = 1${grep}${level} ORDER BY _timestamp DESC`,
        since,
        limit,
      ),
    );
  },

  /**
   * Worst frame samples first.
   *
   * `outsideJsMs` is the column to read before any other: high against a low
   * `jsMs` means the cost is GPU submit or compositor, and profiling the call
   * tree is wasted effort.
   */
  async 'slow-frames'({ since, limit }) {
    emit(
      await search(
        `SELECT _timestamp, fps, frameMs, frameP95Ms, worstFrameMs, worstFrameBuilds,
                simMs, renderMs, submitMs, outsideJsMs, terrainWorkerBuilds,
                terrainBuildMsPeak, drawCalls, heapUsedMb, sessionId, playerId,
                gpuVendor, gpuDevice, hardwareConcurrency
         FROM "${CLIENT_STREAM}"
         WHERE kind = 'frame' AND frameP95Ms > 20
         ORDER BY frameP95Ms DESC`,
        since,
        limit,
      ),
    );
  },

  async sql({ positional, since, limit }) {
    const statement = positional[1];
    if (!statement) fail('Usage: obs.mjs sql \'SELECT ... FROM "client"\'');
    emit(await search(statement, since, limit));
  },

  async streams() {
    emit(await request('/streams', { method: 'GET' }));
  },

  /** Authoritative cell tick health — the metric that did not exist before. */
  async tick({ since }) {
    emit({
      overrunsPerSecond: await promQuery('rate(cc_cell_tick_overrun_total[5m])', since),
      p99Seconds: await promQuery(
        'histogram_quantile(0.99, rate(cc_cell_tick_duration_seconds_bucket[5m]))',
        since,
      ),
      sessions: await promQuery('cc_world_sessions_active', since),
    });
  },
};

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const name = positional[0];
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    fail(`Unknown command "${name ?? ''}". Available: ${Object.keys(COMMANDS).sort().join(', ')}`);
  }
  await command({
    flags,
    limit: Number(flags.limit ?? DEFAULT_LIMIT),
    positional,
    since: parseSince(typeof flags.since === 'string' ? flags.since : undefined),
  });
}

await main();
