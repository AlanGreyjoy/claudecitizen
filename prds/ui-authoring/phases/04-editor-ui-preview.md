# Phase 04 — Editor UI Preview

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** [01](./01-ui-schema.md), [02](./02-hierarchy-create-ui.md), [03](./03-inspector-fields.md)
**Unlocks:** [05 — Runtime mount](./05-runtime-mount.md)

## Objective

Render a live DOM preview of the selected canvas tree inside the editor, without entering Play. This phase also owns the **single shared rect→CSS layout resolver** that phase 05 reuses for the runtime mount — layout math is implemented exactly once.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/ui/authored-ui-dom.ts` | **Add** — pure DOM builder: `buildCanvasDom(entities, canvasId, resolveAsset)` returns a detached element tree; owns rect→CSS resolution and per-widget element construction |
| `src/editor/react/panels/UiCanvasPreview.tsx` | **Add** — React host: mounts/replaces the built DOM in a scaled container; subscribes to store events |
| `src/editor/react/EditorApp.tsx` | **Wire** — show the preview host over/beside the Game region when the selection is inside a canvas tree |

## Tasks

### Shared DOM builder (`src/ui/authored-ui-dom.ts`)

- [ ] Rect resolver: `ui-rect` (anchors, pivot, offsets) → absolute-positioned CSS (`left/top/width/height` or inset form) inside the parent element; document the formula in code.
- [ ] Element builders per widget: panel → `div` with background/border-radius; text → `div` with content/font/color/align; image → `img` (via asset resolver callback) with object-fit; button → `button` with label; canvas → root `div` at `referenceWidth × referenceHeight`.
- [ ] Canvas scaling: uniform scale-to-fit with letterboxing (locked here per PRD §13) — root gets `transform: scale(k)` computed from the host size.
- [ ] Module stays DOM-pure: no store, no React, no Three.js imports. Asset paths resolve through a passed-in callback (editor uses `cceditor:`-served URLs; runtime uses its own resolution in phase 05).
- [ ] Buttons take an optional activation callback; the editor preview passes none (inert).

### Editor host (`UiCanvasPreview.tsx`)

- [ ] When selection (or its ancestor chain) contains a `ui-canvas`, mount the preview showing that canvas; otherwise render nothing (zero cost — no subscriptions when hidden).
- [ ] Rebuild the DOM on store `structure` / `component` events affecting the previewed canvas subtree — full rebuild is fine at v1 widget counts; never rebuild on unrelated events or per frame.
- [ ] Preview placement: overlay panel in the Game region with a small header (canvas name + reference resolution + close button). Keep it out of the Three.js render loop entirely.

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean for touched files.

## Acceptance criteria

- [ ] Selecting a widget shows its canvas rendered at correct proportions; edits to rects, colors, and text reflect immediately.
- [ ] Anchored-stretch and fixed-size rects both lay out correctly (panel insets, centered button).
- [ ] Deselecting / selecting a non-UI entity removes the preview and its subscriptions.
- [ ] No preview work happens when no canvas is selected; no per-frame rebuilds.
- [ ] typecheck + lint clean.

## Out of scope

- Interactivity (button clicks do nothing in preview).
- Runtime mounting in Play (phase 05).
- Drag-to-move/resize widgets in the preview (Inspector-driven editing only in v1).
- World-space rendering of canvases in the 3D viewport.

## Implementation notes

- The Menu Manager preview panel is the closest existing pattern for "DOM preview inside editor chrome" — see how it hosts and scales cloned templates before inventing new plumbing.
- `src/ui/authored-ui-dom.ts` sits in `src/ui/` beside `sc-ui.css` because both editor and runtime import it; it must not import from `src/editor/`.
- Give the preview root a distinct class (e.g. `authored-ui-root`) and minimal base styles; visual language may borrow `sc-ui.css` variables but avoid coupling to menu-specific selectors.
- Store event names/payloads: see `emit({ type: 'structure' })` usage in `src/editor/document.ts`.
