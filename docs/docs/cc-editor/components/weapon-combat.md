---
sidebar_position: 34
title: Weapon combat
description: Assigns weapon fire, dry-fire, reload, and hit-decal presentation assets.
---

# Weapon combat

Assigns prefab-owned presentation assets for a weapon item. Add it once to the weapon visual entity or to a dedicated empty.

| Property | Value |
| --- | --- |
| Prefab kind | Item |
| Marker | No |
| Singleton | Yes — at most one per document |

## Fields

| Field | Asset type | Notes |
| --- | --- | --- |
| `fireSoundUrl` | Audio | Fire one-shot (`.ogg`, `.mp3`, `.wav`, `.m4a`) |
| `dryFireSoundUrl` | Audio | Empty-magazine click |
| `reloadSoundUrl` | Audio | Reload one-shot |
| `hitDecalUrl` | Image | World hit decal (`.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, `.ktx`) |

All fields are nullable. Drag assets from the Project panel onto the Inspector fields, type a bundled absolute asset path, or use **Clear** to set a field back to `null`. Empty strings normalize to `null` on load.

Do not commit protected audio or texture binaries. The component stores URL references only.

## Ownership boundary

This component owns presentation assets. Combat balance is configured in **Admin → Weapons**:

- ammo item definition
- magazine size and fire modes
- rounds per minute
- muzzle velocity, bullet gravity, maximum range, and future damage

## Example

```json
{
  "type": "weapon-combat",
  "fireSoundUrl": null,
  "dryFireSoundUrl": null,
  "reloadSoundUrl": null,
  "hitDecalUrl": null
}
```

## See also

- [Muzzle flash](./muzzle-flash)
- [Barrel end](./barrel-end)
- Admin App [item definitions](/admin-app/item-definitions#weapon-combat-fields)
