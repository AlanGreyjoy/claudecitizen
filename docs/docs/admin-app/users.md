---
sidebar_position: 4
title: Users
description: Inspect registered accounts and owned ships in the Admin App.
---

# Users

The **Users** tab inspects accounts stored in PostgreSQL. Use it during development to verify sign-ups, starter grants, and ship ownership. From a user detail page you can also **assign catalog ships** the player does not already own.

## List view

The table shows every `User` row ordered by creation date (oldest first). Search filters by username, display name, or email.

| Column | Source |
| --- | --- |
| **Handle** | `user.username` |
| **Email** | `user.email` (or — if null) |
| **Display name** | `user.displayName` |
| **ARC balance** | Linked `player.arcBalance` (Asteron Reserve Credits) |
| **Ships** | Count of ships owned by the player |
| **Starter grant** | Timestamp when `player.starterLoadoutGrantedAt` was set |

Account fields themselves are still read-only — there are no edit, ban, or delete actions in the Admin UI today.

## Detail view

Click a row to open the account detail page.

### Account fields

- Username, email, user ID, account created date

### Player fields

Shown when the user has a linked `Player` record (created during game bootstrap):

| Field | Meaning |
| --- | --- |
| **Player handle** | In-game handle |
| **ARC balance** | Current Asteron Reserve Credits |
| **Starter grant** | When the one-time starter loadout was applied (`null` if not yet granted) |
| **Current instance** | Server instance the player is associated with |
| **Current room** | Active room id within that instance |

### Owned ships

A secondary table lists every `Ship` owned by the player:

| Column | Meaning |
| --- | --- |
| **Name** | Ship display name |
| **Prefab** | Client prefab id used for rendering |
| **Definition** | Linked catalog definition name (if any) |
| **HP / Shields** | Current and max values |
| **Instance** | Where the ship is parked (`hangar:<playerId>` for starter ships) |

### Assign a ship

Below the owned-ships table, pick a **Ship definition** from the catalog and click **Assign ship**. The server:

1. Requires a linked `Player` record (bootstrap in-game first if missing)
2. Rejects definitions the player already owns (same `shipDefinitionId` or same `prefabId`)
3. Inserts a full-HP/shields `Ship` parked at `hangar:<playerId>`

Create missing catalog entries under the **Ships** tab first.

## Relationship to game settings

When a player first bootstraps into the online game, the server calls `grantStarterLoadout`. If `starterLoadoutGrantedAt` is still null, the player receives:

- Ships from **starter ship definitions** (see [Game settings](./game-settings))
- Props and items from the corresponding starter lists
- **Starting ARC** added to their balance

After the grant, the timestamp appears in the Users tab. Changing game settings later does **not** retroactively alter players who already received their starter loadout. Use **Assign ship** on the user detail page to grant additional hulls after the fact.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/users` | List all users with summary player info |
| `GET` | `/admin/users/:id` | Full user detail including owned ships |
| `POST` | `/admin/users/:id/ships` | Assign a catalog ship definition to the player's hangar |

All require a valid `cc_admin` session. See [API reference](./api-reference).
