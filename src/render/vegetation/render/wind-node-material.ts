import type * as THREE from 'three';
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import {
  clamp,
  cos,
  positionGeometry,
  positionLocal,
  sin,
  time,
  uniform,
  vec3,
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
 * One converted node material per source material, shared by every
 * `InstancedMesh` that draws it.
 *
 * This cache is load-bearing for frame pacing, not just for memory. A node
 * material's program cache key is `NodeMaterial.customProgramCacheKey()`, which
 * hashes `getCacheKey()` of every assigned node child — and `Node.customCacheKey()`
 * returns `this.id`, a globally unique per-node-instance number. So two
 * materials built from identical TSL still hash differently, miss
 * `Nodes.nodeBuilderCache`, and each trigger a full WGSL build plus a
 * *synchronous* `device.createRenderPipeline`. Per-mesh materials therefore
 * meant a driver shader compile every time a vegetation tile streamed in.
 */
const windMaterialBySource = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Creates the TSL equivalent of the legacy vegetation wind patch.
 *
 * Unlike the WebGL patch, this does **not** bind the mesh's instance matrix.
 * `NodeMaterial.setupPosition` runs three's own `instancedMesh()` node before
 * it evaluates `positionNode`, so `positionLocal` already holds the
 * instance-transformed position by the time this graph is reached. Letting
 * three own the instance transform is what keeps the graph free of per-mesh
 * nodes — three's `InstanceNode` is pushed on the builder stack rather than
 * assigned as a material child, so its storage binding never enters the
 * program cache key.
 *
 * The built-in TSL `time` node keeps WebGPU previews animated without coupling
 * their render loop to the WebGL wind uniform.
 */
export const createWebGpuWindMaterial: InstancedWindMaterialFactory = (
  source,
) => {
  const cached = windMaterialBySource.get(source);
  if (cached) return cached;

  const options = getWindMaterialOptions(source);
  if (!options) return source;

  const material = createMatchingNodeMaterial(source);
  if (!material) return source;

  const heightInv = uniform(1 / options.referenceHeight);
  const speed = uniform(options.speed ?? 1);
  const strength = uniform(options.strength);

  // Bend ramps from 0 at the asset's base to full at its reference height, so
  // plants stay rooted and only their tops move.
  const windBend = clamp(positionGeometry.y.mul(heightInv), 0, 1).pow(2);
  // Phase reference. The WebGL path reads the instance translation directly;
  // here the instance matrix is three's to own, so the plant's own geometry
  // offset is subtracted back out of the already-instanced position. The
  // residual is the instance origin up to the asset's own extent, which is
  // ample to decorrelate neighbouring plants — and any leftover variation is
  // scaled by `windBend`, so it vanishes at the base where it would be visible
  // as shear.
  const windRef = positionLocal.sub(positionGeometry);
  const windPhase = windRef.dot(vec3(0.317, 0.171, 0.233));
  const windTime = time.mul(speed).add(windPhase);
  const swayX = sin(windTime)
    .mul(0.55)
    .add(sin(windTime.mul(2.13).add(1.7)).mul(0.25))
    .add(sin(windTime.mul(0.37).add(4.2)).mul(0.45));
  const swayZ = cos(windTime.mul(0.79).add(2.3))
    .mul(0.5)
    .add(sin(windTime.mul(1.53).add(0.9)).mul(0.3));

  // Displacement is applied in the instanced frame. Vegetation instances are
  // composed with uniform scale and a yaw about the surface normal, so the
  // horizontal sway axes survive the transform without needing its basis.
  material.positionNode = positionLocal.add(
    vec3(
      swayX.mul(windBend).mul(strength),
      0,
      swayZ.mul(windBend).mul(strength).mul(0.7),
    ),
  );
  windMaterialBySource.set(source, material);
  return material;
};
