# ClaudeCitizen — Agent Conventions

## Project

- We do not write or run unit tests. They are pointless with AI. It's just testing if water = water.
- We are no longer doing a spike. We are making a full fledge Star Citizen clone called ClaudeCitizen (fully vibe coded).

## Architecture — Domain-Driven Design

Map DDD to this repo without over-engineering. No repositories, aggregate folders, or enterprise ceremony unless complexity demands it.

| Concept | ClaudeCitizen mapping |
|---------|----------------------|
| **Bounded contexts** | `world/` (planet & surface), `flight/` (ship), `player/` (on-foot & transitions), `render/` (presentation) |
| **Domain layer** | `world/`, `flight/`, `player/` — pure simulation rules, deterministic where possible |
| **Application layer** | `src/app.js` — mode FSM, frame loop, wiring factories; orchestrates, does not encode domain rules |
| **Infrastructure** | `render/` (WebGL/Three.js), Web Workers (`planet_tile_worker.js`), `scripts/` |
| **Ubiquitous language** | Use existing terms consistently: *flight body*, *landing site*, *radial up*, *on-foot / in-ship* modes, planet name *Asteron* |

**Rules:**

- Export **factories + pure functions** from domain modules (e.g. `createFlightBody`, `integrateFlightBody`, `sampleRenderablePlanetSurface`).
- Keep planet constants and invariants in `world/planet.js`; coordinate and surface queries in `world/` — never scatter them across `app.js` or `render/`.
- Integrate bounded contexts through **explicit interfaces** (e.g. `player/ship_interaction.js` for enter/exit), not by reaching into another module's internals.
- When adding a feature, ask: *which bounded context owns this rule?* Put it there; do not grow `app.js`.

## Architecture — Separation of Concerns

Dependency direction:

```
math/  ←  world/  ←  flight/, player/
                ↑
              render/  (reads domain; never owns simulation rules)
                ↑
              app.js   (wires everything; minimal logic)
```

| Layer | May import | Must not import |
|-------|-----------|-----------------|
| `world/`, `flight/`, `player/` | `math/`, other domain modules | `three`, `render/`, DOM APIs |
| `render/` | `world/`, `player/` (read-only sampling/display), Three.js | Mutating flight/player state directly |
| `app.js` | All layers | Implementing terrain/physics/rendering logic inline |
| `scripts/` | Reuse `src/` modules | Duplicating domain logic |

**Anti-patterns — never do these:**

- Three.js objects or shaders inside `world/` or `flight/`
- Gameplay rules (gravity, collision, mode transitions) inside `render/`
- Large new feature blocks added to `app.js` instead of the owning folder

**Input normalization** stays at boundaries: UI sliders → `normalizeVegetationSettings()` in `render/vegetation_settings.js`; future API payloads validated at the server edge.

## Security

### Client (current browser game)

- **No secrets in the repo or bundle.** API keys, DB URLs, and admin tokens belong server-side only — never commit sensitive values to `import.meta.env` or source.
- **Treat all client state as untrusted.** For future multiplayer, the server is authoritative; the client sends intents, not outcomes.
- **Sanitize user-controlled inputs.** Clamp numeric ranges, reject malformed JSON; follow the clamp pattern in `render/vegetation_settings.js`.
- **Safe asset loading.** Only load from known paths; no `eval` or dynamic code from user or network input.
- **Deploy hygiene.** Use CSP, HTTPS in production, and minimal exposed headers; static hosting serves public assets only.

### Server (when adding API / multiplayer / persistence)

When a backend is introduced, put it in a dedicated folder (e.g. `server/` or `api/`): routes stay thin, domain logic lives in services, auth middleware stays separate from handlers.

- **Authentication & authorization** — verify identity on every protected route; least-privilege roles; short-lived tokens; httpOnly secure cookies or validated JWTs; never trust client-sent user IDs without verification.
- **Input validation** — validate and parse at the HTTP boundary (schema/types); reject early; never pass raw client input to DB or shell.
- **Secrets management** — `.env` or secret manager only; keep `.env` in `.gitignore`; rotate on leak; no secrets in logs or error responses.
- **Transport & headers** — HTTPS only in prod; CORS allowlist (not `*` with credentials); security headers (HSTS, X-Content-Type-Options, etc.).
- **Rate limiting & abuse** — limit auth and expensive endpoints; cap payload sizes.
- **Database** — parameterized queries only; versioned migrations; RLS/permissions where applicable (e.g. Supabase).
- **Path & file serving** — prevent path traversal (see `scripts/dev-server.mjs`: strip `..`, normalize paths).
- **Logging** — log security events; never log passwords, tokens, or PII unnecessarily; return generic errors to clients.
- **Dependencies** — keep npm deps updated; audit for known CVEs before release builds.
