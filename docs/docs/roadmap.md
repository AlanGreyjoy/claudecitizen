---
sidebar_position: 6
title: Roadmap
description: Living checklist of features and priorities.
---

# Roadmap

Living checklist — not a contract. Priorities shift with the vibe.

| Phase | Focus | Status |
| --- | --- | --- |
| **I — Planet** | Procedural world, LOD terrain, biomes, water | Mostly done |
| **II — Presence** | On-foot play, ship flight, surface ↔ orbit | Mostly done |
| **III — Combat** | FPS weapons, character controller for aim & fire | **Current — Phase 1** |
| **IV — Universe** | More ships, sites, exploration depth | Planned |
| **V — Online** | Backend, persistence, multiplayer | Future |

## Phase 1 — FPS combat _(current)_

- [ ] FPS weapon system — equip, fire, reload, weapon swap
- [ ] Character controller — first-person camera rig and aim/look while armed
- [ ] Character controller — movement while armed (strafe, sprint/ADS modifiers, recoil)
- [ ] Weapon models, muzzle flash, and hitscan / projectile hits
- [ ] Combat HUD — crosshair, ammo, weapon state

## Planet & terrain

- [x] Earth-scale cube-sphere planet (Asteron) with deterministic seeded terrain
- [x] Layered noise — continents, ridged mountains, hills, lake basins
- [x] River valleys carved from procedural noise fields
- [x] Biome classification and terrain texture splatting
- [x] Adaptive quadtree LOD with horizon culling
- [x] Web Worker tile meshing + IndexedDB disk cache
- [x] Foot-surface LOD sync (terrain mesh ↔ character controller)
- [x] Floating-origin rendering for planetary scale
- [x] Procedural lakes with water shaders
- [ ] Ocean-scale water and shoreline polish
- [ ] Weather and time-of-day cycles
- [ ] Additional planets / moons

## Flight & ships

- [x] Inertial ship physics — radial gravity, drag, boost, brake, hover assist
- [x] Seamless takeoff, orbit, and landing (no loading screens)
- [x] Pirate ship GLTF with walkable deck and landing pad
- [ ] Additional ship hulls and interiors
- [ ] Deeper flight model — SCM/cruise speeds, afterburner tuning, landing gear
- [ ] Quantum / long-range travel between sites
- [ ] Space stations and orbital structures

## Player & exploration

- [x] Third-person character with walk, sprint, and jump animations
- [x] Enter / exit ship and pilot-seat transitions (mode FSM)
- [x] Procedural landing-site resolution on dry terrain
- [x] Instanced vegetation — grass, trees, rocks, runtime tuning panel
- [ ] First-person ↔ third-person camera toggle (see Phase 1)
- [ ] Points of interest — outposts, wrecks, landmarks
- [ ] Inventory, interaction, and mission hooks
- [ ] EVA / zero-g outside the ship

## Rendering & atmosphere

- [x] Takram atmospheric shell and aerial perspective
- [x] Volumetric clouds with quality presets
- [x] Volumetric fog
- [x] Star field and post-processing (bloom, tone mapping)
- [x] Render quality presets (`?quality=performance|balanced|high`)
- [ ] Dynamic cloud shadows and lighting passes at all quality tiers
- [ ] Ship damage / wear visuals
- [ ] Audio — engines, wind, ambience, UI

## UI & tooling

- [x] HUD — altitude, speed, biome, mode, cache stats
- [x] Minimap with biome coloring and ship/character markers
- [x] Debug menu and FPS counter
- [x] Headless orbit demo (`npm run demo`)
- [x] Architecture notes for agents (`.agents/AGENTS.md`)
- [ ] Chat wired to a real backend (currently local-only)
- [ ] In-game map and waypoint navigation
- [ ] Deployable static build with CSP / HTTPS hygiene

## Online (future)

- [ ] Backend API (`server/` or `api/`) with auth and validation
- [ ] Authoritative multiplayer — client sends intents, server owns state
- [ ] Persistence — accounts, ship loadouts, world state
- [ ] Rate limiting, secrets management, and the rest of `.agents/AGENTS.md` server checklist
