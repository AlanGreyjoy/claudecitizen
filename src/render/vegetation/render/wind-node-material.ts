import type * as THREE from 'three';
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type StorageInstancedBufferAttribute,
} from 'three/webgpu';
import {
  clamp,
  cos,
  instanceIndex,
  positionGeometry,
  sin,
  storage,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  getWindMaterialOptions,
  type InstancedWindMaterialFactory,
} from './wind';

type SupportedWindNodeMaterial =
  | MeshBasicNodeMaterial
  | MeshLambertNodeMaterial
  | MeshPhysicalNodeMaterial
  | MeshStandardNodeMaterial;

const READ_ONLY_OR_LEGACY_KEYS = new Set([
  'customProgramCacheKey',
  'id',
  'onBeforeCompile',
  'type',
  'uuid',
  'version',
]);

function createMatchingNodeMaterial(
  source: THREE.Material,
): SupportedWindNodeMaterial | null {
  const typed = source as THREE.Material & {
    isMeshBasicMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshPhysicalMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
  };
  let target: SupportedWindNodeMaterial;
  if (typed.isMeshPhysicalMaterial) {
    target = new MeshPhysicalNodeMaterial();
  } else if (typed.isMeshStandardMaterial) {
    target = new MeshStandardNodeMaterial();
  } else if (typed.isMeshLambertMaterial) {
    target = new MeshLambertNodeMaterial();
  } else if (typed.isMeshBasicMaterial) {
    target = new MeshBasicNodeMaterial();
  } else {
    return null;
  }

  // This mirrors WebGPURenderer's classic-material conversion, but preserves
  // the node material's identity and callbacks. The material-specific
  // properties created by the node constructors (maps, colors, roughness,
  // alpha test, and so on) receive the exact source values.
  const sourceRecord = source as unknown as Record<string, unknown>;
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key in sourceRecord) {
    if (
      key.startsWith('is') ||
      READ_ONLY_OR_LEGACY_KEYS.has(key) ||
      !(key in targetRecord)
    ) {
      continue;
    }
    targetRecord[key] = sourceRecord[key];
  }
  target.name = source.name ? `${source.name}-wind-node` : 'vegetation-wind-node';
  return target;
}

/**
 * Creates the TSL equivalent of the legacy vegetation wind patch.
 *
 * This runs after an `InstancedMesh` is allocated. Binding the node graph to
 * that mesh's instance buffer preserves the legacy transform order exactly:
 * bend in asset-local space first, then apply instance scale/rotation/position.
 * The built-in TSL `time` node keeps WebGPU previews animated without coupling
 * their render loop to the WebGL wind uniform.
 */
export const createWebGpuWindMaterial: InstancedWindMaterialFactory = (
  source,
  instanceMatrix,
) => {
  const options = getWindMaterialOptions(source);
  if (!options) return source;

  const material = createMatchingNodeMaterial(source);
  if (!material) return source;

  // Read the live matrix attribute through a storage binding. A second vertex
  // binding can exceed WebGPU's portable eight-buffer limit on rich GLTFs, and
  // a copied attribute wrapper would not follow later matrix version updates.
  const instanceMatrixNode = storage(
    instanceMatrix as unknown as StorageInstancedBufferAttribute,
    'mat4',
    Math.max(instanceMatrix.count, 1),
  )
    .toReadOnly()
    .element(instanceIndex);
  const heightInv = uniform(1 / options.referenceHeight);
  const speed = uniform(options.speed ?? 1);
  const strength = uniform(options.strength);

  const windBend = clamp(positionGeometry.y.mul(heightInv), 0, 1).pow(2);
  const windRef = instanceMatrixNode[3].xyz;
  const windPhase = windRef.dot(vec3(0.317, 0.171, 0.233));
  const windTime = time.mul(speed).add(windPhase);
  const swayX = sin(windTime)
    .mul(0.55)
    .add(sin(windTime.mul(2.13).add(1.7)).mul(0.25))
    .add(sin(windTime.mul(0.37).add(4.2)).mul(0.45));
  const swayZ = cos(windTime.mul(0.79).add(2.3))
    .mul(0.5)
    .add(sin(windTime.mul(1.53).add(0.9)).mul(0.3));
  const localOffset = vec4(
    swayX.mul(windBend).mul(strength),
    0,
    swayZ.mul(windBend).mul(strength).mul(0.7),
    0,
  );

  material.positionNode = instanceMatrixNode
    .mul(vec4(positionGeometry, 1))
    .add(instanceMatrixNode.mul(localOffset))
    .xyz;
  return material;
};
