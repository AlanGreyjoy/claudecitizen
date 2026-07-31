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

On macOS, both launch scripts run `brand_dev_electron.mjs` first so the
unpackaged Electron.app's `CFBundleName` is AsteronEngine (menu bar /
Cmd+Tab). `app.setName()` alone cannot change those OS labels. Fully quit
Electron before relaunching after a fresh install.

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
API and serves project assets from the open project's `assets/` tree.

## Unity-style workflow

- Scene documents live in `src/world/scenes/data/*.scene.json` and are GameObject
  trees. Components (`game-manager`, `planet`, `player-start`,
  `prefab-instance`, `ui-screen`, `scene-link`, `instanced-scene`) decide what a
  scene does.
- Prefabs are reusable entity trees saved as `*.prefab.json` in any folder under
  the project's `assets/` library. Drag a GameObject from the Hierarchy onto a
  Project folder — or right-click it → **Create Prefab from Selection** — to
  extract one. Identity is the document `id`, not the path, so moving a prefab
  file breaks no references.
- **Play** / `F6` runs the open document — unsaved edits included — in the Game
  view. `F7` pauses and resumes; `F6` again stops and restores the editor.
- **File → Project Settings…** edits `asteron.project.json`: backend URL, boot
  scene, and build output directory.
- **File → Build Web** / `Ctrl+B` runs the release web build and writes
  `asteron.runtime.json` beside it so the bundle knows which backend to call.
- **Tools → Packages…** installs engine-managed tools (KTX-Software) under
  `~/.asteron/tools/`. **Tools → Transcode Project Textures…** writes KTX2
  twins to `<project>/.asteron/derived/` for smaller GPU memory at Play / ship.
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

A valid project has `package.json` and an `assets/` folder.

Use **File → Open Project…** to leave the editor and return to the Projects
hub.

## AsteronEngine MCP (agent bridge)

Cursor (and other MCP clients) can query the **live** editor — open project,
selection, hierarchy, play state — not only on-disk files.

1. Install MCP deps once: `npm install --prefix tools/asteron-mcp`
2. Start AsteronEngine (`npm run editor:dev` or `npm run editor`) and open a project
3. Project MCP config lives at [`.cursor/mcp.json`](../.cursor/mcp.json) (`asteron-engine`,
`type: "stdio"`). After adding/changing it: **Cursor Settings → MCP** (or
**Customize → MCP**), enable `asteron-engine`, then reload if it stays grey.
Check **Output → MCP Logs** if it fails to start.

**Claude Code:** repo-root [`.mcp.json`](../.mcp.json) (same server). Path arg must
use `${CLAUDE_PROJECT_DIR:-.}` — bare `${CLAUDE_PROJECT_DIR}` is unset at config
parse time and breaks connect. Approve when prompted, or
`claude mcp reset-project-choices` if previously rejected. Verify with
`claude mcp list`.

When the app starts, Electron writes `~/.asteron/agent.json` (`port`, `token`,
`pid`) and serves a loopback HTTP API on `127.0.0.1`. The stdio MCP at
`tools/asteron-mcp` reads that file and calls `/agent/v1/*`.

Useful tools: `session`, `open_document`, `hierarchy`, `selection`, `entity`,
`play_state`, `capture_viewport`, `list_scenes` / `list_prefabs`, `get_scene` /
`get_prefab`, plus safe commands `play` / `stop_play` / `save` /
`select_entity` / `open_document_by_id`.

`capture_viewport` screenshots the active 3D view (Scene/Ship viewport while
editing, Play host while playing) via Electron `capturePage` and returns JPEG
image content to the MCP client.

If the editor is not running, tools return `editor_unavailable` (they do not hang).

## Security boundary

- Renderer sandboxing and context isolation remain enabled.
- Renderer-side Node.js integration is disabled.
- The webview cannot provide arbitrary filesystem paths.
- Editor document identifiers are validated before reads and writes.
- Asset requests are constrained to explicit project-owned roots.
- Backend calls are proxied through the main process at `/__editor/backend/*`
  and are pinned to the configured `backendUrl`. Session cookies live in the
  main-process jar, never in the renderer origin.
- The agent HTTP API binds `127.0.0.1` only and requires the bearer token from
  `~/.asteron/agent.json`.
