# Phase 03 — Inspector Fields

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** [01 — UI schema](./01-ui-schema.md)
**Unlocks:** [04 — Editor UI preview](./04-editor-ui-preview.md)

## Objective

Give every Authored UI component type a proper Inspector field editor so authors can edit widgets without touching JSON: rect anchors/pivot/offsets, panel colors, text content, image asset (with Project-panel drag-drop), and button actions.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/editor/react/panels/component_fields/UiWidgetFields.tsx` | **Add** — field editors for all six `ui-*` types in one module (mirrors `BuildersScene.tsx` grouping style) |
| `src/editor/react/panels/component_fields/Registry.tsx` | **Wire** — register the six editors |

## Tasks

### Field editors (`UiWidgetFields.tsx`)

- [ ] `UiCanvasFields` — Reference Width / Reference Height number inputs.
- [ ] `UiRectFields` — three groups: **Anchors** (min x/y, max x/y, 0..1 clamped), **Pivot** (x/y), **Offsets** (min x/y, max x/y px). Reuse the panel's existing numeric-input primitives from neighboring field modules.
- [ ] `UiPanelFields` — Background Color (existing color-field pattern) + Border Radius number.
- [ ] `UiTextFields` — Text (multiline textarea), Font Size, Color, Align select.
- [ ] `UiImageFields` — Src asset path with **Project-panel drag-drop** (mirror the Open SFX / audio-field drop pattern) + Fit select.
- [ ] `UiButtonFields` — Label, Action select (`none` / `scene-link` / `close`); Scene Id text input shown only when action is `scene-link` (mirror `UiScreenFields`'s conditional `menuId`).

### Registration

- [ ] Register all six in `Registry.tsx` following the existing map/dispatch pattern so InspectorPanel picks them up by component `type`.
- [ ] Field writes go through the same store component-update path the other editors use (undo-compatible; document dirty flag set).

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean for touched files.

## Acceptance criteria

- [ ] Selecting any widget shows labeled editors for every schema field; edits persist through save/reload.
- [ ] Anchors/pivot inputs clamp to 0..1; numeric fields reject non-finite values.
- [ ] Dragging an image asset from the Project panel onto Image Src fills the path.
- [ ] Button Scene Id input appears only for `scene-link` action.
- [ ] typecheck + lint clean.

## Out of scope

- Live visual feedback while editing (phase 04 preview provides it).
- Rect manipulation gizmos in any viewport.
- Asset-picker modal for images — drag-drop + text path only in v1.
- Scene-id dropdown populated from the scene list (free text in v1; note as follow-up).

## Implementation notes

- `UiScreenFields` in `BuildersScene.tsx` is the closest existing scene-component editor — copy its select/conditional-field idioms.
- Look at `ConsumableShopFields.tsx` / `ShipControllerFields.tsx` for grouped numeric layouts, and the audio SFX fields for the Project-panel drop target wiring.
- Keep all six editors in one `UiWidgetFields.tsx` unless it exceeds the size of neighboring `Builders*` modules; they share small sub-editors (Vec2 input, color).
