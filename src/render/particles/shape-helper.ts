import * as THREE from "three";
import type { PrefabParticleShape } from "../../world/prefabs/schema";

export function createParticleShapeHelper(
  shape: PrefabParticleShape,
): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "particle-shape-helper";
  if (!shape.enabled) return group;

  const mat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
  });

  let mesh: THREE.Object3D;
  switch (shape.shape) {
    case "box":
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(shape.box.x, shape.box.y, shape.box.z),
        mat,
      );
      break;
    case "cone": {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(
          shape.radius,
          Math.max(shape.radius, 0.01),
          16,
          1,
          true,
        ),
        mat,
      );
      cone.rotation.x = Math.PI;
      cone.position.y = Math.max(shape.radius, 0.01) * 0.5;
      mesh = cone;
      break;
    }
    case "circle":
    case "edge":
      mesh = new THREE.Mesh(
        new THREE.RingGeometry(shape.radius * 0.92, shape.radius, 32),
        mat,
      );
      mesh.rotation.x = -Math.PI / 2;
      break;
    case "hemisphere":
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(
          shape.radius,
          16,
          8,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        mat,
      );
      break;
    case "sphere":
    default:
      mesh = new THREE.Mesh(new THREE.SphereGeometry(shape.radius, 16, 12), mat);
      break;
  }
  group.add(mesh);

  const icon = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false }),
  );
  group.add(icon);
  return group;
}
