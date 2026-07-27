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
| WebTransport reliable streams | Control, reconciliation |
| WebTransport datagrams | Intents, snapshots |

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

## Related

- [Stack](./stack)
- [Deployment](./deployment)
- [Domain design](./domain-design)
