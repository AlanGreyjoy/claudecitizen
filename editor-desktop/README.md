# AsteronEngine desktop app

AsteronEngine runs as a dedicated Electron application. It shares the existing
React and Three.js editor frontend while keeping filesystem access in Electron's
main process.

## Launch

Build the editor frontend and launch Electron:

```bash
npm run editor
```

Cold start opens the **Projects** window first. Create a new project, open an
existing AsteronEngine / ClaudeCitizen project folder, or reopen a recent
project. The editor workspace opens only after a project is selected.

No development server is required. Electron's private `cceditor:` protocol
serves the editor, project assets, and the constrained document API.

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
API and serves project assets from `editor/assets`, `src/assets`, and
`public/assets/protected`.

## Unity-style workflow

- Scene documents live in `src/world/scenes/data/*.scene.json`.
- Prefabs remain reusable entity trees under `src/world/prefabs/data/`.
- **Play** / `F6` saves the active document and opens it in a separate Play
  Mode window. Press it again to stop.
- **File → Build Web** / `Ctrl+B` saves the active document and runs the
  release web build into `dist/` (requires a full engine checkout with npm
  scripts).
- Scene runtime adapters currently cover title, loading, character creation,
  main game, prefab/instance stages, and the Sidekick test stage.

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
