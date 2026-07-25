# Phase 05 — Runtime Mount

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** [01](./01-ui-schema.md), [04](./04-editor-ui-preview.md) (shared DOM builder)
**Unlocks:** [06 — Menu migration + docs](./06-menu-migration-docs.md)

## Objective

Mount authored canvases in play: extend `ui-screen` with `screen: "authored"` + `canvasEntityId`, build the canvas DOM as a fullscreen overlay through the shared builder from phase 04, and wire `ui-button` actions (`scene-link` transitions in-process, `close` unmounts). The five built-in screens keep working unchanged, in-editor Play (F6) and shipped builds behave identically.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/prefabs/schema.ts` | **Extend** — add `"authored"` to `SCENE_UI_SCREENS`; `canvasEntityId` field on `ui-screen` (validated when screen is authored) |
| `src/editor/react/panels/component_fields/BuildersScene.tsx` | **Extend** — `UiScreenFields` shows Canvas Entity Id when screen is `authored` |
| `src/app/scene-host.ts` | **Wire** — `mountUiScreens` handles `authored`: find canvas entity, build DOM via `buildCanvasDom`, mount fullscreen, dispose on scene switch |
| `src/ui/authored-ui-dom.ts` | **Extend** — button activation callback carries the `ui-button` action so the host can act |
| `src/world/scenes/templates.ts` | **Extend** — new **Authored UI** scene template: Canvas (+ starter Panel/Text/Button) + `ui-screen: authored` wired to it + `scene-link` |

## Tasks

### Schema + inspector

- [ ] Add `"authored"` to `SCENE_UI_SCREENS`; add optional `canvasEntityId` to the `ui-screen` component; validator requires it when `screen === "authored"` (mirror the `menuId` convention).
- [ ] `UiScreenFields`: Canvas Entity Id input shown only for `authored` (same conditional pattern as Menu ID).

### Scene-host mount

- [ ] In `mountUiScreens`: for `authored`, resolve `canvasEntityId` against the scene's GameObject tree (fall back to the scene's only `ui-canvas` when the id is empty and exactly one canvas exists — locked per PRD §13); warn and skip when unresolvable.
- [ ] Build DOM with `buildCanvasDom`, mount as a fullscreen overlay in the same host container the built-in screens use, scaled to the viewport (reuse the phase 04 scale-to-fit logic).
- [ ] Dispose on scene switch: remove the overlay and listeners in the same teardown path built-in screens use; scene transitions never reload the page.
- [ ] Asset resolver callback resolves `ui-image.src` through the runtime asset path convention (same base the prefab renderer uses for project assets).

### Button actions

- [ ] `scene-link` → call the same in-process scene switch `scene-link` components use in `scene-host` (target `sceneId` from the button).
- [ ] `close` → unmount the overlay (scene keeps running).
- [ ] `none` → no-op.
- [ ] Actions are pointer-only in v1 (no keyboard focus/nav) — noted in docs.

### Template

- [ ] Add an `authored-ui` entry to `SCENE_TEMPLATE_IDS` / `SCENE_TEMPLATES`: Canvas with a Panel, a Text ("New Screen"), and a Button (action `scene-link`, empty sceneId), plus a GameObject carrying `ui-screen: authored` pointing at the canvas.

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean; note that interactive Play QA (F6 walkthrough) is owner-verified per AGENTS.md.

## Acceptance criteria

- [ ] A scene with `ui-screen: authored` mounts its canvas fullscreen in Play (F6) and in a Build Web output.
- [ ] A `ui-button` with `scene-link` transitions to the target scene in-process; `close` removes the overlay.
- [ ] Built-in `title` / `login` / `character-create` / `loading` screens behave exactly as before; `menu` remains unmounted by scenes.
- [ ] File → New Scene offers the **Authored UI** template and it plays immediately.
- [ ] Overlay is fully removed on scene switch — no leaked DOM nodes or listeners.
- [ ] typecheck + lint clean.

## Out of scope

- Migrating any existing hardcoded menu (phase 06).
- Opening authored UI from gameplay interactions (station markers, keybinds) — `ui-screen` scene mount only in v1.
- Runtime-mutable widget state (text binding, dynamic lists).
- Keyboard/gamepad navigation of buttons.

## Implementation notes

- Read `mountUiScreens` and `scheduleAutoLinks` in `src/app/scene-host.ts` first — the authored branch should look like a sixth sibling of the existing screens, and the scene-link action should reuse whatever helper `scene-link` auto transitions call.
- The DOM builder must stay shared with the editor preview; if runtime needs different behavior, extend via options/callbacks, never fork the module.
- In-editor Play mounts inside `#editor-play-host` (fixed overlay with a CSS transform containing `position: fixed`) — verify the authored overlay positions correctly inside it, since the transform changes the containing block.
- Performance: mount once, update on events only. Nothing in this phase may touch the frame loop (`create-game-loop` untouched).
