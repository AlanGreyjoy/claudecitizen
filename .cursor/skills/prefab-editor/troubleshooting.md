# Prefab Editor — GLB & Component Troubleshooting

## Golden rule

Animation, ship-door, ship-gear, ship-ramp, and collider bindings reference GLB nodes **by exact name**. A typo or renamed Blender export = silent failure (node doesn't move, collider doesn't bind, door doesn't open).

**Workflow when something doesn't bind:**
1. `node scripts/inspect_glb.mjs <path>` — get authoritative names.
2. In editor: sub-select the node → **Copy Node Name** from context menu.
3. Compare to component `nodes[].name`, `collider.node`, `ship-gear` / `ship-ramp` node fields.
4. Preview in play; filter console for warnings below.

## Console warnings (runtime)

| Message | Meaning |
|---------|---------|
| `Animation node not found after 300 attempts: …` | `prefab_renderer.ts` `bindAnimationComponent` — names don't exist under entity or root group. Warning lists available names. |
| `has no collider bound` (per door/animation) | Door animates but no collider references its node(s). Player can't walk through. |
| `[collider]` debug (ship, iteration 0) | `colliders.ts` — capsule push diagnostics in ship deck mode. |

Renderer search order: `targetObject.getObjectByName(name)` then `rootGroup.getObjectByName(name)`. Names are sanitized via `sanitizeNodeName()` — unusual characters may be stripped; prefer simple alphanumeric + underscore names in GLB exports.

## Editor-specific issues

### Component not where expected

| Symptom | Check |
|---------|-------|
| Empty from GLB context menu appears at asset root, not under node | Entity needs `glbAnchor` set to the GLB node name (or legacy `Name (NodeName)` suffix). `isEntityBoundToGlb` skips flat listing when bound. Node names with parentheses (e.g. `Foo_(3)`) require `glbAnchor` — the old regex tail parser broke on those. |
| Added collider but it's on wrong entity | Was a GLB node sub-selected? Colliders attach to **node override**, not entity, when sub-selected. |
| Added interaction/door but can't find it | Marker components spawn a **child entity** — look under parent in hierarchy or under the GLB node row. |
| Singleton greyed out in palette | Only one per **document** (e.g. `ship-frame`, `station-frame`). |
| Component missing from palette | Prefab kind mismatch — ship-only types won't appear on station prefabs. |

### GLB node not selectable

- Model still loading — wait for viewport mesh; context menu shows "Mesh position unavailable".
- Node hidden via Delete — check `glbNodeHidden`; restore by removing from `hiddenNodes` in JSON or re-import.
- Click entity first, then drill (re-click same viewport spot) or use hierarchy GLB tree.

### Transform override not saving

- Node overrides need a name resolution path: `store.getGlbNodeName()` → `glbNodeTransforms` → `serialize.ts` `nodeOverrides`.
- If adding new node-level features, update **both** `viewport.ts` and `prefab_renderer.ts`.

## Play-mode door & animation bugs

See `.agents/AGENTS.md` **Animation → collider → interaction wiring**.

### Station doors (`animation` + `interaction`)

1. **Visual**: `game_loop.ts` → `updateStationAnimations` → `prefab_renderer.ts` `updateAnimations`.
2. **Collider**: static Rapier bodies; must have `collider.animation` bound in `station_runtime.ts`. Open blend toggles `setEnabled`.
3. **F-key**: `interaction` with `interactionType: "animation"` + `targetAnimationId` → `prefab-info` branch uses `actions.wasKeyPressed`, **not** `interactPressed`.

| Symptom | Likely cause |
|---------|----------------|
| Opens on spawn, F does nothing | Broken `wasKeyPressed` closure or wrong interaction branch |
| Animates visually, can't walk through | Collider not bound to animation (`collider.animation` unset) |
| Nothing moves | Node name mismatch; check console for animation binding warning |

### Ship doors (`ship-door`)

1. Visual + collider: `ship_runtime.ts` `bindColliderAnimations` — collider `node` must match door node name.
2. F-key: `interactPressed` (captured boolean) in deck mode.
3. Walk-through: `isDoorPassable` at `open01 >= 0.85`; collider disabled at same threshold.

| Symptom | Likely cause |
|---------|----------------|
| Door won't open | Marker entity position / `radius` — interact spot not near player |
| Opens but blocked | Collider `node` doesn't match animated node; check `has no collider bound` warning |

## Collider debugging

| Context | System | Key files |
|---------|--------|-----------|
| Station | Rapier static bodies | `station_physics.ts`, `rapier_world.ts`, `station_walk.ts` |
| Ship deck | Custom capsule resolver | `colliders.ts`, `ship_deck.ts` |

- Station animated doors: collider must be **bound** to animation state, not just placed at door location.
- Ship mesh colliders on hull: `shape: "mesh"` on entity; node colliders: `shape: "box"` on node override.
- Editor auto-sizes box colliders from `getGlbNodeBounds()` when adding via node context.

## Quick validation checklist

```
[ ] GLB node names verified via inspect_glb.mjs or Copy Node Name
[ ] Component node fields match exactly (case-sensitive)
[ ] Marker entities positioned at interact spots (doors, interactions)
[ ] For station doors: interaction.targetAnimationId matches animation.id
[ ] For animated doors: at least one collider bound to same node
[ ] Preview in play — console clean of binding warnings
[ ] F-key tested at marker radius in play mode
```
