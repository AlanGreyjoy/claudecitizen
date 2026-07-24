---
name: prd
description: Create ClaudeCitizen PRD handoff packs under prds/<slug>/ with README, PRD, phased implementation docs, and a master checklist so a new chat can implement without rediscovering context. Use when the user asks for a PRD, PRD pack, phased plan under prds/, feature handoff docs, or to mirror prds/system-map.
---

# ClaudeCitizen PRD Pack

Write **docs-only** handoff packs under `prds/<slug>/` so a fresh chat can implement a feature without rediscovering codebase context. Canonical example: `prds/system-map/`.

**Do not implement feature code** unless the user explicitly asks. This skill produces the pack; implementation chats consume it.

## When to use

- User wants a PRD, phased plan, or “new chat can pick this up”
- Feature spans multiple phases / bounded contexts
- Naming or architecture choices need locking before coding

## Workflow

### 1. Discover (before writing)

1. Read `AGENTS.md` for ownership and constraints that apply.
2. Scan existing code paths the feature will touch; record **current baseline** facts (files, hardcoded behavior, gaps).
3. Resolve ambiguous product naming with the user if needed (e.g. constellation vs System Map). Prefer one product name and lock it.
4. Propose phase split: **MVP / authoring / data first**, then runtime / play. Prefer 3–6 phases; each phase must be shippable on its own.

### 2. Plan (optional but preferred for large packs)

If the change is large, draft a short plan covering:
- Folder slug and deliverable file list
- Locked decisions to capture in the PRD
- Phase list with dependencies
- Confirmation: docs only

Then implement the pack.

### 3. Write the pack

Create:

```
prds/<slug>/
  README.md
  PRD.md
  CHECKLIST.md
  phases/
    01-<short-name>.md
    02-<short-name>.md
    …
```

Slug: lowercase kebab (`system-map`, `weapon-shop-v2`). Match the product name when possible.

Write in this order: **README → PRD → phases → CHECKLIST** (checklist mirrors phase checkboxes).

### 4. Handoff

Tell the user:
- Path to the pack
- Recommended build order (which phases are MVP)
- To start implementation: paste the prompt block from `CHECKLIST.md`

## File requirements

### README.md

- One-paragraph product summary
- Why this pack exists (new-chat handoff)
- Recommended build order (MVP vs later)
- Table of files in the pack
- “New chat” pointer to `CHECKLIST.md` prompt
- **Related code (today)** table — real paths the implementer must read

### PRD.md

Required sections (keep numbering; adapt titles only if needed):

1. **Header** — Status, owner, last updated, links to phases + checklist
2. **Summary** — what ships; call out MVP phases
3. **Problem** — current gap with concrete baseline facts
4. **Goals** — numbered, testable
5. **Non-goals** — explicit out-of-scope (prevents scope creep in later chats)
6. **Locked decisions** — table; implementers must **not** reopen these without user approval
7. **Users and critical journeys** — author + player (or relevant personas)
8. **Current baseline** — table of facts + paths (do not rediscover)
9. **Data model** — sketch types / JSON shape if applicable; mark conceptual vs final
10. **Architecture constraints** — bounded contexts, import rules, performance notes
11. **Product requirements** — grouped by phase theme
12. **Phased delivery** — table: phase → deliverable → depends on
13. **Acceptance** — product-level checkboxes
14. **Open implementation notes** — deferred details owned by specific phases (not product forks)
15. **References** — docs + code paths

Tone: decisive. Lock naming, ownership (`world/` vs `render/`), and MVP cut. Sketch data models; finalize field lists in phase 01-style docs.

### phases/NN-name.md

Every phase file:

```markdown
# Phase NN — <Title>

**PRD:** [../PRD.md](../PRD.md)
**Status:** Not started
**Depends on:** …
**Unlocks:** …

## Objective
One paragraph.

## Key files to add or touch
| Path | Action |
| --- | --- |
| `path` | **Add** / **Extend** / **Wire** — note |

## Tasks
### <Group>
- [ ] Concrete checkbox items (files, behaviors, docs)

## Acceptance criteria
- [ ] Verifiable outcomes + lint/typecheck per AGENTS.md

## Out of scope
What this phase must not do (point to later phases).

## Implementation notes
Mirrors, pitfalls, links to similar existing code.
```

Rules:
- Tasks name **real paths** and mirror existing patterns (e.g. planets schema/loader → systems).
- Include docs updates when authoring/play UX changes.
- End tasks with `typecheck` + `lint` clean for touched code.
- Keep phases independently completable; state dependencies clearly.

### CHECKLIST.md

1. **New chat prompt** — fenced block the user pastes. Must instruct reading README → PRD → CHECKLIST → first open phase; follow `AGENTS.md`; do not start dev servers; do not reopen locked decisions; check off items when done.
2. **Per-phase checkbox lists** — mirror each phase’s key deliverables (shorter than the phase file).
3. **Product acceptance** — copy or summarize PRD acceptance checkboxes.

## Quality bar

- Pack is enough for a cold chat: baseline, locked decisions, files to touch, acceptance.
- No secret or protected asset paths that should not be committed.
- No “implement everything in one phase” — split data/schema, editor, runtime, play UX when relevant.
- Link phases bidirectionally (PRD ↔ phases ↔ checklist).
- Prefer referencing `prds/system-map/` structure over inventing a new layout.

## Anti-patterns

- Writing only a single flat PRD with no phases/checklist
- Phases that say “figure out the design” without pointing at locked PRD decisions
- Embedding full recipes in placement docs when references are the pattern (or vice versa) without locking it
- Starting `npm run dev:web` / implementing code while only asked for the PRD pack
- Reopening product naming mid-pack without user sign-off

## Example

Mirror layout and depth of `prds/system-map/` (README, PRD, five phases, checklist with paste prompt).
