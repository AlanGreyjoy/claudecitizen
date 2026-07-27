---
sidebar_position: 14
title: Build Web
description: Release browser builds, asteron.runtime.json, and protected-asset copying.
---

# Build Web

**File → Build Web** (`Ctrl+B`) produces the browser release. The web game is a
**build target**, not a day-to-day development surface.

## What it does

1. Saves the active document.
2. Builds the game runtime (`index.html` → `src/game-main.ts`) into the project's
   configured output directory (`build.outDir` in **Project Settings…**).
3. Writes `asteron.runtime.json` beside the output with:
   - backend URL
   - boot scene
4. Copies only assets that saved prefab JSON actually references — unreferenced
   protected library files stay out of the deploy.

Serve that directory from any static host. Re-stamp `asteron.runtime.json` to
point the same bundle at a different backend without rebuilding.

## Runtime config

| Context | Backend URL source |
| --- | --- |
| Editor | Project Settings → `asteron.project.json` |
| Shipped web | `asteron.runtime.json` next to the build |

There is no `VITE_API_BASE_URL`. Players sign in with cookie sessions; operators
use the Server tab admin session.

## What ships

Everything in the output directory is publicly downloadable. Keep proprietary
packs under the project's `assets/protected/` and only reference files that are
allowed to ship. See [Assets](/assets).

## Related

- [Projects and settings](./projects-and-settings)
- [Preview and playtest](./preview-and-playtest)
- [Quick start](/quick-start#shipping-the-game)
