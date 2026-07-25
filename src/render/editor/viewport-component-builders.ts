import type * as THREE from "three";
import type { PrefabComponent } from "../../world/prefabs/schema";
import {
  createViewportShipBuilders,
  type ViewportComponentBuilderDeps,
} from "./viewport-component-builders-ship";
import { createViewportStationBuilders } from "./viewport-component-builders-station";

export type { ViewportComponentBuilderDeps, ViewportHelperMeshFactory } from "./viewport-component-builders-ship";

export function createViewportComponentBuilders(deps: ViewportComponentBuilderDeps): {
  buildComponentHelper: (
    component: PrefabComponent,
    meshColliderTarget?: THREE.Object3D,
  ) => THREE.Object3D | null;
} {
  const station = createViewportStationBuilders(deps);
  const ship = createViewportShipBuilders(deps);
  const componentHelperBuilders = {
    ...station.builders,
    ...ship,
  };

  function buildComponentHelper(
    component: PrefabComponent,
    meshColliderTarget?: THREE.Object3D,
  ): THREE.Object3D | null {
    if (component.type === "collider") {
      return station.buildColliderHelper(component, meshColliderTarget);
    }
    const builder = componentHelperBuilders[component.type];
    return builder ? builder(component) : null;
  }

  return { buildComponentHelper };
}
