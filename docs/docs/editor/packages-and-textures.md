---
sidebar_position: 13
title: Packages and textures
description: Tools → Packages for KTX-Software, and Tools → Transcode for KTX2 derived assets.
---

# Packages and textures

Synty and other GLBs often embed large PNG atlases. AsteronEngine can write
non-destructive **KTX2 (Basis)** twins under `<project>/.asteron/derived/` so
Play and **File → Build Web** load the compressed textures instead of the
source atlases.

## Tools → Packages…

Opens the engine **Packages** dialog. The first package is **KTX-Software**
(pinned release) — the `ktx` CLI that encodes those twins.

| Action | What it does |
| --- | --- |
| **Install** / **Update** | Downloads the platform build from the Khronos release, verifies SHA1, extracts under `~/.asteron/tools/ktx/<version>/` |
| **Uninstall** | Removes the managed install and clears `~/.asteron/tools/manifest.json` |
| **Releases** | Opens the upstream GitHub releases page |

No sudo and no system package manager. The binary is engine-managed, not
installed into `/usr/local`.

### How `ktx` is resolved

Order used by the editor and by `npm run transcode:textures`:

1. `ASTERON_KTX` — absolute path to the `ktx` binary
2. Managed install at `~/.asteron/tools/ktx/<pinnedVersion>/bin/ktx` (`.exe` on Windows)
3. Bare `ktx` on `PATH`

## Tools → Transcode Project Textures…

Opens a dialog with live status and log. Runs the project transcoder (same as
`npm run transcode:textures -- --project <dir>`). On success the twins land in
`<project>/.asteron/derived/` mirroring asset relative paths.

**Bake first, then transcode.** Scripts such as `scripts/bake_*.py` read the
embedded PNG/JPEG payloads in the source GLBs. Derived twins never replace
those sources.

## Build Web and derived assets

**File → Build Web** does **not** run the transcoder. If
`<project>/.asteron/derived/` exists, the build stages those twins so the
release prefers them. If it is missing, the build still succeeds and ships
uncompressed textures (with a console warning).

Prefer KTX2 for shipping large scenes: install via **Packages…**, transcode,
then build.

## CLI

```bash
# After Tools → Packages… (or with ktx on PATH / ASTERON_KTX set):
npm run transcode:textures -- --project /path/to/project
```

Useful flags: `--force`, `--only <substring>`, `--dry-run`, `--clean`,
`--verify`.

## Related

- [Assets and GLB](./assets-and-glb)
- [Build Web](./build-web)
- [Assets](/assets)
