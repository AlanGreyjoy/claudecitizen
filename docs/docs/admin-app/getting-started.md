---
sidebar_position: 2
title: Getting started
description: Open the Server console inside the AsteronEngine editor.
---

# Getting started

The operator console is the **Server** tab in the AsteronEngine editor. It is a
live CRUD client over the Rust API's `/admin/*` routes — catalog definitions,
player records, and game settings all live in PostgreSQL, not in project files.

## Prerequisites

1. **Node.js 20+**, **Rust 1.96**, and `npm install` at the repo root
2. **PostgreSQL and Redis** — start local infra:

   ```bash
   npm run dev:infra
   ```

3. **Database schema** — apply migrations if you have not already:

   ```bash
   npm run backend:migrate
   ```

4. **Rust API and authoritative cell server**:

   ```bash
   npm run start:server
   ```

5. **Operator credentials** — copy `backend/.env.example` to `backend/.env` and
   set at minimum:

   ```env
   ADMIN_EMAIL=admin@claude-citizen.com
   ADMIN_PASSWORD=k33p3m0ut
   ADMIN_SESSION_SECRET=dev-admin-secret-change-me
   ```

   See [Authentication](./authentication) for what each variable does.

## Open the Server console

```bash
npm run editor
```

Open a project from the Projects hub, then select the **Server** tab. On entry
the console checks for an existing `cc_admin` session; if none is valid you get
the login form. Sign in with the email and password from `backend/.env`.

## Backend URL

The console calls whichever backend the project points at. Set it in
**File → Project Settings…**:

| Field | Meaning |
| --- | --- |
| **Backend URL** | Deployed Rust API this project talks to |
| **Boot Scene** | Scene the game loads on start |
| **Build Output** | Directory File → Build Web writes into |

That value is stored in `asteron.project.json` and stamped into
`asteron.runtime.json` when you build the web release, so the same bundle can
target any deployment.

Requests from the editor are forwarded by the Electron main process through
`/__editor/backend/*`. This is required: the renderer runs on the
`cceditor://app` origin, which the backend's single-origin CORS policy rejects
and which cannot hold the `cc_admin` cookie. The main-process session owns that
cookie instead. No CORS configuration is needed for the editor.

## Sidebar navigation

After login the console has three groups:

| Group | Tabs |
| --- | --- |
| **Intelligence** | Users |
| **Catalog** | Ships, Props, Items, Weapons, Backpacks, Wearables |
| **Systems** | Game Settings |

Each catalog section supports search filtering on its list view. Click a row to
open the edit form, or use **Create** to add a new definition.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Login fails immediately | `ADMIN_PASSWORD` not set in `backend/.env`, or email/password mismatch |
| Network errors on every action | API server not running, or **Backend URL** in Project Settings points at the wrong host |
| `No AsteronEngine project is open` | The Server tab needs a project open so it can read the backend URL |
| Empty catalogs | Fresh database — create definitions in Ships/Props/Items, then configure Game Settings |

## Production note

The Server console only exists in the editor; it is never part of a shipped web
release. Still protect deployed environments with strong `ADMIN_PASSWORD`
values, HTTPS (`COOKIE_SECURE=true`), and network-level access controls.
