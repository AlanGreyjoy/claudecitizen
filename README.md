# ClaudeCitizen

![ClaudeCitizen banner](src/assets/images/banner-with-logo.png)

![ClaudeCitizen gameplay screenshot](docs/static/img/screenshot.png)

[![Buy me a coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=alangreyjoy&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/alangreyjoy)

> [!NOTE]
> This is a passion project — if you'd like to show your support, every donation goes straight to feeding the **Claude Fable 5** beast that keeps this thing going.

A space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. Content is authored in **AsteronEngine**, a Unity-style Electron editor built on TypeScript and Three.js, and shipped to the browser through **File → Build Web**. Online play uses one authoritative Rust backend with native Rapier, shared Rust/WASM prediction, Protobuf over WebTransport, PostgreSQL/SQLx, and Redis.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec. I'm a Staff Software Engineer and Solutions Architect with 17+ years of experience; this is a passion sandbox, not a production product.

**Work in progress.** Phase 1 is third-person weapons and over-the-shoulder character-controller updates.

## Quick start

```bash
npm install
npm run editor:dev
```

There are exactly two surfaces: the **AsteronEngine editor** and the **Rust
backend**. Everything else — the shipped game included — is produced by the
editor.

Cold start opens the **Projects** hub. Create or open a project, and the editor
workspace loads that project's scenes, prefabs, planets, and assets.

## AsteronEngine editor

```bash
# Launch with Vite HMR / React Fast Refresh (day-to-day)
npm run editor:dev

# Production-like: build dist-editor, then launch Electron
npm run editor

# Create an unpacked editor under release/editor/
npm run build:editor:desktop

# Create the current platform's editor distributable
npm run editor:desktop:package
```

Skip the Projects hub with `--project-root=/path/to/project` or
`CLAUDECITIZEN_EDITOR_PROJECT_ROOT`.

**Scenes own their content.** A scene document (`src/world/scenes/data/*.scene.json`)
is a GameObject tree; components on those objects decide what the scene is:

| Component | Role |
|-----------|------|
| `game-manager` | System, planet, and spawn mode |
| `planet` | Planet document reference |
| `player-start` | Spawn pose and mode |
| `prefab-instance` | Places a reusable prefab |
| `ui-screen` | Mounts title / login / character-create / loading UI |
| `scene-link` | Transition target for menu flow |
| `instanced-scene` | Marks per-player content such as habs and hangars |

**Play / Pause / Stop** run the open document in the Game view, unsaved edits
included — F6 plays and stops, F7 pauses. Right-click a GameObject and choose
**Create Prefab from Selection** to extract it into a prefab and leave a
`prefab-instance` behind.

The **Server** tab is the operator console for the deployed backend: player
records, catalog definitions (ships, props, items, weapons, backpacks,
wearables), and game settings, all live against PostgreSQL.

## Shipping the game

**File → Build Web** writes the release into the project's build output
directory and stamps `asteron.runtime.json` beside it with the backend URL and
boot scene from **File → Project Settings…**. The same bundle can target any
deployment by re-stamping that file. Players sign in with their own accounts, so
no key is shipped to the client.

## Documentation

Full docs — editor guide, controls, roadmap, planet tech, deployment, and engineering notes:

- **Online:** [https://claudecitizen-docs.netlify.app/](https://claudecitizen-docs.netlify.app/)
- **Local:** `npm run docs:dev` → [http://localhost:3000](http://localhost:3000)

## License

IDK. Whatever.
