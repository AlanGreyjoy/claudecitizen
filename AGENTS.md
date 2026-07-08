# AGENTS.md

Guide for AI agents working in this codebase.

## Commands

```bash
npm install          # install deps
npm run dev          # vite dev server (http://localhost:4173) — includes editor
npm run build        # production build
npm run typecheck    # tsc --noEmit (web) + server typecheck
```

There is no lint script configured; `npm run typecheck` is the primary gate. Run it after every change.

## Architecture cheat sheet

- **Prefabs** (`src/world/prefabs/`) are JSON trees of entities with transforms, GLB assets, and gameplay components. Data files live in `src/world/prefabs/data/*.prefab.json`.
- **Schema** (`src/world/prefabs/schema.ts`) defines every component type and its validator. Read this first when a component's fields are unclear.
- **Ship runtime** (`src/world/prefabs/ship_runtime.ts`) flattens a ship prefab into `ShipLayout` (walk zones, doors, seats, colliders). Ship doors use the `ship-door` component.
- **Station runtime** (`src/world/prefabs/station_runtime.ts`) flattens a station prefab into `StationLayoutOverride` (spawn, elevators, hangar pads, info markers, colliders). Station doors use the `animation` component (toggled via an `interaction` component with `interactionType: "animation"` and `targetAnimationId`).
- **Game loop** (`src/app/game_loop.ts`) owns `stationAnimationStates` (per-animation blend values) and the F-key interaction dispatch.

## Animation → collider → interaction wiring

This is the most common source of "door doesn't work" bugs. Trace these paths:

### Station prefab doors (animation component)

1. **Visual**: `game_loop.ts` `updateStationAnimations` lerps `stationAnimationStates[id].value` toward `target`, then calls `renderer.getStationRoot().userData.updateAnimations(blends)`. The renderer (`src/render/prefabs/prefab_renderer.ts` `setupUpdateAnimations`) looks up GLB nodes by name and translates/rotates them.
2. **Collider**: station colliders are baked as **static Rapier bodies** in `play_session.ts` `createStationPhysics` → `syncStaticColliders`. They do NOT move with the animation unless bound via `collider.animation` (set in `station_runtime.ts` `bindStationColliderAnimations`). When bound, `game_loop.ts` toggles their `setEnabled` state in `updateStationAnimations` based on the open blend.
3. **F-key toggle**: an `interaction` component with `interactionType: "animation"` + `targetAnimationId` produces a `prefab-info` interaction (`station_interaction.ts`). `game_loop.ts` handles it at the `interaction.kind === 'prefab-info'` branch using `actions.wasKeyPressed(keyCode)` — NOT `actions.interactPressed`. See gotcha below.

### Ship prefab doors (ship-door component)

1. **Visual + collider**: `ship_runtime.ts` `bindColliderAnimations` binds each collider whose `node` matches a door/ramp/gear node. The custom collision resolver (`colliders.ts` `matrixForAnimation` / `animatedNodeToRoot`) moves the collider transform with the blend.
2. **F-key toggle**: `ship_play_session.ts` / `game_loop.ts` deck-mode branches use `actions.interactPressed` (a captured boolean) to flip `doorRig.isOpen`.
3. **Walk-zone gating**: `ship_rig.ts` `isDoorPassable` returns true at `open01 >= 0.85`; `colliders.ts` `DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD` skips the collider at the same threshold.

## Debugging GLB nodes

Animation/door/collider components reference GLB nodes **by name**. A name mismatch = silent failure (node doesn't move, collider doesn't bind).

```bash
# Dump full node hierarchy, meshes, and animation clips of a GLB:
node scripts/inspect_glb.mjs path/to/model.glb
```

In the play/sandbox console (dev only):

```js
window.__claudecitizenShipModel.listNodeNames();   // ship hull node names
```

The renderer's `bindAnimationComponent` (`prefab_renderer.ts`) searches `targetObject.getObjectByName(name)` then falls back to `rootGroup.getObjectByName(name)`. If a node isn't found it logs a warning and marks the binding incomplete; check the browser console for "could not find node" messages.

## Debugging colliders

- **Station**: Rapier physics. `src/physics/station_physics.ts` owns the world; `src/physics/rapier_world.ts` bakes `GameplayCollider` into Rapier trimesh/cuboid bodies. `resolveCharacterAgainstColliders` in `colliders.ts` is the **ship** path (custom capsule push); the **station** path is Rapier's `KinematicCharacterController.computeColliderMovement`.
- **Ship**: `src/player/ship_deck.ts` `resolveDeckColliderStep` calls `resolveCharacterAgainstColliders` every frame with `colliderRig = { gear01, ramp01, doors: doorBlends }`.
- `colliders.ts` has `console.debug` lines (gated to iteration 0) that log when no push is produced and when a push is rejected by `isAllowed`. Filter the devtools console by `[collider]` to see them.

## Common gotchas

- **F-key does nothing for station animation doors**: `consumeActions()` (`src/flight/player_controls.ts`) returns `wasKeyPressed` as a closure. It must snapshot `justPressed` before `justPressed.clear()` runs, otherwise the closure always reads an empty set. `interactPressed` is a captured boolean and is safe; only `wasKeyPressed` had this bug.
- **"Open on spawn" works but F doesn't**: the animation init path (`stationAnimationStates` seeded from `defaultOpen`) runs without any key input, so it masks a broken key-press path. If `defaultOpen` works but F doesn't, suspect the `wasKeyPressed` closure or the `prefab-info` interaction branch.
- **Door animates visually but player can't walk through**: the collider isn't bound to the animation (check `collider.animation` is set) or the Rapier collider isn't being toggled (check `setDoorColliderEnabled` is called in `updateStationAnimations`).
- **Door animation with no bound collider**: `ship_runtime.ts` `bindColliderAnimations` and `station_runtime.ts` `bindStationColliderAnimations` log a warning **per door/animation** that has zero colliders bound to its node(s) — the door will animate but its collider stays enabled (player can't walk through). A collider with no matching node is a normal static floor/hull collider and is intentionally **not** warned about (that was a prior false-positive flood). Check the console for "has no collider bound".

## Key files

| File | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | Component type definitions + validators |
| `src/world/prefabs/ship_runtime.ts` | Ship prefab → ShipLayout + collider animation binding |
| `src/world/prefabs/station_runtime.ts` | Station prefab → StationLayoutOverride + collider animation binding |
| `src/world/prefabs/collider_runtime.ts` | Bakes `collider` components into `GameplayCollider` objects |
| `src/player/colliders.ts` | Custom capsule-vs-collider resolver (ship); animation matrix math; door-open skip threshold |
| `src/physics/station_physics.ts` | Rapier world + static/dynamic collider sync; door-collider enable/disable |
| `src/physics/rapier_world.ts` | Rapier body/collider creation from GameplayColliders |
| `src/player/ship_rig.ts` | Ship articulation state (gear/ramp/doors) + `isDoorPassable` threshold |
| `src/player/ship_deck.ts` | Ship deck walking + collider step resolution |
| `src/player/station_walk.ts` | Station walking (Rapier character controller) |
| `src/player/station_interaction.ts` | Resolves nearby station interactions from markers |
| `src/app/game_loop.ts` | Main frame loop; owns `stationAnimationStates` + F-key dispatch |
| `src/app/ship_play_session.ts` | Ship sandbox/deck mode; door + ramp toggles |
| `src/render/prefabs/prefab_renderer.ts` | Binds animation components to GLB nodes; `updateAnimations` callback |
| `src/flight/player_controls.ts` | Keyboard/gamepad input; `consumeActions` + `wasKeyPressed` |
| `scripts/inspect_glb.mjs` | CLI GLB node hierarchy dump |
