---
sidebar_position: 5
title: Deployment
description: Run the Rust backend and ship the web build.
---

# Deployment

ClaudeCitizen deploys as **two pieces**: the Rust backend (API + cell authority)
and a static web build from **File → Build Web**.

## Backend

### Local

```bash
npm run dev:infra      # Postgres, Redis, Mailpit
cp backend/.env.example backend/.env   # fill secrets
npm run backend:migrate
npm run start:server   # or npm run dev:server for watch rebuild
```

### Environment

Copy `backend/.env.example`. Minimum production concerns:

| Variable | Role |
| --- | --- |
| `HTTP_BIND` | Axum listen address (default `0.0.0.0:3000`) |
| `CLIENT_ORIGIN` | Allowed browser origin for CORS / cookies |
| `API_PUBLIC_URL` | Public HTTP base URL |
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Redis |
| `RUN_MIGRATIONS` | Apply SQLx migrations on boot when `true` |
| `JWT_*` / `ADMIN_*` | Auth secrets — use long random values in production |
| `WEBTRANSPORT_BIND` | QUIC listen (default `0.0.0.0:4433`) |
| `WEBTRANSPORT_PUBLIC_URL` | Public WebTransport URL clients dial |
| `WEBTRANSPORT_CERT_PATH` / `KEY_PATH` | Trusted PEM in production; self-signed ok for local |

UDP **4433** (or your chosen WebTransport port) must reach the host. TCP **3000**
serves HTTP APIs and health endpoints.

### Health

| Path | Purpose |
| --- | --- |
| `/livez` | Process alive |
| `/readyz` | Ready for traffic |
| `/metrics` | Metrics scrape |

### Container

`backend/Dockerfile` builds one server image. Run it with Docker Compose
alongside Postgres and Redis, or point it at managed databases.

## Web release

1. In AsteronEngine: **File → Project Settings…** — set backend URL, boot scene, output dir.
2. **File → Build Web**.
3. Deploy the output directory to any static host.
4. Re-stamp `asteron.runtime.json` to retarget backends without rebuilding.

Editor → backend traffic during authoring uses `/__editor/backend/*` (Electron
proxy). Shipped browsers talk to `CLIENT_ORIGIN`-allowed APIs directly with
cookie sessions.

## Related

- [Stack](./stack)
- [Realtime](./realtime)
- [Build Web](/editor/build-web)
- [Server console](/server-console)
