---
sidebar_position: 6
title: POC launch (2026-07-27)
description: What the first public deployment shipped, how it is wired, and what it exposed.
---

# POC launch — 2026-07-27

The first public deployment of ClaudeCitizen. Scope was deliberately small: two
players signing in and walking around the **BlackMarket** scene together.

| | |
| --- | --- |
| Game | [play.claude-citizen.com](https://play.claude-citizen.com) — Netlify project `asteron-play` |
| Deep link | `https://play.claude-citizen.com/?boot=scene&sceneId=blackmarket` |
| API | [api.claude-citizen.com](https://api.claude-citizen.com) — Caddy → `backend:3000` |
| World server | `https://api.claude-citizen.com:4433/world` — WebTransport over UDP |
| Host | Vultr, Ubuntu 26.04, `/opt/claudecitizen` |
| Release size | 195 MB, 387 files |

## Shape of the deployment

```
browser ──HTTPS──> Netlify (static release, 195 MB)
   │
   ├──HTTPS/443──> Caddy ──> backend:3000 ──> Postgres / Redis
   └──UDP/4433───────────────> WebTransport listener (same process)
```

Netlify serves only static files. Both API and world traffic go straight to the
box; nothing is proxied through Netlify. Caddy terminates TLS for the API, and
the WebTransport listener reads the **same certificate files** from a staged
directory.

Three values join the halves, and all three must agree:

| Value | Where | Launch setting |
| --- | --- | --- |
| `backendUrl` | `asteron.runtime.json` in the release | `https://api.claude-citizen.com` |
| `CLIENT_ORIGIN` | backend env | `https://play.claude-citizen.com` |
| DNS | Netlify-managed zone | `api` → box IP, `play` → Netlify |

## Building a release for an external project

`npm run build:web` alone cannot produce a project release, and this is
structural rather than a configuration mistake.

The engine owns `index.html`, `vite.config.ts`, and every `import.meta.glob`
that pulls scenes, planets, systems, and prefabs into the bundle. Those globs
resolve against the **engine checkout**. A project supplies only `assets/` and a
handful of `src/**` documents. So building from the project root finds no Vite
config, and building from the engine root finds no project content.

`scripts/build_project_web.mjs` resolves this with a staging tree:

1. Hardlink the engine checkout into `.asteron-build/stage` — near-instant, no
   extra disk.
2. Overlay the project's `src/**` documents on top. Each file is removed before
   being written so a shared inode is never edited in place.
3. Hardlink the project's `assets/` in beside them.
4. Run Vite with the stage as its root, writing to the project's
   `build.outDir`.
5. Emit `asteron.runtime.json` and `_headers` into the output.

Project documents win where ids collide; engine-only scenes (`login`,
`character-creation`, `loading`) survive. The shipped game needs both sets.

**File → Build Web** runs this script from the engine root. It previously ran
`npm run build:web` with the working directory set to the project, which could
only ever fail with `Missing script: "build:web"`.

Public releases no longer bundle `editor.html`; the input is gated on
`mode === 'editor'`.

## Server configuration that mattered

Four settings are the difference between "loads" and "works". Every one of them
fails quietly.

| Setting | Value | Failure if wrong |
| --- | --- | --- |
| `CLIENT_ORIGIN` | exact game origin, no trailing slash | Every API call fails CORS. The backend allows exactly one origin, so Netlify preview URLs are rejected. |
| `COOKIE_SAME_SITE` / `COOKIE_SECURE` | `none` / `true` | Login appears to succeed, then every later request is anonymous. |
| `WEBTRANSPORT_CERT_PATH` / `KEY_PATH` | real CA pair | Server self-signs and browsers drop the connection after 14 days. |
| UDP 4433 | open | Game loads and logs in, but players never see each other. |

### Certificate staging

The backend container runs as uid 10001. Certbot writes `privkey.pem` as
`0600 root`, so mounting `/etc/letsencrypt` directly fails with `EACCES` and the
server silently falls back to self-signing. `deploy/sync-certs.sh` copies the
pair into `CERT_DIR` owned by `10001:10001`; Caddy and the backend both read
from there.

Renewal needs **three** hooks, not one, because certbot renews with
`--standalone` and Caddy holds port 80:

| Hook | Action |
| --- | --- |
| `pre` | stop Caddy |
| `deploy` | re-stage certs, restart backend |
| `post` | start Caddy |

### Compose overlay

Docker Compose **concatenates** `ports` lists across `-f` files rather than
replacing them, so a plain `ports:` in an overlay publishes each port twice and
the stack dies with `address already in use`. `deploy/docker-compose.prod.yml`
uses `!override` to replace a list and `!reset []` to drop one.

## Verified at launch

| Check | Result |
| --- | --- |
| `/readyz` over TLS | `{"status":"ready"}`, Let's Encrypt to 2026-10-25 |
| CORS preflight from the game origin | allow-origin + allow-credentials |
| Register → cookies | `cc_at` / `cc_rt` set |
| `POST /world/session` | 200, `certificateHashBase64: null` (real CA cert) |
| Protocol / simulation version | client 1/1, server 1/1 |
| Migrations | applied through `0018` |
| Asset delivery | `_headers` applied, `application/wasm` correct, range requests honoured |

The box had been running code from an earlier checkout and was missing
migrations `0012`–`0018` (survival vitals, wearable equipment, weapon ammo,
credits). It was updated and the image rebuilt as part of the launch.

## Deep links and authentication

`?boot=scene&sceneId=<id>` is available in public builds and requires a session.

`blackmarket` is scene kind `instance`, which is a gameplay kind. Entering a
gameplay scene without a session used to start play anyway, throwing
`Login required.` out of an unawaited promise and stranding the loading screen
on `Checking credentials...` with no login prompt and no error.

The scene host now routes an unauthenticated deep link through the `login`
scene and **returns to the requested scene** afterwards, rather than following
the login scene's authored link to `character-creation` → `main-game`. Players
missing an appearance are still gated — `resolveSceneBootstrap` shows the
character creator inline before the world loads.

## Known gaps

- **Cold load is 195 MB**, dominated by a 97 MB uncompressed `BlackMarket.glb`
  and a 34 MB spawn-tile blob. Draco or meshopt compression is the obvious next
  step. Netlify's free tier includes 100 GB/month of bandwidth.
- **Licensed packs ship as raw downloadable files** on a public CDN with no
  auth. Accepted for a POC; revisit before any real launch.
- **Deploy is manual** — build locally, `netlify deploy --dir`. Pass
  `--no-build`, or the CLI finds `docs/netlify.toml` and builds the docs site
  instead.
- **One allowed origin.** Adding a second surface means changing
  `CLIENT_ORIGIN` and restarting the backend.
- **Mailpit is the SMTP sink**, so password-reset mail goes nowhere real.

## Deploying content changes

| Change | How it ships |
| --- | --- |
| Scenes, prefabs, planets, models | `npm run build:project-web` + `netlify deploy` |
| Weapons, items, equipment definitions | New SQL file in `backend/migrations/`, redeploy backend |
| Backend code | `git pull && docker compose … up -d --build` |

Catalog data lives in SQL migrations, not in hand-edited local rows, so a local
Postgres never needs to be copied to the server.

## Related

- [Deployment](./deployment)
- [Realtime](./realtime)
- `deploy/README.md` — the operational runbook, including exact commands
