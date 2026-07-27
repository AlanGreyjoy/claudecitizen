---
sidebar_position: 4
title: Realtime
description: WebTransport, Protobuf, shared WASM prediction, and cell ownership.
---

# Realtime architecture

Online play uses an authoritative Rust cell simulation. Clients send **intents**;
cells decide outcomes.

## Transport

| Channel | Carries |
| --- | --- |
| WebTransport reliable streams | Control, reconciliation, and every *structural* replication frame — baselines, entities entering, entities leaving |
| WebTransport datagrams | Intents, and replication frames that are pure state churn |

The split is by **kind, not size**. Nothing restates an entity that entered or
left, so those cannot be droppable; a position is restated 50 ms later, so it
can. Sizing a frame against `MAX_DATAGRAM_BYTES` (48 KB) instead of
`Connection::max_datagram_size()` (~1.2 KB) is what once silently stopped every
client in a populated cell from receiving anyone, while chat kept working.

Canonical wire contract: `proto/world.proto` (Protobuf). There is **no** WebSocket
fallback and no second prediction implementation.

Session bootstrap goes through HTTP (`/world/session` and related routes); the
client then dials `WEBTRANSPORT_PUBLIC_URL`.

## Shared prediction

`backend/crates/sim-core/` is compiled:

- **Native** — Rapier authority inside the cell server
- **WASM** — browser prediction (`npm run build:wasm`)

Both sides share the same simulation core so prediction stays aligned with
authority.

## Cell ownership

| Mechanism | Role |
| --- | --- |
| Redis leases | Route which pod owns a cell |
| PostgreSQL epochs | Fence stale owners |
| PostgreSQL checkpoints | Durable cell state |
| Redis fan-out | Cross-pod snapshot routing |

One writer per cell. Never introduce dual-backend or client-authoritative
outcomes.

## Interest

Simulation, interest management, and broadcasts must scale with
**players-in-range**, not the whole world. Payloads stay compact — never ship
unfiltered world state every tick.

Interest lives at the **edge**, one replicator per connection, not in the cell:
a cell is shared by every viewer and an interest set is not. Each edge session
claims authority for the cell its viewer stands in and observes the surrounding
3×3×3 neighbourhood, so a cell boundary is a sharding line and never a
visibility wall.

**An authority cell is not a view distance.** `grid.rs` keeps cell size and
interest radius as separate numbers bound by `interest <= size`, which is what
makes the 3×3×3 neighbourhood provably sufficient from anywhere inside the
middle cell. Interiors — apartments, hangars, station rooms, shared scenes — are
one unpartitioned cell.

What the edge actually sends:

| Sent | When |
| --- | --- |
| `EntityProfile` — identity, appearance | Once, when an entity enters the viewer's interest |
| `ReplicatedEntity` — position, orientation, animation | Only when it changed, at a cadence that falls off with distance |
| `removed_handles` | When an entity leaves interest or disconnects |

Entities are addressed by a small per-connection **handle**, not a repeated
36-byte UUID. Because an idle entity is *supposed* to send nothing, the client
must never expire an entity on silence — lifecycle comes from removals and
baselines, both of which are reliable.

## Related

- [Stack](./stack)
- [Deployment](./deployment)
- [Domain design](./domain-design)
