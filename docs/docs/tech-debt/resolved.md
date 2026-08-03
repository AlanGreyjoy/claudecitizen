---
sidebar_position: 99
title: Resolved
description: Closed tech-debt items — kept for history and so we do not reintroduce the same trap.
---

# Resolved tech debt

Living log of debt that was fixed or deliberately retired. Newest first.

When an open item under [Tech Debt](/tech-debt) ships for real:

1. Add a short entry below (symptom → fix → key files → date).
2. Delete (or fold into) the open page so the sidebar only shows live debt.
3. Do not resurrect the old workaround without reading the entry.

---

## GTAO / Denoise depth must stay a TextureNode

| | |
| --- | --- |
| Resolved | 2026-08-03 |
| Was | Prod black screen with `THREE.TSL: this.depthNode.sample is not a function` |
| Fix | Pass `rawSceneDepth` (`scenePass.getTextureNode('depth')`) into `ao()` / `denoise()`; keep the empty→far remapped float only for atmosphere / night / fog sky gates |

Empty WebGPU depth texels read ~0; sky gates want conventional far = 1, so the post stack wraps depth in an `Fn` float. GTAO and Denoise call `.sample(uv)` on their depth argument and require a TextureNode. Feeding them the remapped float crashed the post stack every frame when AO was on (balanced/high) — canvas black, HUD still alive.

**Code:** `src/render/main/post/webgpu-post-stack.ts`  
**Contrast:** ship sandbox already passed the raw texture node (`src/app/ship_sandbox/scene.ts`).

**Do not:** wrap depth in `Fn` before handing it to any Three display node that samples (`ao`, `denoise`, SSR, etc.). Remap in a separate node for consumers that only need a float.
