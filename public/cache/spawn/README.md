# Spawn corridor tile packs

Cold-boot packs hydrated into IndexedDB before the first terrain request.

Generate (or regenerate after terrain/veg cache version bumps):

```bash
npm run bake:spawn-tiles
# optional: npm run bake:spawn-tiles -- asteron 650
```

Output:
- `<planetId>-<TERRAIN_CACHE_VERSION>.json` (manifest)
- `<planetId>-<TERRAIN_CACHE_VERSION>.bin` (terrain buffers)

Play boot fetches the manifest + bin and seeds IndexedDB. Vegetation is warmed at runtime (prefetch), not packed. A missing or version-mismatched pack is skipped (streaming still works).
