---
sidebar_position: 6
title: Prop definitions
description: Manage hangar and apartment decoration catalog entries.
---

# Prop definitions

A **prop definition** describes a placeable decoration players can own and deploy in personal spaces (hangar, apartment). Each definition points at a bundled prop prefab and carries placement rules and an ARC cost.

Rows are stored in `PropDefinition`. Manage them from the Admin App **Props** tab.

## List view

Search by name, prefab id, or category. Columns:

| Column | Field |
| --- | --- |
| Name | `name` |
| Prefab | `prefabId` |
| Category | `category` (free-text grouping, default `decoration`) |
| Cost (ARC) | `costArc` |
| Max / space | `maxPerHangar` (placement cap per build area) |
| Snap grid | `snapGridM` (metres; `null` or 0 = free placement) |
| Rotate Y | `allowRotateY` |

Click a row to edit, or **Create prop definition** for a new entry.

## Create / edit form

| Field | Validation | Notes |
| --- | --- | --- |
| **Name** | Required, max 80 chars | |
| **Description** | Required, max 2000 chars | |
| **Prop prefab** | Required | Bundled prefabs suitable for props (see `list_prop_prefabs.ts`) |
| **Category** | Max 40 chars | Organize shop or UI groupings |
| **Cost (ARC)** | Integer 0 – 2B | Purchase price |
| **Max per space** | Integer 1 – 64, or empty | Cap per hangar/apartment instance; empty = unlimited |
| **Snap grid (m)** | Float 0.1 – 4, or 0 for free | Grid snap increment when placing |
| **Allow Y rotation** | Yes / No | Whether players can rotate the prop around the vertical axis |

Default values for a new definition match the in-code form defaults: `hangar-crate-01` prefab, 250 ARC, category `decoration`, max 8 per space, 0.5 m snap grid, rotation allowed.

## Starter props

Prop definitions can appear in the **starter props** list on [Game settings](./game-settings). On first bootstrap, matching definitions are granted to the player's prop inventory (`PlayerProp` rows) in the configured order.

## Runtime notes

- Placed props in the world reference `PropDefinition` via `HangarPlacement` with `onDelete: Restrict` — definitions in use cannot be deleted at the database level without clearing placements first.
- The Admin UI does not expose delete for prop definitions (same as ships).
- Prefab ids must match `^[a-z0-9][a-z0-9-]{0,63}$`.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/props` | List all definitions |
| `POST` | `/admin/props` | Create definition |
| `PATCH` | `/admin/props/:id` | Partial update |

See [API reference](./api-reference).
