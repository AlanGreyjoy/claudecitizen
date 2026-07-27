---
sidebar_position: 3
title: Projects and settings
description: Projects hub, valid project shape, asteron.project.json, and the editor backend proxy.
---

# Projects and settings

Cold start opens the **AsteronEngine — Projects** hub. Create or open a project
before the editor workspace loads.

## Valid project

A folder is a project when it has:

| Required | Role |
| --- | --- |
| `package.json` | Marks the project root |
| `assets/` | Single authoring asset library (served at `/assets/`) |

New Project also scaffolds `asteron.project.json`, a starter prefab, and the usual
`assets/` folders (`Prefabs/`, `animations/`, `free/`, `protected/`, …).

Skip the hub with `--project-root=/path/to/project` or
`CLAUDECITIZEN_EDITOR_PROJECT_ROOT`.

## Project settings

**File → Project Settings…** edits `asteron.project.json` at the project root:

| Field | Meaning |
| --- | --- |
| **Name** | Display name in the hub and window title |
| **Backend URL** | Rust API the Server tab and runtime talk to |
| **Default / boot scene** | Scene id written into release `asteron.runtime.json` |
| **Build output** | Directory **File → Build Web** writes into |

The backend URL is resolved at **runtime** (`src/net/runtime-config.ts`) — from
project settings in the editor, from `asteron.runtime.json` in a shipped release.
There is no build-time `VITE_API_BASE_URL` and no client API key.

## Where content lives

| Content | Location |
| --- | --- |
| Prefabs, GLBs, SFX, protected packs | `<project>/assets/` |
| Scenes | `<project>/src/world/scenes/data/<id>.scene.json` |
| Planets / systems | Project planet and system documents (editor API) |
| Engine-owned art | Engine checkout `src/assets/` — ESM imports only, not Project panel |

Prefab identity is the document `id`, never the file path. Moving a
`*.prefab.json` under `assets/` is safe.

## Editor → backend proxy

The renderer origin is `cceditor://app`. It cannot pass the backend's single-origin
CORS check or hold session cookies. Editor calls go through
`/__editor/backend/*`, proxied by the Electron main process with `net.fetch`.

Do not call the Rust API directly from the editor renderer.

## Related

- [Getting started](./getting-started)
- [Build Web](./build-web)
- [Server console](/server-console)
- [Assets](/assets)
