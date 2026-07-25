# Authored UI — Master checklist

**PRD:** [PRD.md](./PRD.md) · **Index:** [README.md](./README.md)

## New chat prompt (paste this)

```
Implement the next unfinished phase of the ClaudeCitizen Authored UI feature.

Read these first (in order):
1. prds/ui-authoring/README.md
2. prds/ui-authoring/PRD.md
3. prds/ui-authoring/CHECKLIST.md — find the first phase with open items
4. That phase file under prds/ui-authoring/phases/

Follow AGENTS.md. Do not start dev servers. After multi-file work, run npm run lint (and npm run typecheck before any commit I request).

Locked decisions are in the PRD — do not reopen naming (Authored UI, ui-* component types), the screen-space DOM render target, widgets-as-GameObjects, the ui-rect anchor model, or the phase 1-3 MVP cut.

When you finish a phase, check off items in CHECKLIST.md and the phase file.
```

---

## Phase 01 — UI schema

Details: [phases/01-ui-schema.md](./phases/01-ui-schema.md)

- [ ] `src/world/prefabs/schema.ts` — six `ui-*` component types + validators + `UI_WIDGET_COMPONENT_TYPES`
- [ ] `src/world/prefabs/component-registry.ts` — labels, defaults, `scenes: true`
- [ ] Serialize round-trip verified (editor ⇄ scene JSON, byte-stable)
- [ ] typecheck + lint clean

## Phase 02 — Hierarchy Create → UI

Details: [phases/02-hierarchy-create-ui.md](./phases/02-hierarchy-create-ui.md)

- [ ] `src/editor/create-ui.ts` — widget factories, `findCanvasAncestor`, `addUiWidget` auto-canvas logic
- [ ] `HierarchyPanel.tsx` — UI submenu on blank-area and entity menus
- [ ] Auto-canvas on widget create with no canvas ancestor; rename mode on new widget; undo works
- [ ] typecheck + lint clean

## Phase 03 — Inspector fields

Details: [phases/03-inspector-fields.md](./phases/03-inspector-fields.md)

- [ ] `component_fields/UiWidgetFields.tsx` — editors for all six types (rect groups, conditional button sceneId)
- [ ] `component_fields/Registry.tsx` — editors registered
- [ ] Image src accepts Project-panel drag-drop
- [ ] typecheck + lint clean

## Phase 04 — Editor UI preview

Details: [phases/04-editor-ui-preview.md](./phases/04-editor-ui-preview.md)

- [ ] `src/ui/authored-ui-dom.ts` — shared rect→CSS resolver + per-widget DOM builders + scale-to-fit
- [ ] `UiCanvasPreview.tsx` — preview of selected canvas, rebuilds on store events only
- [ ] Wired into `EditorApp.tsx`; zero cost when no canvas selected
- [ ] typecheck + lint clean

## Phase 05 — Runtime mount

Details: [phases/05-runtime-mount.md](./phases/05-runtime-mount.md)

- [ ] `SCENE_UI_SCREENS` gains `authored`; `canvasEntityId` on `ui-screen` + inspector field
- [ ] `scene-host.ts` mounts authored canvas fullscreen; disposes on scene switch
- [ ] Button actions: `scene-link` in-process transition, `close` unmount
- [ ] **Authored UI** scene template in `templates.ts`
- [ ] Built-in screens unchanged; F6 Play and Build Web behave identically
- [ ] typecheck + lint clean

## Phase 06 — Menu migration + docs

Details: [phases/06-menu-migration-docs.md](./phases/06-menu-migration-docs.md)

- [ ] `game-menu.scene.json` authored document; Esc opens it via `authored-ui-opener.ts`
- [ ] `index.html` game-menu template deleted; Menu Manager previews authored version
- [ ] `docs/docs/editor/authored-ui.md` + updates to building-scenes / components index / menu-manager docs
- [ ] typecheck + lint clean

---

## Product acceptance

- [ ] Hierarchy **UI** submenu creates correctly-parented widgets; auto-canvas works
- [ ] All six `ui-*` components validate, save, reload byte-stable
- [ ] Inspector edits every widget field; image drag-drop works
- [ ] Editor DOM preview of selected canvas without Play
- [ ] `ui-screen: authored` mounts in play; button scene-link transitions without reload
- [ ] Game Menu runs from its authored document
- [ ] Five built-in `ui-screen` surfaces unchanged
- [ ] typecheck + lint clean per phase
