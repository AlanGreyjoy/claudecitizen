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
| **III — Combat** | Third-person weapons, character controller for aim & fire | **Current — Phase 1** |
| **IV — Universe** | More ships, sites, exploration depth | Planned |
| **V — Online** | Backend, persistence, multiplayer | Future |

## Phase 1 — Third-person combat _(current)_

- [x] Third-person weapon system — equip, fire, reload, weapon swap
- [x] Character controller — over-the-shoulder aim/look while armed
- [ ] Character controller — movement while armed (strafe, sprint/ADS modifiers, recoil)
- [x] Weapon models, muzzle flash, and segmented bullet-drop hitscan against world geometry
- [x] Combat HUD — crosshair, ammo, weapon state

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
- [ ] Additional planets / moons (System Map + handoff path ready; more planet docs still open)

## Flight & ships

- [x] Inertial ship physics — radial gravity, drag, boost, brake, hover assist
- [x] Seamless takeoff, orbit, and landing (no loading screens)
- [x] Pirate ship GLTF with walkable deck and landing pad
- [ ] Additional ship hulls and interiors
- [ ] Deeper flight model — SCM/cruise speeds, afterburner tuning, landing gear
- [x] Quantum / long-range travel between sites (surface POIs + System Map stations; planet handoff when a second planet exists)
- [x] Space stations and orbital structures (System Map placement; dual station roots in play)

## Player & exploration

- [x] Third-person character with walk, sprint, and jump animations
- [x] Enter / exit ship and pilot-seat transitions (mode FSM)
- [x] Procedural landing-site resolution on dry terrain
- [x] Instanced vegetation — grass, trees, rocks
- [x] Over-the-shoulder camera for on-foot and ship-deck traversal
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
- [x] Architecture notes for agents (`AGENTS.md`)
- [x] Chat wired to the authoritative backend
- [ ] In-game map and waypoint navigation
- [ ] Deployable static build with CSP / HTTPS hygiene

## Online

- [x] Rust backend API (`backend/`) with auth, validation, SQLx, and Redis
- [x] Authoritative cell simulation over WebTransport + Protobuf
- [x] Authoritative multiplayer — client sends intents, server owns state
- [x] Persistence — accounts, ship loadouts, and checkpointed cell state
- [x] Rate limiting, Kubernetes secrets, health/readiness, metrics, and fenced ownership
