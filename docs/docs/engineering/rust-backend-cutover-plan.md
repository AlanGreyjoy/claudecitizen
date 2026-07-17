---
title: Rust Backend Cutover Implementation Plan
sidebar_position: 9
---

# Rust Backend Cutover Implementation Plan

This plan executes the [Rust Backend Hard Cutover PRD](./rust-backend-cutover-prd.md). It is ordered so durable contracts are established before the old backend is removed. There is no dual-backend stage.

## 1. Freeze and inventory

- [x] Inventory root scripts, CI, Docker Compose, docs, and server dependencies.
- [x] Inventory all `/auth`, `/game`, and `/admin` REST routes and browser response types.
- [x] Inventory WebSocket presence, visibility, LOD, transition, and chat behavior.
- [x] Inventory eight Prisma migrations and preserve the local weapon-purchase work.
- [x] Identify user-owned worktree changes and avoid unrelated rewrites.

## 2. Establish Rust contracts

- [x] Add the Cargo workspace, pinned toolchain, shared dependencies, formatting/lint policy, and build metadata.
- [x] Add canonical `proto/world.proto` messages for tickets, joins, input, snapshots, reconciliation, transitions, chat, errors, and health.
- [x] Implement `cc-protocol` with vendored `protoc` generation and frame/size/version helpers.
- [x] Implement `cc-sim-core` with shared fixed-step prediction and native-only Rapier authority.
- [x] Add the raw WASM build/copy script and browser prediction adapter.

## 3. Preserve data and REST product behavior

- [x] Convert migrations 0001–0010 to SQLx without changing live table/column names.
- [x] Add migration 0011 for cell snapshots and fenced epochs.
- [x] Implement Axum startup, configuration, structured tracing, CORS, request limits, and graceful shutdown.
- [x] Implement SQLx/Redis state, migration/version readiness, health, metrics, and rate limits.
- [x] Port password/Discord auth, refresh rotation, reset mail, cookies, and session extractors.
- [x] Port bootstrap, starter grants, appearance, economy, inventory purchase, construction purchase/placement, and assigned-bay APIs.
- [x] Port operator session, users, catalogs, specialized weapon/backpack definitions, and settings APIs.

## 4. Implement authoritative realtime

- [x] Implement deterministic cell IDs, private-instance authorization, visibility, and LOD.
- [x] Implement leased ownership with node/epoch fencing and lease renewal.
- [x] Implement local command channels plus Redis Stream routing to remote owners.
- [x] Implement native Rapier cell ticks, input validation, sequence handling, reconciliation, snapshot generation, and durable checkpoints.
- [x] Implement local broadcast plus Redis snapshot fan-out and bounded backpressure.
- [x] Implement single-use world tickets and authenticated WebTransport sessions.
- [x] Carry reliable control/chat on streams and high-frequency input/snapshots on datagrams.

## 5. Cut over the browser

- [x] Replace the WebSocket URL/API and feature flags with WebTransport session configuration.
- [x] Replace JSON envelopes with the versioned Protobuf codec.
- [x] Load and require shared WASM prediction before realtime connection.
- [x] Preserve interpolation, appearance LOD behavior, chat callbacks, transitions, and remote render types.
- [x] Send sequenced intents and apply epoch/tick/sequence reconciliation.
- [x] Fail clearly when WebTransport or the matching WASM/protocol version is unavailable; provide no WebSocket fallback.

## 6. Deploy and remove the old runtime

- [x] Add production Docker image and local Rust backend service to Compose.
- [x] Add Kubernetes namespace/config, secret example, migration job, deployment, TCP/UDP services, HPA, PDB, and network policy.
- [x] Update GitHub quality checks for Rust format/clippy/build, SQLx migrations, WASM, browser, and docs.
- [x] Update root scripts, lockfiles, environment examples, runbooks, stack/DDD/admin docs, and agent conventions.
- [x] Delete the complete legacy TypeScript/Prisma `server/` workspace and remove its dependencies/scripts.

## 7. Audit and handoff

- [x] Mechanically scan for remaining legacy TypeScript/Prisma/WebSocket runtime artifacts and stale server paths.
- [x] Inspect the final diff for user-owned change preservation and protected-asset safety.
- [x] Run `npm run lint` and fix errors as required by `AGENTS.md`.
- [x] Run Rust check/Clippy/release build plus browser typecheck/WASM/Vite build; do not run tests, browser QA, screenshots, or dev servers.
- [x] Record any environment-only prerequisites such as TLS secrets, UDP load-balancer support, and the WASM Rust target.
