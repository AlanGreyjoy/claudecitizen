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

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env up -d --build
```

The Rust release build takes several minutes on first run. Verify:

```bash
curl https://api.example.com/readyz                     # {"status":"ready"}
docker compose ... logs backend | grep -i webtransport  # listening on 0.0.0.0:4433
```

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
  -f deploy/docker-compose.prod.yml --env-file .env start caddy
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
| Game loads, players never see each other | UDP 4433 blocked, or the WebTransport listener fell back to self-signed because it could not read `/certs/privkey.pem` |
| `WebTransport` connect fails after ~14 days | Running on a self-signed certificate; browsers cap hashed certs at 14 days |
| Requests blocked as mixed content | `backendUrl` in the release is `http://` |
