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

Since the boot-scene rework, the entry surface a deep link parks against is the
flow's `titleSceneId` (falling back to the project boot scene), and the
"resume beats the authored hop" rule is the first branch of
`resolveSceneFlowStep` rather than a special case in the host.

## What the launch broke, and why the checks missed it

Everything in the verification table above passed, and the deployment was still
unplayable in two ways. Both failures are invisible to a health check because
neither the API nor the transport is at fault.

### Every character stood in T-pose

Animation clips are referenced by the **animation controller document**
(`src/player/animation/data/default.controller.json` → `sources[].url`), not by
any prefab. The release build's asset copier walks `*.prefab.json` to decide what
to ship, so it never saw them and `/assets/animations/ProRifle/locomotion.glb`
(or the older per-clip URLs) returned 404 in production. The Sidekick avatar
assembled fine — it just had no clips, and an animated skeleton with nothing
playing is a T-pose.

The build now also scans `src/player/animation/data/*.controller.json` and ships
every `sources[].url` it finds, warning for each one the project's asset library
does not have. Stance locomotion is packed as multi-clip GLBs (`ProRifle/locomotion.glb`,
`HandgunLocomotions/locomotion.glb`, plus UAL); build those with
`npm run pack:anims -- --project <projectRoot>` before shipping.

One separate path is still dead, and it is not what caused the T-pose:
`UNIVERSAL_ANIMATION_LIBRARY_URL` in `unity-humanoid-retarget.ts` hardcodes
`/assets/protected/animations/universal-animation-library/UAL1_Standard.glb`,
while the project keeps that pack at
`assets/animations/universal-animation-library-1/`. Gameplay never needs it —
retargeting reads the clip GLB and the Sidekick rig directly — but the default
mannequin used for NPC fallbacks does. Move the file to the documented path to
restore it.

### Players could not see each other

Not the ports, and not the certificate. Presence is broadcast per **cell**, and
the cell comes from the session ticket — the player's stored
`currentInstanceId`. The `Join` the client sends on connect is *ignored* by the
server; only a `Transition` moves a player between cells.

Registration puts every new account in `apartment:<id>`, a private instance.
Nothing in the BlackMarket scene ever transitioned out of it, so both players
were connected, healthy, publishing presence — into two separate cells.

Scene kind `instance` now means what it says: the play session transitions into
`scene:<scene id>` immediately after connecting, so everyone who loads that scene
shares one cell. Movement between places later became `scene-exit`'s job
exclusively — see the note on the single-mechanism model below.

Registration also keyed that starting apartment by **user** id while
`/game/bootstrap` reported — and `authorize_instance` checked — the **player**
id, so the apartment a player started in was one they could never transition back
to. Fixed in `auth.rs`; migration `0019` re-keys existing rows.

### …and then still could not, for three more reasons

Sharing a cell turned out to be necessary and not sufficient. Chat kept working
throughout, which read as "the connection is fine" — but the server echoes your
own messages back to you, so chat working proves nothing about whether anyone
else is there. Three separate faults sat behind it:

1. **Snapshots were sized against `MAX_DATAGRAM_BYTES`** (48 KB, a protocol
   sanity bound) rather than what QUIC actually carries (~1.2 KB). Every
   snapshot repeated every entity's appearance JSON, so a cell with two players
   cleared the real limit immediately and the send failed into `let _`. Chat was
   unaffected because it goes over the reliable stream. This is the one that
   made "populated cell" and "empty cell" look identical to a client.
2. **A cell was also a view distance.** Presence only ever crossed a cell's own
   channel, while the visibility filter claimed a 50 km radius over a 5 km grid.
   The effective view distance was "same bucket": two players ten metres apart
   across a grid line shared nothing.
3. **A remote player with no appearance yet rendered as an invisible mannequin**
   whose GLB 404'd, so an entity that replicated correctly still drew nothing.

### The replication rewrite (protocol v2)

Fixing these one at a time would have left the shape that produced them, so the
replication layer was rebuilt into three stages with separate jobs — cells
simulate, edges decide what each viewer needs, clients render. The load-bearing
changes:

- **Identity left the per-tick path.** Appearance and display name are an
  `EntityProfile` sent once per viewer on entry; state is addressed by a small
  per-connection handle instead of a repeated 36-byte UUID. A moving player now
  costs well under 200 bytes per frame; an idle one costs nothing at all.
- **Interest management moved to the edge**, which subscribes to the whole 3×3×3
  neighbourhood around the viewer. Cell size and interest radius are now separate
  numbers in `grid.rs` tied by `interest <= size`, which is what makes that
  neighbourhood provably sufficient. Cell edges are no longer sight walls.
- **Path choice is by kind, not size.** Baselines, entries and exits take the
  reliable stream; state churn takes a datagram. The client therefore never
  expires an entity on silence — silence is the expected cost of standing still.
- **Boundary hysteresis**, so standing on a cell line no longer re-subscribes and
  re-baselines every frame.
- **Checkpoints stopped reusing the wire snapshot.** The wire format is lossy on
  purpose now (no velocity, f32 orientation, no identity), which would have made
  a bandwidth optimisation silently corrupt persistence.

Bumping `PROTOCOL_VERSION` to 2 invalidates old cell checkpoints by design; they
restore as empty. Client and backend must be deployed together — a v1 client
against a v2 server fails the version check at connect rather than mis-decoding.

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
