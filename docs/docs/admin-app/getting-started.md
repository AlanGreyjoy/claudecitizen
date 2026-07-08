---
sidebar_position: 2
title: Getting started
description: Run the Admin App locally and open the operator console.
---

# Getting started

The Admin App is a deep-link boot mode on the same Vite client as the game. It talks to the Nest.js API on port 3000.

## Prerequisites

1. **Node.js 20+** and `npm install` at the repo root
2. **PostgreSQL and Redis** — start local infra:

   ```bash
   npm run dev:infra
   ```

3. **Database schema** — apply migrations if you have not already:

   ```bash
   npm run prisma:deploy
   ```

4. **Nest.js API server**:

   ```bash
   npm run dev:server
   ```

5. **Vite game client**:

   ```bash
   npm run dev
   ```

6. **Admin credentials** — copy `server/.env.example` to `server/.env` and set at minimum:

   ```env
   ADMIN_EMAIL=admin@claude-citizen.com
   ADMIN_PASSWORD=k33p3m0ut
   ADMIN_SESSION_SECRET=dev-admin-secret-change-me
   ```

   See [Authentication](./authentication) for what each variable does.

## Open the Admin App

Navigate to:

```text
http://localhost:4173/?boot=admin
```

There is no Admin button on the title screen today — you must use the `?boot=admin` query parameter (same pattern as `?boot=editor` for the prefab editor).

On load, the client checks for an existing `cc_admin` session cookie. If none is valid, you see the login form. Sign in with the email and password from your server `.env`.

## API base URL

By default the client calls `http://localhost:3000`. To point at a different API host, set `VITE_API_BASE_URL` in a root `.env` file before starting Vite:

```env
VITE_API_BASE_URL=http://localhost:3000
```

The Admin App uses `credentials: 'include'` on every request so the `cc_admin` cookie is sent automatically.

## Sidebar navigation

After login you get a fixed sidebar with five sections:

| Tab | Purpose |
| --- | --- |
| **Users** | Inspect registered accounts |
| **Ships** | Manage ship definitions |
| **Props** | Manage prop (decoration) definitions |
| **Items** | Manage item definitions |
| **Game Settings** | Starting ARC and starter loadouts |

Each catalog section supports search filtering on its list view. Click a row to open the edit form, or use **Create** to add a new definition.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Login fails immediately | `ADMIN_PASSWORD` not set in `server/.env`, or email/password mismatch |
| Network errors on every action | API server not running, or `VITE_API_BASE_URL` points at the wrong host |
| CORS / cookie issues | `CLIENT_ORIGIN` in server `.env` must match the Vite origin (`http://localhost:4173`) |
| Empty catalogs | Fresh database — create definitions in Ships/Props/Items, then configure Game Settings |

## Production note

The `?boot=admin` route ships in production client builds. Protect it in deployed environments with strong `ADMIN_PASSWORD` values, HTTPS (`COOKIE_SECURE=true`), and network-level access controls. The Admin App is an operator tool, not a player-facing feature.
