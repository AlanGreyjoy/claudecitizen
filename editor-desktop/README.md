# AsteronEngine desktop app

AsteronEngine runs as a dedicated Electron application. It shares the existing
React and Three.js editor frontend while keeping filesystem access in Electron's
main process.

## Launch

Production-like launch (full Vite build, then Electron):

```bash
npm run editor
```

Day-to-day authoring with Vite HMR / React Fast Refresh:

```bash
npm run editor:dev
```

`editor:dev` starts Electron with `--dev`, which spawns Vite and proxies
`/__editor` plus project asset mounts through the main process. Use plain
`editor` when you want to exercise the packaged `dist-editor` path.

Cold start opens the **Projects** window first. Create a new project, open an
existing AsteronEngine / ClaudeCitizen project folder, or reopen a recent
project. The editor workspace opens only after a project is selected.

Packaged builds use Electron's private `cceditor:` protocol for the editor,
project assets, and the constrained document API. Dev mode loads the renderer
from Vite instead while keeping those APIs on the Electron bridge.

## Editor package

Build the editor frontend and launch the production desktop shell:

```bash
npm run editor
```

Create an unpacked application under `release/editor/`:

```bash
npm run build:editor:desktop
```

Create the current platform's distributable:

```bash
npm run editor:desktop:package
```

The production shell serves `dist-editor/` through the private `cceditor:`
protocol. The same protocol provides the constrained `/__editor` persistence
API and serves project assets from the open project's `assets/` and
`src/assets/` trees.

## Unity-style workflow

- Scene documents live in `src/world/scenes/data/*.scene.json` and are GameObject
  trees. Components (`game-manager`, `planet`, `player-start`,
  `prefab-instance`, `ui-screen`, `scene-link`, `instanced-scene`) decide what a
  scene does.
- Prefabs remain reusable entity trees under `src/world/prefabs/data/`.
  Right-click a GameObject → **Create Prefab from Selection** to extract one.
- **Play** / `F6` runs the open document — unsaved edits included — in the Game
  view. `F7` pauses and resumes; `F6` again stops and restores the editor.
- **File → Project Settings…** edits `asteron.project.json`: backend URL, boot
  scene, and build output directory.
- **File → Build Web** / `Ctrl+B` runs the release web build and writes
  `asteron.runtime.json` beside it so the bundle knows which backend to call.
- The **Server** tab is a live operator console over the backend's `/admin/*`
  routes for players, catalog definitions, and game settings.

## Project root

The app does **not** auto-bind the git repository on launch. Use the Projects
hub to open a folder, or skip the hub for automation:

```bash
electron editor-desktop --project-root=/path/to/project
# or
CLAUDECITIZEN_EDITOR_PROJECT_ROOT=/path/to/project npm run editor
```

A valid project has `package.json` and `src/world/prefabs/data/`.

Use **File → Open Project…** to leave the editor and return to the Projects
hub.

## Security boundary

- Renderer sandboxing and context isolation remain enabled.
- Renderer-side Node.js integration is disabled.
- The webview cannot provide arbitrary filesystem paths.
- Editor document identifiers are validated before reads and writes.
- Asset requests are constrained to explicit project-owned roots.
- Backend calls are proxied through the main process at `/__editor/backend/*`
  and are pinned to the configured `backendUrl`. Session cookies live in the
  main-process jar, never in the renderer origin.
