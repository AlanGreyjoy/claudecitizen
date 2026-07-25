# Phase 01 — UI Schema

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** —
**Unlocks:** [02 — Hierarchy Create → UI](./02-hierarchy-create-ui.md), [03 — Inspector fields](./03-inspector-fields.md)

## Objective

Add the six Authored UI component types (`ui-canvas`, `ui-rect`, `ui-panel`, `ui-text`, `ui-image`, `ui-button`) to the prefab/scene component schema with validators, registry defaults, and full serialize round-trip, so widget GameObjects can exist in scene documents. No editor UI, no rendering — data layer only.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/prefabs/schema.ts` | **Extend** — six new component type interfaces in the `PrefabComponent` union + validators beside `ui-screen` |
| `src/world/prefabs/component-registry.ts` | **Extend** — registry entries with labels + `createDefault`; `scenes: true`, `kinds: []` (mirror `ui-screen`) |
| `src/editor/serialize.ts` | **Verify / Extend** — widget components round-trip editor ⇄ JSON (generic component path should already carry them; confirm no allowlist filters them out) |
| `src/world/scenes/schema.ts` | **Verify** — scene documents accept the new components through the shared component validation (no change expected) |

## Tasks

### Schema types

- [ ] Add the six component interfaces to `src/world/prefabs/schema.ts` using the field lists locked in PRD §8:
  - `ui-canvas`: `referenceWidth` (default 1920), `referenceHeight` (default 1080)
  - `ui-rect`: `anchorMin`, `anchorMax`, `pivot` (normalized `{x, y}`), `offsetMin`, `offsetMax` (design-space px)
  - `ui-panel`: `backgroundColor` (CSS color string), optional `borderRadius`
  - `ui-text`: `text`, `fontSize`, `color`, `align: "left" | "center" | "right"`
  - `ui-image`: `src` (project asset path), `fit: "stretch" | "contain" | "cover"`
  - `ui-button`: `label`, `action: "none" | "scene-link" | "close"`, optional `sceneId`
- [ ] Write validators following the existing per-type validation pattern in `schema.ts` (numbers finite, anchors/pivot clamped 0..1, enums exact, `sceneId` required when `action === "scene-link"`).
- [ ] Export a `UI_WIDGET_COMPONENT_TYPES` const array (`ui-canvas`, `ui-panel`, `ui-text`, `ui-image`, `ui-button` — layout comp `ui-rect` listed separately) for phase 02's menu builder and phase 05's mount walk.

### Registry

- [ ] Add entries in `component-registry.ts` with labels **Canvas**, **Rect**, **Panel**, **Text**, **Image**, **Button** (UI group), `scenes: true`, `kinds: []`, and `createDefault` producing the PRD defaults.
- [ ] `ui-canvas` is **not** singleton (multiple canvases per scene allowed); none of the widget types are markers.

### Round-trip

- [ ] Confirm `src/editor/serialize.ts` carries the new components on entities unchanged both directions; extend if any component-type switch exists.
- [ ] Manually author a scratch scene JSON with a canvas + one of each widget; load in editor, save, diff — byte-stable field order per existing serialize behavior.

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean for touched files.

## Acceptance criteria

- [ ] A scene document containing all six component types validates and loads without warnings.
- [ ] Registry palette (Inspector Add component…, scene documents only) lists the new types with working defaults.
- [ ] Save → reload round-trip preserves every field.
- [ ] typecheck + lint clean.

## Out of scope

- Hierarchy UI submenu (phase 02) — components are palette-addable only after this phase.
- Custom Inspector field editors (phase 03) — default/JSON editing acceptable meanwhile.
- Any DOM rendering, preview, or runtime mount (phases 04–05).
- `ui-screen: "authored"` extension (phase 05).
- Prefab-kind availability (`kinds` stays `[]`).

## Implementation notes

- Mirror `ui-screen` / `scene-link` exactly for registry flags — those are the two existing scene-only components (`src/world/prefabs/component-registry.ts` around the `ui-screen` entry).
- Keep types + validators pure: `world/prefabs/` must not import DOM or Three.js (AGENTS.md import rules).
- `ui-image.src` follows the same project-asset-path convention as audio/GLB component fields (path string relative to project asset roots) — do not invent a new asset reference shape.
- `ui-rect` on the canvas root is still meaningful (offsets inside the viewport-fitted reference rect); default it to full-stretch (`anchorMin 0,0`, `anchorMax 1,1`, zero offsets).
