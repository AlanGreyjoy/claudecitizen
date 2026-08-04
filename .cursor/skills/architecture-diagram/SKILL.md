---
name: architecture-diagram
description: Use ClaudeCitizen architecture docs as product law for implementation — permanent decisions, mermaid diagrams, cross-doc Related links, and code-may-lag gaps. Use when implementing or designing a feature against architecture docs, chasing cross-domain dependencies, updating docs/docs/architecture/*.md, or when the user mentions architecture law, permanent decisions, or architecture diagrams.
---

# Architecture diagrams (law)

`docs/docs/architecture/*.md` are **product law**, not PRDs, aspirational notes,
or optional reading. Mermaid diagrams + permanent decisions define the target
system. **Code may lag.** Gaps are refactor targets — never permission to invent
a second rule, ship client-authoritative outcomes, or skip a linked domain.

Thin always-on pointers live in `.cursor/rules/*-architecture.mdc`. They
summarize the permanent decision and say when to open the full doc. **Pointers
are not enough for implementation** — read the full law before coding the
domain.

Agent index: `AGENTS.md` (architecture sections + key-file table). Orientation:
`CLAUDE.md`.

## When to open this skill

- Implementing or changing anything named in an architecture doc
- Designing a new system (write/update law **with** the change, not after)
- Unsure which domain owns truth, currency, catalog vs Build Web, or peers
- Chasing cross-domain edges (missions ↔ NPC ↔ mobs ↔ factions ↔ progression…)
- User says architecture, law, permanent decision, or diagram

## Consume workflow (implementation)

1. **Match domain** — pick primary doc from the catalog below (or
   `.cursor/rules/agent-conventions.mdc` quick triggers).
2. **Read full law** — `docs/docs/architecture/<doc>.md`, not only the `.mdc`
   pointer.
3. **Lock permanent decisions** — do not reopen without explicit user approval.
4. **Walk Related** — open every linked doc that touches ownership, currency,
   catalog surface, travel, or multiplayer for this change.
5. **Check diagrams** — mermaid ownership / flow charts are normative; code
   structure should move toward them.
6. **Baseline vs law** — if doc says code lags, implement toward law; do not
   copy the stub as the design.
7. **Multiplayer in parallel** — if peers must see or affect it, also read
   [multiplayer](../../../docs/docs/architecture/multiplayer.md) (cell vs
   client, intents, what peer observes).
8. **Ship the slice** — prefer one coherent vertical toward law over a
   local-only dead end.

## Cross-doc dependency rules

| Concern | Always also check |
| --- | --- |
| Currency / pay / grants | [item-mall](../../../docs/docs/architecture/item-mall.md) (ARC ≠ AC); [stripe](../../../docs/docs/architecture/stripe.md) if money |
| Catalog vs project files | [content-delivery](../../../docs/docs/architecture/content-delivery.md) |
| Shared gameplay / travel / presence | [multiplayer](../../../docs/docs/architecture/multiplayer.md) |
| Mission offer / talk / shops | [npc](../../../docs/docs/architecture/npc.md) + [missions](../../../docs/docs/architecture/missions.md) |
| Kill / wildlife / PVE | [mobs](../../../docs/docs/architecture/mobs.md) (≠ NPC) |
| Standing / ranks | [factions](../../../docs/docs/architecture/factions.md) (≠ [organizations](../../../docs/docs/architecture/organizations.md)) |
| XP / level gates | [progression](../../../docs/docs/architecture/progression.md) |
| Drops / packs | [loot-tables](../../../docs/docs/architecture/loot-tables.md) |
| Place / scene hops | [scene-flow](../../../docs/docs/architecture/scene-flow.md) (boot only) + [game-loop](../../../docs/docs/architecture/game-loop.md) / [space-traversal](../../../docs/docs/architecture/space-traversal.md) |
| Body / surface / *g* | [planets](../../../docs/docs/architecture/planets.md) + [player](../../../docs/docs/architecture/player.md) |
| Device UI only | [haloband](../../../docs/docs/architecture/haloband.md) (presentation; outcomes stay domain/server) |

**Related links at the top of each doc are the dependency graph.** Follow them;
do not invent a parallel ownership story in code comments.

## Catalog (primary → path)

| Domain | Full law |
| --- | --- |
| Boot / entry hops | `docs/docs/architecture/scene-flow.md` |
| Hab → Station → Hangar → Space | `docs/docs/architecture/game-loop.md` |
| Cell / presence / peer presentation | `docs/docs/architecture/multiplayer.md` |
| Open Space / boarding / Warp Gate | `docs/docs/architecture/space-traversal.md` |
| Star System ↔ Star Map | `docs/docs/architecture/star-map.md` |
| PlanetDocument / active planet | `docs/docs/architecture/planets.md` |
| Ship Rapier + modes / boost / quantum | `docs/docs/architecture/ship-flight.md` |
| Vacuum coast / aim-track | `docs/docs/architecture/ship-physics.md` |
| Ship weapons / lock / destroy | `docs/docs/architecture/ship-combat.md` |
| Build Web vs Console catalog | `docs/docs/architecture/content-delivery.md` |
| Character vitals / planet stress | `docs/docs/architecture/player.md` |
| Home world select / starter Hab | `docs/docs/architecture/home-worlds.md` |
| Death / respawn | `docs/docs/architecture/player-death.md` |
| HaloBand shell / tabs | `docs/docs/architecture/haloband.md` |
| Item Mall / AC | `docs/docs/architecture/item-mall.md` |
| Stripe / Payment Element | `docs/docs/architecture/stripe.md` |
| NPCs (not mobs) | `docs/docs/architecture/npc.md` |
| Mobs / PVE (not NPCs) | `docs/docs/architecture/mobs.md` |
| Missions / contracts | `docs/docs/architecture/missions.md` |
| Loot tables | `docs/docs/architecture/loot-tables.md` |
| Factions (NPC world) | `docs/docs/architecture/factions.md` |
| Organizations (player crews) | `docs/docs/architecture/organizations.md` |
| Level / XP | `docs/docs/architecture/progression.md` |
| Harvest / gather | `docs/docs/architecture/harvesting.md` |

Pointer twins: `.cursor/rules/<same-slug>-architecture.mdc` (alwaysApply).

## Author / update workflow (new or changed law)

When product shape changes, **update the architecture doc in the same change
set** (or immediately before coding). Do not revive `prds/`.

Doc skeleton (match existing files):

1. Frontmatter (`title`, `description`, `sidebar_position`)
2. One-paragraph mental model + web-stack note if useful
3. **Related:** links to every cross-domain doc
4. **This doc is law.** Code may lag… (name known gaps)
5. **Permanent decision(s)** — numbered; include mermaid when ownership/flow matters
6. Rejected alternatives (short)
7. Data model / ownership / invariants
8. **Baseline vs law** when code lags
9. **Open / later** — explicit non-goals
10. Sync the thin `.cursor/rules/<slug>-architecture.mdc` permanent-decision
    blurb + “when changing… read full doc”
11. List in `AGENTS.md` / `CLAUDE.md` if new domain

Mermaid: prefer `flowchart` for ownership and sequence; keep node labels short;
diagrams are normative, not decoration.

## Hard rejects

- Treating architecture as optional or “we'll align later”
- Using today's stub/gap as the permanent design
- Paying missions/loot in **AC** or granting money outside Stripe webhook law
- Conflating NPC ↔ mob, Faction ↔ Org, ARC ↔ AC, Build Web ↔ Console catalog
- Adding a second scene-travel or cell-pick mechanism
- “Add multiplayer later” for shared gameplay
- Writing a PRD pack under `prds/` (removed; law docs replace it)

## After implementation

- If you discovered a permanent decision while coding, **write it back** into
  the architecture doc + pointer — do not leave law only in chat or code
  comments.
- Run `npm run lint` on multi-file changes per `AGENTS.md`.
