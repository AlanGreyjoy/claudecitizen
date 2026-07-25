import * as THREE from "three";
import type { EditorEntity, EditorStore } from "../../editor/document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type { ViewportResourceTracker } from "./viewport_component_helpers";

interface NpcRouteLine {
  from: THREE.Object3D;
  to: THREE.Object3D;
  position: THREE.BufferAttribute;
}

export interface ViewportNpcRoutes {
  build: () => void;
  update: () => void;
  clear: () => void;
}

export function createViewportNpcRoutes(
  store: EditorStore,
  entityRoot: THREE.Group,
  objectsById: Map<string, THREE.Group>,
  track: ViewportResourceTracker,
): ViewportNpcRoutes {
  const npcRouteLines: NpcRouteLine[] = [];
  const npcRoutePointA = new THREE.Vector3();
  const npcRoutePointB = new THREE.Vector3();

  function updateNpcRouteLines(): void {
    for (const route of npcRouteLines) {
      route.from.getWorldPosition(npcRoutePointA);
      route.to.getWorldPosition(npcRoutePointB);
      entityRoot.worldToLocal(npcRoutePointA);
      entityRoot.worldToLocal(npcRoutePointB);
      route.position.setXYZ(
        0,
        npcRoutePointA.x,
        npcRoutePointA.y + 0.28,
        npcRoutePointA.z,
      );
      route.position.setXYZ(
        1,
        npcRoutePointB.x,
        npcRoutePointB.y + 0.28,
        npcRoutePointB.z,
      );
      route.position.needsUpdate = true;
    }
  }

  function buildNpcRouteLines(): void {
    npcRouteLines.length = 0;
    const waypoints = new Map<
      string,
      {
        component: Extract<PrefabComponent, { type: "npc-waypoint" }>;
        object: THREE.Object3D;
      }
    >();
    const visit = (entities: readonly EditorEntity[]): void => {
      for (const entity of entities) {
        const component = entity.components.find(
          (candidate): candidate is Extract<PrefabComponent, { type: "npc-waypoint" }> =>
            candidate.type === "npc-waypoint",
        );
        const object = objectsById.get(entity.id);
        if (component && object) waypoints.set(component.id, { component, object });
        visit(entity.children);
      }
    };
    visit(store.getState().roots);

    const material = track(
      new THREE.LineBasicMaterial({
        color: 0xc39bff,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    const edges = new Set<string>();
    for (const [id, waypoint] of waypoints) {
      for (const linkedId of waypoint.component.links) {
        const linked = waypoints.get(linkedId);
        if (
          !linked ||
          linked.component.routeGroup !== waypoint.component.routeGroup ||
          linked.component.floorId !== waypoint.component.floorId
        ) {
          continue;
        }
        const edgeKey = [id, linkedId].sort().join("\u0000");
        if (edges.has(edgeKey)) continue;
        edges.add(edgeKey);
        const geometry = track(new THREE.BufferGeometry());
        const position = new THREE.BufferAttribute(new Float32Array(6), 3);
        geometry.setAttribute("position", position);
        const line = new THREE.Line(geometry, material);
        line.frustumCulled = false;
        line.renderOrder = 3;
        entityRoot.add(line);
        npcRouteLines.push({
          from: waypoint.object,
          to: linked.object,
          position,
        });
      }
    }
    updateNpcRouteLines();
  }

  return {
    build: buildNpcRouteLines,
    update: updateNpcRouteLines,
    clear() {
      npcRouteLines.length = 0;
    },
  };
}
