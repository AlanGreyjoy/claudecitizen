import * as THREE from 'three';
import type { RenderShipInstance } from '../../../types';
import { getShipLayoutForPrefab } from '../../../player/ship_layout';
import { createShipModel, type ShipModelHandle } from './ship_model';
import { updateShipPlacement } from '../update/sun_system';

export interface ShipRenderPool {
  sync: (
    ships: RenderShipInstance[],
    activeShipId: string | undefined,
    focusPosition: { x: number; y: number; z: number },
    renderScale: number,
  ) => void;
  getActiveGroup: () => THREE.Group;
  dispose: () => void;
}

export function createShipRenderPool(scene: THREE.Scene, renderScale: number): ShipRenderPool {
  const models = new Map<string, ShipModelHandle>();
  let activeGroup: THREE.Group | null = null;

  function ensureModel(ship: RenderShipInstance): ShipModelHandle {
    let handle = models.get(ship.id);
    if (handle) return handle;

    const layout = getShipLayoutForPrefab(ship.prefabId);
    handle = createShipModel(renderScale, {
      hullUrl: layout.hullUrl,
      doors: layout.doors.map((door) => ({
        id: door.id,
        motion: door.motion,
        axis: door.axis,
        nodes: door.nodes,
      })),
      gearHinges: layout.spec.gearHinges,
      rampHinge: layout.spec.rampHinge,
    });
    handle.group.frustumCulled = false;
    scene.add(handle.group);
    models.set(ship.id, handle);
    return handle;
  }

  return {
    sync(ships, activeShipId, focusPosition, scale) {
      const seen = new Set<string>();
      for (const ship of ships) {
        seen.add(ship.id);
        const handle = ensureModel(ship);
        updateShipPlacement(handle.group, ship.body, focusPosition, scale);
        handle.setArticulation({
          gear01: ship.rig.gear01,
          ramp01: ship.rig.ramp01,
          doors: ship.rig.doors,
        });
        if (ship.id === activeShipId) activeGroup = handle.group;
      }

      for (const [id, handle] of models) {
        if (!seen.has(id)) {
          scene.remove(handle.group);
          models.delete(id);
        }
      }

      if (!activeGroup && ships.length > 0) {
        const first = models.get(ships[0].id);
        activeGroup = first?.group ?? null;
      }
    },
    getActiveGroup() {
      if (!activeGroup) {
        activeGroup = new THREE.Group();
        activeGroup.frustumCulled = false;
        scene.add(activeGroup);
      }
      return activeGroup;
    },
    dispose() {
      for (const handle of models.values()) {
        scene.remove(handle.group);
      }
      models.clear();
      activeGroup = null;
    },
  };
}
