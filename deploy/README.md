# Shipping a web release

Two halves that are deployed separately:

| Half | Built by | Hosted on |
|------|----------|-----------|
| Game client | `npm run build:project-web` (or File → Build Web) | Netlify, static |
| Backend | `docker compose` on your own box | Any VPS with a public IP |

They are joined by exactly three values: `backendUrl` in the release,
`CLIENT_ORIGIN` on the server, and a DNS record. Get those three consistent and
everything else follows.

## The current deployment

| | |
|---|---|
| Game | <https://play.claude-citizen.com> (Netlify project `asteron-play`) |
| API | <https://api.claude-citizen.com> → Caddy → backend:3000 |
| World server | `https://api.claude-citizen.com:4433/world` (UDP, WebTransport) |
| Server path | `/opt/claudecitizen` on the API host |
| Certificates | Let's Encrypt, staged into `/opt/asteron/certs` |

This repository is public. The server's address, SSH user, and every credential
stay out of it — keep them in your own `.env` (git-ignored) or a password
manager, not in a committed file.

Boot straight into a named scene, skipping the title flow but still requiring
login:

```
https://play.claude-citizen.com/?boot=scene&sceneId=blackmarket
```

Deploy both halves:

```bash
npm run build:project-web -- --project /path/to/project
cd /path/to/project
npx netlify deploy --dir dist --site asteron-play --prod --no-build
```

`--no-build` matters: without it the CLI finds `docs/netlify.toml` and tries to
build the documentation site instead of uploading the release.

## Deploying from the editor

The **Deploy** menu drives both halves so you do not have to run any of the above
by hand. It is the same pipeline, not a second one — the default steps are
transcribed from this document and every one of them is editable.

| Menu item | What it runs |
|-----------|--------------|
| Deploy → Backend… | Opens SSH, runs the step list on the box, then GETs the health URL |
| Deploy → Front End… | `build:project-web` locally, then `netlify deploy --prod --no-build` |

Each opens its own dialog holding only the settings that half needs, a live log,
and its own Deploy button. The backend dialog also has **Test connection**, which
runs `uname` and `docker version`, checks the remote path is a git checkout, and
reports whether the env file is there.

Settings, **including the password**, live in `~/.asteron/deploy.json` at mode
0600 — per machine, never in the project and never in this repo. The password is
held in the Electron main process; the renderer only ever learns whether one is
set. Leave the password field blank to keep the stored one, or set a private key
path to use key auth instead.

### The env file stage

The env file holds every production secret, so it is git-ignored and `git pull`
never creates or updates it. That is the one input a deploy cannot get from the
branch, and it is why the first stage of every backend deploy is about it —
before this stage existed, a missing file surfaced minutes later as
`couldn't find env file` from inside `docker compose`.

Under the Remote tab, **Env file** is the path on the server, relative to the
server path. **Upload env file before deploying** decides what the stage does:

| Setting | First stage |
|---------|-------------|
| Off | Checks the file exists on the box and stops immediately, naming the path, if it does not |
| On | Uploads **Local env file** to that path over SSH at mode 0600 |

Uploading is the flexible option and the one to use if the box is not the only
place you keep the file. **Local env file** left blank means this checkout's
`deploy/.env` — the same relative path the server uses, git-ignored on both
ends — so filling that in and turning the toggle on is the whole setup. Set the
field to keep production secrets somewhere else entirely. Only the *path* goes
into `~/.asteron/deploy.json`; the secrets stay in the file. Note this is the
*engine* checkout's `deploy/.env`, not the open project's, and it is a different
file from `backend/.env`, which configures local development and would break
production if shipped. Each upload keeps the previous server copy as `<env file>.bak`,
writes through a temp file so an interrupted transfer cannot leave a half-written
env behind, and logs a byte count rather than any contents.

Leave it off when the server's env file is authoritative and edited on the box.

Under the backend dialog's Pipeline tab, step commands expand `{{remotePath}}`,
`{{branch}}`, `{{gitRemote}}`, `{{envFile}}` and `{{compose}}` (the full
`docker compose -f … --env-file …` prefix) from the fields above them, so
changing the branch does not mean rewriting every command. Steps run in order
over one SSH session and stop at the first non-zero exit.

**The banner at the top of the backend dialog is the part that matters.** The box
builds the backend from source and gets that source with `git pull`, so a deploy
ships whatever is on `origin/<branch>` — never your working tree. The dialog
compares local HEAD against the remote branch and warns about uncommitted or
unpushed work before you click. A clean banner means the commit you are looking
at is the commit that will ship.

Cancel closes the SSH session; it does not stop a `docker compose build` already
running on the box.

---

## 1. Server: DNS and certificates

Point an A record at the box before anything else — Let's Encrypt validates over
HTTP and cannot issue until DNS resolves.

```bash
# api.example.com  A  <server-ip>
dig +short api.example.com          # must print the server IP
```

Open the firewall. UDP 4433 is the one people forget, and without it the game
loads, logs in, and then never shows the other player.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 4433/udp
```

Issue the certificate with port 80 free, then stage it where both the proxy and
the WebTransport listener can read it:

```bash
sudo certbot certonly --standalone -d api.example.com
sudo deploy/sync-certs.sh api.example.com
```

## 2. Server: configuration and first run

```bash
git clone <repo> /opt/asteron/app && cd /opt/asteron/app
cp deploy/.env.example deploy/.env
openssl rand -base64 32              # run once per secret in the file
$EDITOR deploy/.env
```

`CLIENT_ORIGIN` must be the exact origin players load, with no trailing slash.
The backend allows a single origin, so Netlify deploy-preview and branch URLs
are rejected — deploy to production, or attach a custom domain.

`WEBTRANSPORT_ALLOWED_ORIGINS` is a **second** list, enforced by the UDP
listener instead of by CORS, and it must contain that same origin. The two are
separate because the desktop editor dials from a custom scheme that must never
be granted CORS access to the REST API. Getting this wrong is invisible from
the outside: the site loads, players log in, chat echoes back, and no player
ever sees another, because only the world session is rejected.

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env up -d --build
```

The Rust release build takes several minutes on first run. Verify:

```bash
curl https://api.example.com/readyz                     # {"status":"ready"}
docker compose ... logs backend | grep -i webtransport  # listening on 0.0.0.0:4433
```

### Diagnosing a failed dial

The browser collapses every world-session failure into one message —
`WebTransportError: Opening handshake failed` — whether the port is blocked, the
certificate is wrong, the origin was refused, or the ticket had expired. The
server log separates them (`WebTransport origin rejected` names both the origin
and the list it checked; `world ticket is invalid or expired` is the next gate),
so read it first.

Without shell access on the box, the gates are still distinguishable from
outside, because they fail differently. Dial `/world` with **no** `?ticket=`:

- `connection closed by peer` — the origin was accepted and the dial died at the
  missing ticket, which is as far as an unauthenticated probe can get. Origin,
  UDP, and certificate are all fine.
- an explicit rejection — the origin gate refused it, before any ticket is read.
- a timeout — nothing is listening on UDP 4433, or a firewall is dropping it.
- a certificate error — the listener fell back to self-signed, or the mounted
  PEM is stale. `sync-certs.sh` copies renewals, but the listener reads them
  only at startup, so a renewal without a restart serves the old certificate.

## 3. Client: build and deploy

Set the backend URL first — in the editor under Project Settings, or directly in
`<project>/asteron.project.json`:

```json
{ "backendUrl": "https://api.example.com" }
```

`http://` here is fatal: an HTTPS page cannot call an HTTP API, and the browser
blocks it as mixed content with no in-game error.

```bash
npm run build:project-web -- --project /path/to/project
npx netlify deploy --dir /path/to/project/dist --prod
```

The build warns if `backendUrl` is not HTTPS. Take the warning seriously.

`_headers` is emitted into the release: `asteron.runtime.json` is served
`no-store` so re-pointing a build at a new backend takes effect immediately,
and content-hashed `/assets/*` is pinned as immutable.

## 4. Re-pointing a build without rebuilding

`asteron.runtime.json` is read at startup, not baked in. To move a release to a
different backend, edit that one file in the publish directory and redeploy.

---

## Deploying content changes

| Change | How it ships |
|--------|--------------|
| Scenes, prefabs, planets, models | `npm run build:project-web` + Netlify deploy |
| Weapons, items, equipment definitions | New SQL file in `backend/migrations/`, then redeploy the backend |
| Backend code | `git pull && docker compose ... up -d --build` |

Catalog data lives in SQL migrations (`0008_equipment_catalog.sql`,
`0016_weapon_combat_ammo.sql`, `0017_weapon_combat_seed.sql`), not in rows you
hand-edit locally. `RUN_MIGRATIONS=true` applies them on boot, so adding a
weapon means adding a migration — your local Postgres never needs to be copied
to the server.

## Certificate renewal

Renewal needs three hooks, not one. All three are installed on the live box:

| Hook | Script | Why |
|------|--------|-----|
| `pre/` | `asteron-stop-caddy.sh` | Certbot renews with `--standalone`, which binds port 80. Caddy holds it, so renewal fails without this. |
| `deploy/` | `asteron-sync-certs.sh` | Containers read the staged copy in `CERT_DIR`, not `live/`. Re-stages it and restarts the backend so the WebTransport listener picks up the new key. |
| `post/` | `asteron-start-caddy.sh` | Brings the proxy back up. |

Verify well before expiry:

```bash
sudo certbot renew --dry-run
```

It talks to the ACME staging endpoint and can run for several minutes — give it
a generous timeout. If it is interrupted between the pre and post hooks, Caddy
stays stopped and the API goes dark. Restart it by hand:

```bash
cd /opt/claudecitizen && docker compose -f docker-compose.yml \
  -f deploy/docker-compose.prod.yml --env-file deploy/.env start caddy
```

## Why the overlay uses `!override`

Compose *concatenates* `ports` lists across `-f` files rather than replacing
them. A plain `ports:` in the overlay publishes each port twice and the stack
dies with `address already in use`. `!override` replaces the base list;
`!reset []` drops it entirely.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Every API call fails CORS | `CLIENT_ORIGIN` does not byte-match the browser's origin, or has a trailing slash |
| Login appears to succeed, next request is anonymous | `COOKIE_SAME_SITE` is not `none`, or `COOKIE_SECURE` is not `true` |
| Every character stands in T-pose | Animation clip GLBs are missing from the release. Load the game and check the network panel for a 404 on `/assets/animations/…`. Stance packs are `ProRifle/locomotion.glb` / `HandgunLocomotions/locomotion.glb` (build with `npm run pack:anims -- --project <root>`). The clips are referenced by the animation controller, not by any prefab, so the release build copies them from `src/player/animation/data/*.controller.json`; the build warns for each source the project's asset library does not have. |
| Game loads, players never see each other | Check the browser console for `WebTransport dial to … failed`. If it is there, no world session exists at all: check `WEBTRANSPORT_ALLOWED_ORIGINS` contains `CLIENT_ORIGIN` (the base compose file's development list wins over the production overlay unless the overlay restates it), then that UDP 4433 is open, then that the listener did not fall back to self-signed because it could not read `/certs/privkey.pem`. If the dial *succeeds*, check chat — the server echoes your own messages back, so "chat works" is satisfied by an empty cell. Seeing *each other's* messages means you share a cell and the fault is downstream; seeing only your own means you are in different cells (see below) |
| Players see each other, then stop | Backend predates the replication rewrite (protocol v2). Snapshots were sized against `MAX_DATAGRAM_BYTES` rather than the path MTU, so any cell holding two players silently stopped replicating everyone while chat kept working over the reliable stream. `git pull && docker compose … up -d --build` |
| A remote player is present but invisible | Their appearance never arrived, so the renderer fell back to a mannequin GLB that 404s. Check the network panel for `/assets/protected/animations/universal-animation-library/`. Protocol v2 holds an entity out of view until its profile lands, so this should now present as "briefly absent", not "invisible forever" |
| `WebTransport` connect fails after ~14 days | Running on a self-signed certificate; browsers cap hashed certs at 14 days |
| Requests blocked as mixed content | `backendUrl` in the release is `http://` |

## Which instance a player lands in

Presence is broadcast per **cell**, and the cell comes from the session ticket —
the player's stored `currentInstanceId` — not from the scene they loaded. The
`Join` the client sends on connect is ignored by the server; only a `Transition`
moves a player between cells.

New accounts start in `apartment:<player id>`, which is private. So two players
loading the same scene are in two different cells and see nothing of each other,
with a healthy connection and open ports throughout.

A scene of kind **`instance`** is a shared place: the play session transitions
into `scene:<scene id>` right after connecting, so everyone who loads that scene
shares one cell. Every other move between places is a `scene-exit` marker, which
carries the destination cell with it — a literal id like `station:public`, or a
per-player token (`@apartment`, `@hangar`, `@space`). Elevators no longer exist.

**A cell is no longer a view distance.** Planet and space instances are still
partitioned on a grid, but an edge session subscribes to the whole 3×3×3
neighbourhood around the viewer, so standing either side of a grid line no
longer hides anyone. Interiors — apartments, hangars, station rooms, shared
scenes — are a single unpartitioned cell. Two players who are both in
`apartment:<their own id>` still cannot see each other, and that is by design:
those instances are private.

Check who is where:

```bash
docker compose ... exec postgres \
  psql -U claude -d claude_citizen \
  -c 'SELECT "handle", "currentInstanceId", "currentRoomId" FROM "Player";'
```

Two rows with different `currentInstanceId` values is the whole bug.
