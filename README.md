# ClaudeCitizen

![ClaudeCitizen banner](src/assets/images/banner-with-logo.png)

![ClaudeCitizen gameplay screenshot](docs/static/img/screenshot.png)

[![Buy me a coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=alangreyjoy&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/alangreyjoy)

> [!NOTE]
> This is a passion project — if you'd like to show your support, every donation goes straight to feeding the **Claude Fable 5** beast that keeps this thing going.

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. The client uses TypeScript, Vite, and Three.js; online play uses one authoritative Rust backend with native Rapier, shared Rust/WASM prediction, Protobuf over WebTransport, PostgreSQL/SQLx, Redis, and Kubernetes.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec. I'm a Staff Software Engineer and Solutions Architect with 17+ years of experience; this is a passion sandbox, not a production product.

**Work in progress.** Phase 1 is third-person weapons and over-the-shoulder character-controller updates.

## Live play test

**[https://claudecitizen.netlify.app/](https://claudecitizen.netlify.app/)**

## Quick start

```bash
npm install
npm run editor
```

The Electron editor is the project workspace. Open or create scenes and
prefabs, use the universal **Play** button to test the active document, and use
**File → Build Web** when the game is ready for a browser release.

## Desktop app

Electron packages the same production web client as a native desktop app. The browser and
Netlify targets remain unchanged.

```bash
# Build the web client and launch it in Electron
npm run desktop

# Connect Electron to the already-running Vite server on port 4173
npm run desktop:dev

# Create an unpacked, Steam-depot-friendly app under release/desktop/
npm run build:desktop

# Create the current platform's distributable archive/package
npm run desktop:package
```

The unpacked output from `build:desktop` is the intended starting point for a Steam depot.
Steamworks integration will live in Electron's main process and cross the isolated preload
bridge; renderer-side Node.js access remains disabled.

## Editor desktop app

The ClaudeCitizen Editor is a standalone Electron application with a
constrained local project API. It does not require a Vite development server.

```bash
# Build the editor frontend and launch the Electron editor
npm run editor

# Create an unpacked editor under release/editor/
npm run build:editor:desktop

# Create the current platform's editor distributable
npm run editor:desktop:package
```

Packaged builds prompt for a ClaudeCitizen repository and remember the selected project.
The project can also be supplied with
`--project-root=/path/to/claudecitizen` or
`CLAUDECITIZEN_EDITOR_PROJECT_ROOT`.

Scene assets live under `src/world/scenes/data/`. The initial runtime adapters
cover title, loading, character creation, main-game, prefab/instance stages,
and character test scenes. The Play button launches the active scene in a
separate Electron Play Mode window; **File → Build Web** writes the release to
`dist/`.

## Documentation

Full docs — editor guide, controls, roadmap, planet tech, deployment, and engineering notes:

- **Online:** [https://claudecitizen-docs.netlify.app/](https://claudecitizen-docs.netlify.app/)
- **Local:** `npm run docs:dev` → [http://localhost:3000](http://localhost:3000)

## License

IDK. Whatever.
