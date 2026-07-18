# Phase 04 — Planet Authoring Spawn Catalog UX

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 01 (02–03 recommended so Preview Planet matches new runtime)  
**Unlocks:** Author-friendly 50-entry workflows

## Objective

Evolve the Planet Authoring **Spawning** section into a **Spawn Catalog** editor: shared sample/density knobs, per-entry weights, soft performance warnings, and docs — without requiring authors to understand InstancedMesh batching.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/editor/panels/planet_authoring.ts` | **Extend** — catalog UI (settings + entries) |
| `src/editor/styles.ts` | **Extend** — catalog warning / weight field styles if needed |
| `src/world/planets/schema.ts` | **Ensure** save writes catalog object shape |
| `docs/docs/cc-editor/planet-authoring.md` | **Update** — Spawn Catalog authoring + performance guidance |
| `docs/docs/roadmap.md` | **Optional** — note surface prop catalog capability |

## Tasks

### Catalog settings

- [ ] Expose `samplesPerTile` and catalog `density` as number fields at the top of the Spawning section.
- [ ] Short helper text: samples are shared across entries; weights compete among acceptors.

### Entry list

- [ ] Keep add / remove / enabled / name / asset DnD / biomes / height / gap / scales / align / collider.
- [ ] Add **weight** field (default 1).
- [ ] Show `seedOffset` (read/write) or keep advanced/hidden — pick one; if hidden, preserve on save.
- [ ] Migrate UI state to `doc.spawning` catalog object (not raw array).
- [ ] Soft warning banner when `entries.length > 50` or when many entries are enabled.
- [ ] Soft warning when a dropped/selected asset URL is known (from last preview) to have high part counts — best-effort; console warning from runtime is acceptable fallback.

### Save / preview

- [ ] Save persists catalog shape through existing planet API.
- [ ] Preview Planet continues to pick up spawning via play_session / renderer setCatalog path from phases 02–03.
- [ ] Dirty / leave guards unchanged in spirit.

### Docs

- [ ] Update `planet-authoring.md`: catalog vs old layers, weights, samplesPerTile, “prefer reusing GLBs”, Preview Planet for FPS, note ~50 entry target with budgets.
- [ ] Mention box/capsule only; no trimesh.

## Acceptance criteria

- [ ] Author can create/edit a multi-entry catalog and save/reload without losing weights or samplesPerTile.
- [ ] Soft warning appears for oversized catalogs (>50 entries).
- [ ] Docs match the shipped UI terminology (**Spawn Catalog** / **Spawning**).
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Live heightfield preview of all props in the authoring viewport.
- Asset library browser beyond existing Project DnD.
- Worker/disk cache UI.

## Implementation notes

- Mirror existing spawn layer card UI; avoid a dashboard redesign.
- When reading legacy docs that still say “spawn layer”, update to “catalog entry”.
- Do not start `npm run dev` in the implementation chat unless the user asks; author owns interactive QA.
