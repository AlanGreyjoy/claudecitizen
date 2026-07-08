---
sidebar_position: 8
title: Game settings
description: Configure starting ARC and starter loadouts for new players.
---

# Game settings

**Game settings** is a singleton row (`GameSettings` id `"singleton"`) that controls what new players receive when they first bootstrap into the online game. Edit it from the Admin App **Game Settings** tab.

## Fields

### Starting ARC

**Starting Asteron Reserve Credits (ARC)** — integer balance granted once as part of the starter loadout. Range: 0 – 2,000,000,000.

ARC is the in-game currency tracked on `player.arcBalance`.

### Starter ships

Ordered list of [ship definition](./ship-definitions) ids. Rules:

- **At least one** starter ship is required when saving settings.
- **Order matters** — the first entry is the default primary ship.
- Grants run **once** per player when `starterLoadoutGrantedAt` is still null.
- Use **Add**, **Up**, **Down**, and **Remove** to manage the list.

The UI copy notes: *"Starter ships are granted once on first bootstrap. Order matters — first entry is the default primary ship."*

### Starter props

Ordered list of [prop definition](./prop-definitions) ids. Optional — can be empty. Each listed prop is added to the player's prop inventory on first grant.

### Starter items

Ordered list of [item definition](./item-definitions) ids. Optional — can be empty. Each listed item is granted at quantity 1.

## Grant flow

When a player signs in and the game service bootstraps their session:

1. `grantStarterLoadout` runs inside a database transaction.
2. If `player.starterLoadoutGrantedAt` is already set, the function returns immediately — **no second grant**.
3. Otherwise it creates:
   - `Ship` rows for each starter ship definition (parked in `hangar:<playerId>`)
   - `PlayerProp` rows for starter props
   - `PlayerItem` rows (qty 1) for starter items
   - Updates `arcBalance` with `startingArcBalance`
   - Sets `starterLoadoutGrantedAt` to the current timestamp

You can verify grants in the [Users](./users) tab.

## Saving settings

Click **Save settings** to `PUT /admin/settings`. The server validates that:

- Every id in `starterShipDefinitionIds` exists in the ship catalog
- Every id in `starterPropDefinitionIds` exists in the prop catalog (if any)
- Every id in `starterItemDefinitionIds` exists in the item catalog (if any)
- At least one starter ship is selected

Changing settings affects **only future first-time grants**. Players who already received a starter loadout keep what they have.

## Fresh database bootstrap

If no `GameSettings` row exists yet, the server creates one on first access. When the ship catalog is empty, it may seed a fallback starter from the first available ship definition after catalog setup.

Typical local workflow:

1. Create at least one ship definition (e.g. Phobos Starhopper → `phobos-starhopper` prefab).
2. Open Game Settings and confirm that ship is in the starter list.
3. Set starting ARC as desired.
4. Sign up a test player and confirm the grant in Users.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/settings` | Read current settings |
| `PUT` | `/admin/settings` | Replace settings fields |

See [API reference](./api-reference) for the request body.
