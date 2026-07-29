---
sidebar_position: 11
title: Material manager
description: Edit and batch-apply PBR material overrides across the open document.
---

# Material manager

The **Material Manager** tab lists every material slot in the current prefab or
scene and lets you tune PBR properties without hunting each entity in the
hierarchy.

Open it from the center column tab bar (**Material Manager**).

## Material list

Each row is one material on one entity. The list shows:

- A **checkbox** for batch targeting (independent of focus)
- A **color swatch** (textured materials get a corner marker)
- The **material name**, with a subtitle of `entity · Primitive|Asset` and an
  `override` tag when values differ from the asset defaults

Click a row to **focus** it — that drives the side inspector and live viewport
scrub. Checkboxes do not change focus.

Use the **select-all** checkbox in the toolbar to check or clear every visible
row. The status line reports how many materials are checked.

Primitives use the special material name `__primitive__` internally.

## Editable properties

Per focused material you can override:

| Property | Description |
| --- | --- |
| **Color** | Base albedo (`#rrggbb`) |
| **Emissive** | Emissive color |
| **Emissive intensity** | Glow strength |
| **Metalness** | PBR metalness 0–1 |
| **Roughness** | PBR roughness 0–1 |
| **Opacity** | Transparency 0–1 |

Scrubbing applies a live preview on the focused entity; releasing the control
commits an override to that slot. Overrides serialize to `materialOverrides[]`
on the entity in prefab JSON.

## Batch apply

To copy the focused material’s current settings onto several others:

1. Focus the material whose values you want (edit them first if needed)
2. Check the target rows (or select all)
3. Click **Apply to N checked** in the inspector

That writes one undoable batch. Live scrubbing still only affects the focused
row. **Reset Override** clears the focused slot only.

## Workflow

1. Build the scene with GLBs and primitives in the **Scene** tab
2. Switch to **Material Manager**
3. Focus a material and tune sliders/color pickers
4. Optionally check other rows and **Apply to N checked**
5. Save the document — overrides round-trip through `serialize.ts`

## Runtime

`applyPrefabMaterialOverrides` in `prefab-renderer.ts` applies the same
overrides at game runtime, so WYSIWYG holds between editor and play.

## When to use vs Inspector

| Task | Tool |
| --- | --- |
| Tune one entity you already selected | Inspector (if exposed) |
| Find and tweak a material across many entities | Material Manager |
| Same settings on many materials | Material Manager checkboxes + Apply |
| Box primitive color | Inspector primitive fields **or** Material Manager |

## Performance note

Material overrides are cheap — they mutate existing Three.js materials rather
than duplicating geometry. Prefer overrides over editing source GLBs for
iteration speed.

## Related

- [Building scenes](./building-scenes) — primitives and GLB entities
- [Assets and GLB](./assets-and-glb) — source asset paths
