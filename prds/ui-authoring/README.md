# Authored UI — PRD pack

AsteronEngine gains **Authored UI**: Unity-like UI widget trees (`ui-canvas`, `ui-panel`, `ui-text`, `ui-image`, `ui-button`) built as GameObjects in scene documents, created from a **Create → UI** submenu in the Hierarchy context menu, edited in the Inspector, previewed in the editor, and mounted at runtime as a screen-space DOM overlay.

This folder is the handoff pack for implementation. A new chat should read these docs instead of rediscovering the Hierarchy context menu, the `ui-screen` mount-point system, and the hardcoded DOM/CSS play HUD.

## Recommended build order

1. **Phases 1–3 (MVP)** — schema + Hierarchy Create → UI + Inspector fields. Authors can build and save widget trees; nothing renders in play yet.
2. **Phases 4–5** — editor DOM preview of the selected canvas, then runtime mount through `ui-screen`.
3. **Phase 6** — migrate one Menu Manager catalog entry to an authored tree + docs.

## Files

| File | Role |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, locked decisions, data model, acceptance |
| [CHECKLIST.md](./CHECKLIST.md) | Master checklist + pasteable new-chat prompt |
| [phases/01-ui-schema.md](./phases/01-ui-schema.md) | `ui-*` component types, validators, registry defaults, serialize round-trip |
| [phases/02-hierarchy-create-ui.md](./phases/02-hierarchy-create-ui.md) | Hierarchy **UI** submenu (Canvas / Panel / Text / Image / Button) + auto-canvas parenting |
| [phases/03-inspector-fields.md](./phases/03-inspector-fields.md) | Inspector field editors for the new component types |
| [phases/04-editor-ui-preview.md](./phases/04-editor-ui-preview.md) | In-editor DOM preview of the selected canvas tree |
| [phases/05-runtime-mount.md](./phases/05-runtime-mount.md) | `scene-host` mounts authored canvases via `ui-screen` |
| [phases/06-menu-migration-docs.md](./phases/06-menu-migration-docs.md) | Migrate one Menu Manager entry; editor docs |

## New chat

Paste the prompt block at the top of [CHECKLIST.md](./CHECKLIST.md). Work phases in order; mark checklist items as you go.

## Related code (today)

| Area | Path |
| --- | --- |
| Hierarchy context menus (`entityMenuEntries`, blank-area RMB) | `src/editor/react/panels/HierarchyPanel.tsx` |
| Entity factory + store insert (`createEmptyEntity`, `addEntity`) | `src/editor/document.ts` |
| Root add helpers (`addEmpty`, `addBox`) | `src/editor/session-helpers.ts` |
| Component palette / submenus | `src/editor/component-actions.ts` |
| Component schema + validators (`ui-screen`, `SCENE_UI_SCREENS`) | `src/world/prefabs/schema.ts` |
| Component registry defaults | `src/world/prefabs/component-registry.ts` |
| Editor ⇄ JSON serialize | `src/editor/serialize.ts` |
| Inspector field editors | `src/editor/react/panels/component_fields/` (registry: `Registry.tsx`, scene comps: `BuildersScene.tsx`) |
| Scene templates (`ui-screen` template) | `src/world/scenes/templates.ts` |
| Runtime UI mount (`mountUiScreens`) | `src/app/scene-host.ts` |
| Menu Manager preview catalog | `src/editor/menus/catalog.ts` |
| Play HUD styles | `src/ui/sc-ui.css` |
| Editor docs | `docs/docs/editor/building-scenes.md`, `docs/docs/editor/menu-manager.md`, `docs/docs/editor/components/index.md` |
| Agent conventions | `AGENTS.md` |
