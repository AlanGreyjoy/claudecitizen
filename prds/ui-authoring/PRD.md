# Authored UI PRD

**Status:** Ready for phased implementation
**Owner:** ClaudeCitizen engineering
**Last updated:** 2026-07-25
**Phases:** [01](./phases/01-ui-schema.md) · [02](./phases/02-hierarchy-create-ui.md) · [03](./phases/03-inspector-fields.md) · [04](./phases/04-editor-ui-preview.md) · [05](./phases/05-runtime-mount.md) · [06](./phases/06-menu-migration-docs.md)
**Checklist:** [CHECKLIST.md](./CHECKLIST.md)

## 1. Summary

AsteronEngine gains **Authored UI**: Unity-like UI widget trees built from GameObjects with `ui-*` components, created from a **Create → UI** submenu in the Hierarchy context menu (Canvas, Panel, Text, Image, Button), edited in the Inspector, and — in later phases — previewed in the editor and mounted at runtime as a screen-space DOM overlay.

**Phases 1–3 are the MVP**: authors can create, arrange, and save UI widget trees in scene documents. Phases 4–6 add editor preview, runtime mount through the existing `ui-screen` component, and migration of one hardcoded menu.

## 2. Problem

The Hierarchy context menu creates only Empty and Box. The only UI-facing scene component is `ui-screen`, a mount point that selects one of five hardcoded surfaces (`title`, `login`, `character-create`, `loading`, `menu`); every actual UI layout — title screen, HaloBand, shops, game menu — is hardcoded HTML/CSS in `index.html` templates, `src/ui/sc-ui.css`, and controllers under `src/render/effects/hud/`. The Menu Manager tab is a read-only preview of those hardcoded menus.

Without authored UI:

- Authors cannot build a new menu, HUD panel, or title-screen variant without engine code changes.
- Every new vendor screen or terminal means new HTML templates and a new controller.
- There is no Unity-style "right-click → UI → Button" flow, which is the mental model editor users bring.

## 3. Goals

1. Name the feature **Authored UI** in docs and product copy. Widget component types are `ui-canvas`, `ui-rect`, `ui-panel`, `ui-text`, `ui-image`, `ui-button`.
2. Add those component types to the prefab/scene schema with validators, registry defaults, and serialize round-trip.
3. Add a **UI** submenu to the Hierarchy context menu (blank area and entity rows) that creates widget GameObjects the way Unity does — including auto-creating or auto-parenting under a `ui-canvas`.
4. Provide Inspector field editors for every new component type.
5. Preview the selected canvas tree as DOM in the editor without entering Play.
6. Mount authored canvases at runtime through the existing `ui-screen` component, keeping the five built-in screens working unchanged.
7. Prove the pipeline by migrating one Menu Manager catalog entry to an authored tree.
8. Respect AGENTS.md boundaries: schema in `world/prefabs/`, editor logic in `src/editor/`, runtime mount in `src/app/`; no Three.js in domain modules; UI updates on state/events, never per-frame re-render.

## 4. Non-goals

- World-space / 3D panel UI (entertainment-system gaze screens and cockpit instruments stay separate).
- WebGL/mesh-rendered UI. Authored UI is a screen-space DOM overlay in v1.
- Layout groups, scroll views, sliders, toggles, input fields, masking — widget set is Canvas/Panel/Text/Image/Button only in v1.
- Data binding, scripting, or event graphs. `ui-button` actions are a fixed enum (scene link, close) in v1.
- Replacing the hardcoded title/login/character-create/loading screens (they remain built-ins).
- Migrating all Menu Manager entries (phase 6 migrates exactly one).
- Animation/tween system for widgets.
- Multiplayer/server-driven UI state.

## 5. Locked decisions

| Decision | Choice |
| --- | --- |
| Name | **Authored UI**. Component types prefixed `ui-`. Not "uGUI" / "IMGUI" in product copy. |
| Render target | **Screen-space DOM overlay**, styled consistently with `src/ui/sc-ui.css` patterns. No WebGL mesh UI in this pack. |
| Data home | Widgets are **GameObjects + components** in scene documents (schema shared with prefabs, like all components). Widget hierarchy = GameObject hierarchy. |
| Layout model | `ui-rect` is the RectTransform analog: normalized anchors, pivot, pixel offsets. Every widget entity carries `ui-rect`; `ui-canvas` roots define the reference resolution. 3D transform on widget entities is ignored by UI layout. |
| Core components | `ui-canvas` (root), `ui-rect` (layout), `ui-panel`, `ui-text`, `ui-image`, `ui-button`. |
| Hierarchy UX | **UI** submenu on blank-area RMB and entity RMB: Canvas, Panel, Text, Image, Button. Creating a widget with no `ui-canvas` ancestor auto-creates a canvas and parents under it (Unity behavior). |
| `ui-screen` | Stays. Phase 5 adds `screen: "authored"` + `canvasEntityId` so a scene can mount an authored canvas root. Built-in screens unchanged. |
| Menu Manager | Stays a preview of hardcoded menus through phase 5. Phase 6 migrates one catalog entry and documents the recipe. |
| Scene-only in v1 | `ui-*` components register `scenes: true`, `kinds: []` (like `ui-screen`). Prefab-kind UI is a later pack. |
| MVP cut | Implement phases **1 → 2 → 3** first; then 4 → 5 → 6. |

## 6. Users and critical journeys

### Content author (editor, `npm run editor:dev`)

1. Open a scene, RMB blank Hierarchy area → **UI → Canvas**. A `Canvas` GameObject appears with `ui-canvas` + `ui-rect`.
2. RMB the canvas → **UI → Panel**, then **UI → Button**, **UI → Text**. Children nest under the canvas.
3. RMB blank area → **UI → Button** with no canvas selected: a canvas is auto-created and the button parented under it.
4. Select a widget → Inspector shows `ui-rect` anchors/pivot/size plus the widget's own fields (text, color, image asset, button action).
5. (Phase 4) Select the canvas → editor shows a DOM preview of the tree at the authored reference resolution.
6. Save scene → widget tree round-trips through `serialize.ts` and scene JSON.

### Player (play, phases 5–6)

1. A scene with `ui-screen: authored` mounts its canvas as a fullscreen DOM overlay (title-screen-style flow scenes).
2. Clicking a `ui-button` with a scene-link action transitions scenes in-process through `scene-host` — no page reload.
3. (Phase 6) One former Menu Manager menu opens in play from its authored document instead of a hardcoded template.

## 7. Current baseline (do not rediscover)

| Fact | Detail |
| --- | --- |
| Hierarchy menus | `src/editor/react/panels/HierarchyPanel.tsx` — `entityMenuEntries` (entity rows), blank-area `onContextMenu` (Add Empty / Add Box), GLB-node menu. Menu DOM via `showContextMenu` in `src/editor/dom.ts` (`ContextMenuEntry`, supports `children` submenus and `'sep'`). |
| Create pattern | `createEmptyEntity(name)` in `src/editor/document.ts` → `store.addEntity(entity, parentId)` (undoable, selects new entity). `addEmptyTo` / `addBoxTo` in `HierarchyPanel.tsx`; root helpers `addEmpty` / `addBox` in `src/editor/session-helpers.ts`. |
| UI components today | Only `ui-screen` (`SCENE_UI_SCREENS`: title, login, character-create, loading, menu; optional `menuId`) and `scene-link`. Both `scenes: true`, `kinds: []` in `src/world/prefabs/component-registry.ts`. |
| Inspector fields | `UiScreenFields` in `src/editor/react/panels/component_fields/BuildersScene.tsx`; editors registered in `component_fields/Registry.tsx`. |
| Scene template | `ui-screen` template in `src/world/scenes/templates.ts` creates an empty with `ui-screen: login` + `scene-link`. |
| Runtime mount | `mountUiScreens` in `src/app/scene-host.ts` mounts loading / title / login / character-create; `screen: "menu"` is explicitly **not** mounted by the scene (Menu Manager preview only). Scene switching is in-process. |
| Play HUD | Hardcoded DOM: templates in `index.html`, styles `src/ui/sc-ui.css`, controllers `src/render/effects/hud/`. Menu Manager catalog: `src/editor/menus/catalog.ts` (9 entries, preview-only). |
| Component add flow | `addComponentFromPalette` in `src/editor/component-actions.ts`; palette filtered by prefab kind / `scenes` flag; marker components spawn child empties. `ui-*` widgets do **not** use the marker path — they are created whole entities from the UI submenu. |

## 8. Data model (sketch)

Conceptual — finalize field lists in [phase 01](./phases/01-ui-schema.md). All types live in `src/world/prefabs/schema.ts` beside existing components.

```ts
// Root. One per authored UI tree; children lay out inside it.
interface UiCanvasComponent {
  type: "ui-canvas";
  /** Design-space reference resolution; overlay scales to fit viewport. */
  referenceWidth: number;   // default 1920
  referenceHeight: number;  // default 1080
}

// RectTransform analog. Present on every widget entity (canvas included).
interface UiRectComponent {
  type: "ui-rect";
  /** Normalized 0..1 anchors in parent rect. */
  anchorMin: { x: number; y: number };
  anchorMax: { x: number; y: number };
  /** Normalized pivot inside own rect. */
  pivot: { x: number; y: number };
  /** Pixel offsets in design space (position when anchors equal, insets when stretched). */
  offsetMin: { x: number; y: number };
  offsetMax: { x: number; y: number };
}

interface UiPanelComponent {
  type: "ui-panel";
  backgroundColor: string;   // CSS color, alpha allowed
  borderRadius?: number;
}

interface UiTextComponent {
  type: "ui-text";
  text: string;
  fontSize: number;          // design-space px
  color: string;
  align: "left" | "center" | "right";
}

interface UiImageComponent {
  type: "ui-image";
  /** Project asset path (same asset-path convention as GLB/audio fields). */
  src: string;
  fit: "stretch" | "contain" | "cover";
}

interface UiButtonComponent {
  type: "ui-button";
  label: string;
  /** v1 action enum — no scripting. */
  action: "none" | "scene-link" | "close";
  /** Target scene id when action is "scene-link". */
  sceneId?: string;
}
```

`ui-screen` extension (phase 5):

```ts
// SCENE_UI_SCREENS gains "authored"
{ type: "ui-screen"; screen: "authored"; canvasEntityId: string }
```

## 9. Architecture constraints

- Schema + validators in `src/world/prefabs/` — no DOM, no Three.js (types + pure validation only).
- Editor create/menu logic in `src/editor/` (`HierarchyPanel.tsx` + a new `src/editor/create-ui.ts` helper); React field editors under `src/editor/react/panels/component_fields/`.
- Runtime mount in `src/app/scene-host.ts` + a new DOM builder module under `src/app/` (or `src/ui/`) — `render/` does not own scene UI mounting.
- Performance: authored UI renders once on mount and updates on events. No per-frame DOM writes, no layout recomputation in the game loop. Editor preview (phase 4) rebuilds only on document `structure`/`component` events for the selected canvas.
- Widget trees serialize through the existing `document.ts → serialize.ts → schema.ts` path; no parallel document type.
- In-editor Play (F6) uses the same runtime mount as shipped builds — no editor-only rendering fork after phase 5.

## 10. Product requirements

### Data + schema (phase 1)

- `ui-canvas`, `ui-rect`, `ui-panel`, `ui-text`, `ui-image`, `ui-button` component types with validators and registry defaults; round-trip through serialize and scene save/load.

### Hierarchy creation (phase 2)

- **UI** submenu (Canvas, Panel, Text, Image, Button) on blank-area and entity context menus.
- Auto-canvas: creating a non-canvas widget with no `ui-canvas` ancestor creates one and parents under it. Creating under a widget nests normally.
- New widgets get sensible default rects (centered button/text/image; stretched panel; full-reference canvas) and enter rename mode like Add Empty.

### Inspector (phase 3)

- Field editors for all six types; `ui-rect` grouped as Anchors / Pivot / Offsets; `ui-image.src` accepts drag-drop from the Project panel like audio/GLB fields.

### Editor preview (phase 4)

- Selecting an entity inside a canvas tree shows a scaled DOM preview of that canvas; updates on store events; zero cost when no canvas selected.

### Runtime (phase 5)

- `screen: "authored"` mounts the referenced canvas as a fullscreen overlay; `ui-button` scene-link actions drive `scene-host` transitions in-process; built-in screens untouched.

### Migration + docs (phase 6)

- One Menu Manager catalog entry rebuilt as an authored tree, opened in play from the authored document; editor docs updated (`building-scenes.md`, components index, new `authored-ui.md`).

## 11. Phased delivery

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [01 — UI schema](./phases/01-ui-schema.md) | `ui-*` types, validators, registry defaults, serialize round-trip | — |
| [02 — Hierarchy Create → UI](./phases/02-hierarchy-create-ui.md) | UI submenu + auto-canvas creation helpers | 01 |
| [03 — Inspector fields](./phases/03-inspector-fields.md) | Field editors for all six types | 01 |
| [04 — Editor UI preview](./phases/04-editor-ui-preview.md) | DOM preview of selected canvas tree | 01–03 |
| [05 — Runtime mount](./phases/05-runtime-mount.md) | `ui-screen: authored` + overlay mount + button actions | 01, 04 (shared DOM builder) |
| [06 — Menu migration + docs](./phases/06-menu-migration-docs.md) | One migrated menu + editor docs | 05 |

## 12. Acceptance (product level)

- [ ] RMB in Hierarchy shows **UI** submenu; every item creates a correctly-parented widget GameObject with default components.
- [ ] Creating a widget without a canvas auto-creates a `ui-canvas` parent.
- [ ] All six `ui-*` components validate, save, and reload byte-stable through scene JSON.
- [ ] Inspector edits every field of every widget type; image src accepts Project-panel drag-drop.
- [ ] Editor shows a DOM preview of the selected canvas without entering Play.
- [ ] A scene with `ui-screen: authored` mounts its canvas in play; a `ui-button` scene-link transitions scenes without page reload.
- [ ] One Menu Manager catalog entry runs from an authored document in play.
- [ ] The five built-in `ui-screen` surfaces behave exactly as before.
- [ ] `npm run typecheck` and `npm run lint` clean for all touched code at the end of each phase.

## 13. Open implementation notes

- **Rect math ownership** — phase 1 defines `ui-rect` fields; phase 4 owns the single rect→CSS resolution function that phase 5 reuses. Do not implement layout math twice.
- **Canvas scaling mode** — phase 4 decides scale-to-fit letterboxing vs width-match; default to uniform scale-to-fit unless preview shows otherwise.
- **`canvasEntityId` vs single-canvas rule** — phase 5 decides whether `ui-screen: authored` requires an explicit entity id or mounts the scene's only canvas when exactly one exists. Prefer explicit id with a single-canvas fallback.
- **Button focus/keyboard nav** — deferred; v1 buttons are pointer-only. Note in docs.
- **Phase 6 menu choice** — pick the simplest catalog entry (recommend `game-menu`); do not attempt HaloBand.

## 14. References

- Pack files: [README.md](./README.md), [CHECKLIST.md](./CHECKLIST.md), `phases/`
- Editor docs: `docs/docs/editor/building-scenes.md`, `docs/docs/editor/menu-manager.md`, `docs/docs/editor/components/index.md`
- Code baseline: see [§7](#7-current-baseline-do-not-rediscover) and the Related-code table in [README.md](./README.md)
- Conventions: `AGENTS.md`, `.cursor/rules/prefab-editor.mdc`, `.cursor/skills/prefab-editor/SKILL.md`
- Layout mirror: `prds/system-map/`
