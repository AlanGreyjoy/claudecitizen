---
sidebar_position: 11
title: Material manager
description: Batch-edit PBR material overrides across the prefab scene.
---

# Material manager

The **Material Manager** tab lists every material slot in the current prefab scene and lets you tune PBR properties without selecting each entity individually.

Open it from the center column tab bar (**Material Manager**).

## Material rows

Each row represents one material on one entity:

| Column | Meaning |
| --- | --- |
| **Entity** | Owning hierarchy entity |
| **Source** | `Primitive` or `Asset` |
| **Material** | Three.js material name (or `Primitive` for box entities) |
| **Overridden** | Whether this row differs from the imported GLB defaults |

Primitives use the special material name `__primitive__` internally.

## Editable properties

Per row you can override:

| Property | Description |
| --- | --- |
| **Color** | Base albedo (`#rrggbb`) |
| **Emissive** | Emissive color |
| **Emissive intensity** | Glow strength |
| **Metalness** | PBR metalness 0–1 |
| **Roughness** | PBR roughness 0–1 |
| **Opacity** | Transparency 0–1 |

Changes apply live in the Scene viewport and serialize to `materialOverrides[]` on the entity in prefab JSON.

## Workflow

1. Build the scene with GLBs and primitives in the **Scene** tab
2. Switch to **Material Manager**
3. Filter visually or scan the list for the material you need
4. Adjust sliders/color pickers — overrides mark the row as overridden
5. Save the prefab — overrides round-trip through `serialize.ts`

## Runtime

`applyPrefabMaterialOverrides` in `prefab_renderer.ts` applies the same overrides at game runtime, so WYSIWYG holds between editor and play.

## When to use vs Inspector

| Task | Tool |
| --- | --- |
| Tune one entity you already selected | Inspector (if exposed) |
| Find and tweak a material across many entities | Material Manager |
| Box primitive color | Inspector primitive fields **or** Material Manager |

## Performance note

Material overrides are cheap — they mutate existing Three.js materials rather than duplicating geometry. Prefer overrides over editing source GLBs for iteration speed.

## Related

- [Building scenes](./building-scenes) — primitives and GLB entities
- [Assets and GLB](./assets-and-glb) — source asset paths
