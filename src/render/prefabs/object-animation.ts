import * as THREE from "three";
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabTransform,
} from "../../world/prefabs/schema";

export type ObjectAnimationComponent = PrefabComponent & {
  type: "object-animation";
};

interface BoundObjectAnimationTarget {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
}

interface BoundObjectAnimation {
  id: string;
  mode: "spin" | "hover";
  axis: "x" | "y" | "z";
  speed: number;
  amplitude: number;
  phase: number;
  reverse: boolean;
  elapsed: number;
  targets: BoundObjectAnimationTarget[];
}

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

const objectAnimationBindAttempts = new WeakMap<
  ObjectAnimationComponent,
  number
>();

function sanitizeNodeName(name: string): string {
  return name.trim();
}

function defaultSpeed(mode: "spin" | "hover", speed: number | undefined): number {
  if (speed !== undefined) return speed;
  return mode === "spin" ? 0.4 : 0.5;
}

function applyTransform(
  object: THREE.Object3D,
  transform: PrefabTransform,
): void {
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

/** Install continuous object-animation updates on a prefab root group. */
export function setupUpdateObjectAnimations(root: THREE.Group): void {
  root.userData.boundObjectAnimations = [] as BoundObjectAnimation[];
  root.userData.pendingObjectAnimations = [] as Array<{
    component: ObjectAnimationComponent;
    target: THREE.Object3D;
  }>;

  const rotationScratch = new THREE.Quaternion();
  const axisScratch = new THREE.Vector3();

  root.userData.updateObjectAnimations = (dt: number) => {
    const pending = root.userData.pendingObjectAnimations as
      | Array<{ component: ObjectAnimationComponent; target: THREE.Object3D }>
      | undefined;
    if (pending && pending.length > 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const entry = pending[i];
        bindObjectAnimationComponent(root, entry.target, entry.component);
      }
    }

    const bound = root.userData.boundObjectAnimations as
      | BoundObjectAnimation[]
      | undefined;
    if (!bound || bound.length === 0) return;

    for (const anim of bound) {
      anim.elapsed += dt;
      if (anim.mode === "spin") {
        const signedSpeed = anim.reverse ? -anim.speed : anim.speed;
        const angle = anim.phase + signedSpeed * anim.elapsed;
        rotationScratch.setFromAxisAngle(AXIS_VECTORS[anim.axis], angle);
        for (const target of anim.targets) {
          target.object.quaternion
            .copy(target.baseQuaternion)
            .multiply(rotationScratch);
        }
      } else {
        const offset =
          anim.amplitude *
          Math.sin(anim.phase + Math.PI * 2 * anim.speed * anim.elapsed);
        axisScratch.copy(AXIS_VECTORS[anim.axis]).multiplyScalar(offset);
        for (const target of anim.targets) {
          target.object.position.copy(target.basePosition).add(axisScratch);
        }
      }
    }
  };

  root.userData.refreshObjectAnimationBase = (
    object: THREE.Object3D,
  ): void => {
    const bound = root.userData.boundObjectAnimations as
      | BoundObjectAnimation[]
      | undefined;
    if (!bound) return;
    for (const anim of bound) {
      for (const target of anim.targets) {
        if (target.object !== object) continue;
        target.basePosition.copy(object.position);
        target.baseQuaternion.copy(object.quaternion);
      }
    }
  };
}

function captureTarget(object: THREE.Object3D): BoundObjectAnimationTarget {
  return {
    object,
    basePosition: object.position.clone(),
    baseQuaternion: object.quaternion.clone(),
  };
}

function resolveObjectAnimationTargets(
  rootGroup: THREE.Group,
  targetObject: THREE.Object3D,
  nodeSpecs: { name: string }[],
): { targets: BoundObjectAnimationTarget[]; allFound: boolean } {
  if (nodeSpecs.length === 0) {
    return { targets: [captureTarget(targetObject)], allFound: true };
  }

  const targets: BoundObjectAnimationTarget[] = [];
  let allFound = true;
  for (const nodeSpec of nodeSpecs) {
    const safeName = sanitizeNodeName(nodeSpec.name);
    if (!safeName) {
      allFound = false;
      continue;
    }
    const object =
      targetObject.getObjectByName(safeName) ??
      rootGroup.getObjectByName(safeName);
    if (!object) {
      allFound = false;
      continue;
    }
    targets.push(captureTarget(object));
  }
  return { targets, allFound };
}

type PendingObjectAnimation = {
  component: ObjectAnimationComponent;
  target: THREE.Object3D;
};

function queuePendingObjectAnimation(
  pending: PendingObjectAnimation[],
  component: ObjectAnimationComponent,
  targetObject: THREE.Object3D,
): void {
  const attempts = (objectAnimationBindAttempts.get(component) ?? 0) + 1;
  objectAnimationBindAttempts.set(component, attempts);
  if (!pending.some((entry) => entry.component === component)) {
    pending.push({ component, target: targetObject });
  }
  if (attempts !== 300) return;

  console.warn(
    `Object animation node not found after 300 attempts: ${(component.nodes ?? [])
      .map((node) => node.name)
      .join(", ")} under ${targetObject.name || "target"} or root`,
  );
  const idx = pending.findIndex((entry) => entry.component === component);
  if (idx !== -1) pending.splice(idx, 1);
}

export function bindObjectAnimationComponent(
  rootGroup: THREE.Group | undefined,
  targetObject: THREE.Object3D,
  component: ObjectAnimationComponent,
): void {
  if (!rootGroup) return;

  const bound = rootGroup.userData.boundObjectAnimations as
    | BoundObjectAnimation[]
    | undefined;
  if (bound?.some((entry) => entry.id === component.id)) return;

  const { targets, allFound } = resolveObjectAnimationTargets(
    rootGroup,
    targetObject,
    component.nodes ?? [],
  );
  const pending = rootGroup.userData.pendingObjectAnimations as
    | PendingObjectAnimation[]
    | undefined;

  if (allFound && targets.length > 0) {
    bound?.push({
      id: component.id,
      mode: component.mode,
      axis: component.axis,
      speed: defaultSpeed(component.mode, component.speed),
      amplitude: component.amplitude ?? 0.08,
      phase: component.phase ?? 0,
      reverse: Boolean(component.reverse),
      elapsed: 0,
      targets,
    });
    if (pending) {
      const idx = pending.findIndex((entry) => entry.component === component);
      if (idx !== -1) pending.splice(idx, 1);
    }
    objectAnimationBindAttempts.delete(component);
    return;
  }

  if (pending) {
    queuePendingObjectAnimation(pending, component, targetObject);
  }
}

function attachEntityObjectAnimations(
  root: THREE.Group,
  entity: PrefabEntity,
  parent: THREE.Object3D,
): void {
  const group = new THREE.Group();
  group.name = entity.name || entity.id;
  applyTransform(group, entity.transform);
  parent.add(group);

  for (const component of entity.components ?? []) {
    if (component.type === "object-animation") {
      bindObjectAnimationComponent(root, group, component);
    }
  }

  for (const child of entity.children ?? []) {
    attachEntityObjectAnimations(root, child, group);
  }
}

/**
 * Attach object-animation components from a prefab onto an existing root
 * (e.g. ship model group) when the full prefab entity tree is not rendered.
 */
export function attachPrefabObjectAnimations(
  doc: PrefabDocument,
  root: THREE.Group,
): void {
  setupUpdateObjectAnimations(root);
  attachEntityObjectAnimations(root, doc.root, root);
}
