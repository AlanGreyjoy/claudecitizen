---
sidebar_position: 4
title: Users
description: Inspect registered accounts and owned ships in the Admin App.
---

# Users

The **Users** tab is a read-only inspector for accounts stored in PostgreSQL. Use it during development to verify sign-ups, starter grants, and ship ownership.

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

The page header notes **read only** — there are no edit, ban, or delete actions in the Admin UI today.

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

## Relationship to game settings

When a player first bootstraps into the online game, the server calls `grantStarterLoadout`. If `starterLoadoutGrantedAt` is still null, the player receives:

- Ships from **starter ship definitions** (see [Game settings](./game-settings))
- Props and items from the corresponding starter lists
- **Starting ARC** added to their balance

After the grant, the timestamp appears in the Users tab. Changing game settings later does **not** retroactively alter players who already received their starter loadout.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/users` | List all users with summary player info |
| `GET` | `/admin/users/:id` | Full user detail including owned ships |

Both require a valid `cc_admin` session. See [API reference](./api-reference).
