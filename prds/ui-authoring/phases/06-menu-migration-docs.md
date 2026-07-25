# Phase 06 — Menu Migration + Docs

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** [05 — Runtime mount](./05-runtime-mount.md)
**Unlocks:** — (pack complete)

## Objective

Prove the Authored UI pipeline end-to-end by migrating one Menu Manager catalog entry — the **Game Menu** (Esc pause) — from its hardcoded `index.html` template to an authored canvas document opened in play, and ship the editor documentation for the whole feature.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/scenes/data/game-menu.scene.json` | **Add** — authored scene: canvas + panels/text/buttons reproducing the Game Menu layout |
| `src/app/authored-ui-opener.ts` | **Add** — small runtime opener: load a scene document by id, mount its authored canvas as an overlay via the phase 05 path, return a close handle |
| Game Menu controller under `src/render/effects/hud/` | **Wire** — Esc path opens the authored document through the opener instead of cloning the `game-menu` template |
| `index.html` | **Clean** — delete the now-dead `game-menu` template markup |
| `src/editor/menus/catalog.ts` | **Extend** — `game-menu` entry points at the authored document (preview loads it through `buildCanvasDom`); other entries unchanged |
| `docs/docs/editor/authored-ui.md` | **Add** — feature doc: components, Create → UI flow, rect model, `ui-screen: authored`, button actions, pointer-only note |
| `docs/docs/editor/building-scenes.md` | **Extend** — Authored UI row(s) in the scene assembly table + template mention |
| `docs/docs/editor/components/index.md` | **Extend** — list the six `ui-*` components |
| `docs/docs/editor/menu-manager.md` | **Extend** — note Game Menu is authored; migration recipe for remaining entries |

## Tasks

### Game Menu migration

- [ ] Rebuild the Game Menu layout (Video / Audio / Controls / Exit structure) as an authored canvas in `game-menu.scene.json`, using only v1 widgets. Where the hardcoded menu had interactive settings widgets beyond v1's set, keep buttons that open the existing sub-surfaces or mark them static — the goal is pipeline proof, not settings-UI parity beyond what v1 widgets express.
- [ ] `authored-ui-opener.ts`: given a scene document id, resolve its canvas, mount through the same overlay/mount code path as phase 05 (no forked builder), and hand back `close()`. `ui-button` `close` action dismisses it.
- [ ] Swap the Esc game-menu controller to the opener; delete the template-cloning code and the `index.html` template block.
- [ ] Menu Manager preview for `game-menu` renders the authored document (templateId no longer used for it).

### Docs

- [ ] Write `docs/docs/editor/authored-ui.md` covering: creating widgets from Hierarchy (auto-canvas), rect anchors/pivot/offsets, Inspector fields, editor preview, `ui-screen: authored` + template, button actions, and current limits (pointer-only, fixed widget set).
- [ ] Update `building-scenes.md`, `components/index.md`, and `menu-manager.md` (including a short "migrating a hardcoded menu" recipe referencing this phase's Game Menu change).
- [ ] `npm run build` for docs site if that is part of docs validation in CI; otherwise typecheck/lint only.

### Wrap-up

- [ ] `npm run typecheck` and `npm run lint` clean; state in the handoff that interactive Esc-menu QA is owner-verified per AGENTS.md.

## Acceptance criteria

- [ ] Esc in play opens the Game Menu rendered from the authored document; Exit/close buttons work; no page reload.
- [ ] The `game-menu` template markup is gone from `index.html`; no code references it.
- [ ] Menu Manager still previews all nine catalog entries; `game-menu` previews the authored version.
- [ ] `docs/docs/editor/authored-ui.md` exists and the three touched docs pages reference it.
- [ ] typecheck + lint clean.

## Out of scope

- Migrating any other catalog entry (HaloBand, shops, inventory, AVMS, build terminal, entertainment stay hardcoded).
- Extending the widget set (sliders/toggles for real settings UI belong to a future pack).
- Persisting settings values through authored widgets — existing settings plumbing keeps working however the buttons reach it.

## Implementation notes

- Game Menu chosen over other entries because it is the smallest layout (four sections) and already opens from a single key path; HaloBand is explicitly off-limits (PRD §13).
- Follow the editor-first rule "when you replace a path, finish the job": remove the template, its clone code, and any stale doc mentions in the same change.
- The opener must not duplicate phase 05 mount logic — extract a shared mount helper from `scene-host.ts` if needed rather than copying.
- Scene document is the storage vehicle for the authored menu (locked data home); it is never "played" as a scene — only its canvas is mounted by the opener.
