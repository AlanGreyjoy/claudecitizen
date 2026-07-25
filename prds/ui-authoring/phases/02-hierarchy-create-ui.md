# Phase 02 — Hierarchy Create → UI

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** [01 — UI schema](./01-ui-schema.md)
**Unlocks:** [04 — Editor UI preview](./04-editor-ui-preview.md)

## Objective

Add a Unity-style **UI** submenu to the Hierarchy context menu (blank area and entity rows) that creates widget GameObjects: **Canvas**, **Panel**, **Text**, **Image**, **Button**. Non-canvas widgets created without a `ui-canvas` ancestor auto-create a canvas and parent under it, matching Unity's behavior.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/editor/create-ui.ts` | **Add** — pure helpers: `createUiWidgetEntity(kind)`, `findCanvasAncestor(store, entityId)`, `addUiWidget(store, kind, parentId)` (auto-canvas logic lives here, not in React) |
| `src/editor/react/panels/HierarchyPanel.tsx` | **Wire** — `UI` submenu entries in blank-area `onContextMenu` and single-entity `entityMenuEntries` (beside Add Empty / Add Box) |
| `src/editor/session-helpers.ts` | **Extend** — optional root-level helper mirroring `addEmpty` / `addBox` if the Toolbar or EditorApp needs it; otherwise skip |

## Tasks

### Create helpers (`src/editor/create-ui.ts`)

- [ ] `createUiWidgetEntity(kind: UiWidgetKind): EditorEntity` — builds via `createEmptyEntity` from `src/editor/document.ts`, then attaches components:
  - Canvas → `ui-canvas` + full-stretch `ui-rect`; name `Canvas`
  - Panel → `ui-panel` + stretched `ui-rect` (`anchorMin 0,0`, `anchorMax 1,1`, 24px insets); name `Panel`
  - Text → `ui-text` ("New Text") + centered `ui-rect` (~300×60); name `Text`
  - Image → `ui-image` (empty src) + centered `ui-rect` (~200×200); name `Image`
  - Button → `ui-button` ("Button") + centered `ui-rect` (~240×64); name `Button`
- [ ] `findCanvasAncestor(store, entityId | null): string | null` — walk parents looking for a `ui-canvas` component (include the entity itself).
- [ ] `addUiWidget(store, kind, contextEntityId | null): string` — resolution rules:
  - kind `canvas` → add under the context entity (or root); never auto-wraps.
  - other kinds with a canvas ancestor (or canvas context) → parent under the context entity.
  - other kinds with **no** canvas in the parent chain → create a canvas first (under the context entity or root), then the widget under it. One undo step per `addEntity` is acceptable in v1; note it.

### Menu wiring (`HierarchyPanel.tsx`)

- [ ] Blank-area menu gains `{ label: 'UI', children: [Canvas, Panel, Text, Image, Button] }` after Add Box (parent = root).
- [ ] Single-entity menu gains the same submenu after Add Child Box (parent = that entity).
- [ ] After create, select the new widget (store `addEntity` already selects) and `beginRename` it, matching `addEmptyTo`.
- [ ] Multi-select and GLB-node menus unchanged.

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean for touched files.

## Acceptance criteria

- [ ] RMB blank Hierarchy → UI → Canvas creates a `Canvas` GameObject with `ui-canvas` + `ui-rect`.
- [ ] RMB the canvas → UI → Button nests a `Button` under it with default rect + components.
- [ ] RMB blank area → UI → Button with no canvas in scene creates `Canvas` → `Button` in one gesture.
- [ ] RMB a non-UI entity (e.g. a station prefab instance) → UI → Text creates a canvas under that entity and the text under the canvas.
- [ ] Undo removes what was created; rename mode starts on the new widget.
- [ ] typecheck + lint clean.

## Out of scope

- Inspector field editors (phase 03) — components show with whatever the Inspector renders by default.
- Any visual result in viewport or Game view (phases 04–05). Widgets are hierarchy-only data here.
- Viewport RMB create (Hierarchy only in v1).
- Drag-reparent validation (moving a widget outside a canvas is allowed and simply orphans it from layout until phase 04/05 ignore it).

## Implementation notes

- Follow the `addEmptyTo` / `addBoxTo` pattern (`HierarchyPanel.tsx` ~line 672) — do not bypass `store.addEntity` (it owns undo history and selection).
- Menu entries use the existing `ContextMenuEntry` `children` submenu support (`src/editor/dom.ts`) — same shape as **Create Prefab from Selection**.
- Keep auto-canvas logic in `create-ui.ts` so phase 05's docs and future viewport entry points reuse it; React callback should be a thin call.
- Widget entities are plain entities: no `primitive`, no GLB, no `glbAnchor`. The 3D viewport will render them as empties — acceptable in v1.
