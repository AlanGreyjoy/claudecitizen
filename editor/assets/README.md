# Editor Assets

Drop editor-importable assets under this folder.

- `free/` is for assets you are allowed to use locally.
- `protected/` is for paid or otherwise non-redistributable packs.

The editor serves files from `/editor/assets/...` in development. Production builds copy only files referenced by saved prefab JSON, including GLTF sidecar `.bin` and texture files.

Asset files in this tree are ignored by git by default; keep only these notes tracked.
