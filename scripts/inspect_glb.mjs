// Dev tool: dump GLB node hierarchy, meshes, and animation clips.
// Usage: node scripts/inspect_glb.mjs [path-to-glb]
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'src/assets/ships/Phobos_Starhopper_Basic.glb';
const buf = readFileSync(path);

const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) throw new Error('Not a GLB file');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

const nodes = json.nodes ?? [];
const meshes = json.meshes ?? [];
const animations = json.animations ?? [];
const scenes = json.scenes ?? [];

function describeNode(index, depth) {
  const node = nodes[index];
  const pad = '  '.repeat(depth);
  const parts = [`${pad}[${index}] ${node.name ?? '(unnamed)'}`];
  if (node.mesh !== undefined) parts.push(`mesh=${meshes[node.mesh]?.name ?? node.mesh}`);
  if (node.translation) parts.push(`t=(${node.translation.map((v) => v.toFixed(3)).join(', ')})`);
  if (node.rotation) parts.push(`r=(${node.rotation.map((v) => v.toFixed(3)).join(', ')})`);
  if (node.scale) parts.push(`s=(${node.scale.map((v) => v.toFixed(3)).join(', ')})`);
  console.log(parts.join(' '));
  for (const child of node.children ?? []) describeNode(child, depth + 1);
}

console.log(`=== ${path} ===`);
console.log(`nodes: ${nodes.length}, meshes: ${meshes.length}, animations: ${animations.length}`);
console.log('\n--- scene hierarchy ---');
for (const scene of scenes) {
  for (const rootIndex of scene.nodes ?? []) describeNode(rootIndex, 0);
}

console.log('\n--- animations ---');
for (const [i, anim] of animations.entries()) {
  const targets = new Set(
    (anim.channels ?? []).map((c) => {
      const n = nodes[c.target?.node ?? -1];
      return `${n?.name ?? c.target?.node}:${c.target?.path}`;
    }),
  );
  console.log(`[${i}] ${anim.name ?? '(unnamed)'} -> ${[...targets].join(', ')}`);
}
