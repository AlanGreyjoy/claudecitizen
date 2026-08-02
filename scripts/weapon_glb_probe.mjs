/**
 * Geometry probe for the Synty weapon packs.
 *
 * Reads real vertex data out of a GLB (not just accessor AABBs) so the weapon
 * prefab generator can place `barrel-end` / `muzzle-flash` on the actual bore
 * instead of guessing from the bounding box.
 *
 *   node scripts/weapon_glb_probe.mjs path/to/SM_Wep_Assault_01.glb
 */
import { readFileSync } from 'node:fs';

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function compose(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function matMul(a, b) {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1)
    for (let j = 0; j < 4; j += 1)
      for (let k = 0; k < 4; k += 1) out[i * 4 + j] += b[i * 4 + k] * a[k * 4 + j];
  return out;
}

const applyMatrix = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];

/** Every world-space vertex in the GLB, tagged with the mesh node it came from. */
export function readWeaponGeometry(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`Not a GLB: ${path}`);
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  // Chunk 1 (BIN) follows the JSON chunk, both 4-byte aligned.
  const binStart = 20 + jsonLength + 8;
  const nodes = gltf.nodes ?? [];

  const readAccessor = (index) => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const componentSize = COMPONENT_SIZE[accessor.componentType];
    const components = TYPE_COUNT[accessor.type];
    const stride = view.byteStride || componentSize * components;
    const base = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const out = [];
    for (let i = 0; i < accessor.count; i += 1) {
      const at = base + i * stride;
      out.push([
        buf.readFloatLE(at),
        buf.readFloatLE(at + 4),
        buf.readFloatLE(at + 8),
      ]);
    }
    return out;
  };

  const vertices = [];
  const parts = [];
  const visit = (index, parent) => {
    const node = nodes[index];
    const world = matMul(
      parent,
      node.matrix ?? compose(node.translation, node.rotation, node.scale),
    );
    if (node.mesh !== undefined) {
      const name = node.name ?? `#${index}`;
      const start = vertices.length;
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.attributes.POSITION === undefined) continue;
        for (const v of readAccessor(prim.attributes.POSITION)) {
          vertices.push(applyMatrix(world, v));
        }
      }
      parts.push({ name, start, end: vertices.length });
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const scene of gltf.scenes ?? []) for (const n of scene.nodes ?? []) visit(n, identity);
  return { vertices, parts };
}

export function boundsOf(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) {
    for (let a = 0; a < 3; a += 1) {
      if (v[a] < min[a]) min[a] = v[a];
      if (v[a] > max[a]) max[a] = v[a];
    }
  }
  return { min, max, size: max.map((m, i) => m - min[i]) };
}

/**
 * Bore exit for a +Z-forward weapon.
 *
 * Averages the frontmost ring of vertices — the muzzle face itself. The ring
 * starts thin (2mm) and widens only until it holds enough vertices to be a
 * real face, because a thicker slice starts catching the frame and trigger
 * guard behind the barrel and drags the result low: on SM_Wep_Pistol_06 a 4%
 * slice reads y=0.016 against the barrel's actual 0.070. Magazines, stocks and
 * grips are dropped by name first, since a forward-mounted magazine sits as
 * far up the barrel as the muzzle does.
 */
export function findMuzzle(path, { minRingVertices = 24, maxSliceFraction = 0.04 } = {}) {
  const { vertices, parts } = readWeaponGeometry(path);
  const excluded = /mag|stock|grip|clip|handle|trigger/i;
  const keep = new Set();
  for (const part of parts) {
    if (excluded.test(part.name)) continue;
    for (let i = part.start; i < part.end; i += 1) keep.add(i);
  }
  const usable = keep.size > 0 ? [...keep].map((i) => vertices[i]) : vertices;

  const bounds = boundsOf(usable);
  const maxEpsilon = Math.max(bounds.size[2] * maxSliceFraction, 1e-4);
  let sample = [];
  for (let epsilon = 0.002; epsilon <= maxEpsilon; epsilon *= 1.6) {
    sample = usable.filter((v) => v[2] >= bounds.max[2] - epsilon);
    if (sample.length >= minRingVertices) break;
  }
  if (sample.length < 3) sample = usable;

  let x = 0;
  let y = 0;
  for (const v of sample) {
    x += v[0];
    y += v[1];
  }
  return {
    position: { x: x / sample.length, y: y / sample.length, z: bounds.max[2] },
    bounds: boundsOf(vertices),
    sliceCount: sample.length,
  };
}

if (process.argv[1]?.endsWith('weapon_glb_probe.mjs')) {
  const target = process.argv[2];
  if (!target) throw new Error('usage: node scripts/weapon_glb_probe.mjs <file.glb>');
  const result = findMuzzle(target);
  const f = (n) => n.toFixed(5).padStart(9);
  console.log(`muzzle  x=${f(result.position.x)} y=${f(result.position.y)} z=${f(result.position.z)}`);
  console.log(`bounds  min ${result.bounds.min.map(f).join(' ')}`);
  console.log(`        max ${result.bounds.max.map(f).join(' ')}`);
  console.log(`slice vertices: ${result.sliceCount}`);
}
