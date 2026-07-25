import * as THREE from "three";
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabTransform,
} from "../../world/prefabs/schema";
import {
  attachParticleSystemToEntity,
  setupUpdateParticles,
} from "./setup";

function applyTransform(object: THREE.Object3D, transform: PrefabTransform): void {
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.quaternion.set(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function attachEntityParticles(
  root: THREE.Group,
  entity: PrefabEntity,
  parent: THREE.Object3D,
): void {
  const group = new THREE.Group();
  group.name = entity.name || entity.id;
  applyTransform(group, entity.transform);
  parent.add(group);

  for (const component of entity.components ?? []) {
    if (component.type === "particle-system") {
      attachParticleSystemToEntity(
        root,
        group,
        component as PrefabComponent & { type: "particle-system" },
      );
    }
  }

  for (const child of entity.children ?? []) {
    attachEntityParticles(root, child, group);
  }
}

/**
 * Attach particle systems from a prefab document onto an existing root
 * (e.g. ship model group) when the full prefab entity tree is not rendered.
 */
export function attachPrefabParticleSystems(
  doc: PrefabDocument,
  root: THREE.Group,
): void {
  setupUpdateParticles(root);
  attachEntityParticles(root, doc.root, root);
}
