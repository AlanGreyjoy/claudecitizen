import * as THREE from "three";
import type { PrefabComponent } from "../../world/prefabs/schema";
import { sampleCurve, sampleGradient, hash01 } from "./curves";
import type { ParticleSlot } from "./system-types";
import type { ParticleTrailsController } from "./trails";

type ParticleSystemComponent = PrefabComponent & { type: "particle-system" };

export function sheetUv(
  spec: ParticleSystemComponent,
  normalizedAge: number,
  seed: number,
): {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
} {
  const sheet = spec.textureSheetAnimation;
  if (!sheet?.enabled) return { ox: 0, oy: 0, sx: 1, sy: 1 };
  const tiles = Math.max(1, sheet.tilesX * sheet.tilesY);
  const rowTiles = Math.max(1, sheet.tilesX);
  let frame: number;
  if (sheet.animation === "single-row") {
    const row = Math.floor(sheet.startFrame / rowTiles);
    frame =
      row * rowTiles +
      Math.floor(normalizedAge * sheet.cycles * rowTiles) % rowTiles;
  } else {
    frame =
      (sheet.startFrame +
        Math.floor(normalizedAge * sheet.cycles * tiles + hash01(seed) * 0.001)) %
      tiles;
  }
  const fx = frame % sheet.tilesX;
  const fy = Math.floor(frame / sheet.tilesX) % sheet.tilesY;
  return {
    ox: fx / sheet.tilesX,
    oy: 1 - (fy + 1) / sheet.tilesY,
    sx: 1 / sheet.tilesX,
    sy: 1 / sheet.tilesY,
  };
}


export function renderParticleInstances(args: {
  spec: ParticleSystemComponent;
  slots: ParticleSlot[];
  mesh: THREE.InstancedMesh;
  trails: ParticleTrailsController;
  root: THREE.Group;
  dummy: THREE.Object3D;
  worldPos: THREE.Vector3;
  worldQuat: THREE.Quaternion;
  worldScale: THREE.Vector3;
  invQuat: THREE.Quaternion;
  tmp: THREE.Vector3;
  material: THREE.ShaderMaterial;
  dt: number;
  camera: THREE.Camera | undefined;
  hexToRgb: (color: string) => { r: number; g: number; b: number };
}): void {
  const {
    spec, slots, mesh, trails, root, dummy, worldPos, worldQuat, worldScale,
    invQuat, tmp, material, dt, camera, hexToRgb,
  } = args;
  const colorOver = spec.colorOverLifetime;
  const sizeOver = spec.sizeOverLifetime;
  const startRgb = hexToRgb(spec.startColor);

  trails.beginFrame();
  let drawIndex = 0;
  const colorAttr = mesh.geometry.getAttribute(
    "instanceColorAttr",
  ) as THREE.InstancedBufferAttribute;
  const alphaAttr = mesh.geometry.getAttribute(
    "instanceAlpha",
  ) as THREE.InstancedBufferAttribute;
  const tileOffsetAttr = mesh.geometry.getAttribute(
    "instanceTileOffset",
  ) as THREE.InstancedBufferAttribute;
  const tileScaleAttr = mesh.geometry.getAttribute(
    "instanceTileScale",
  ) as THREE.InstancedBufferAttribute;
  const stretchAttr = mesh.geometry.getAttribute(
    "instanceStretch",
  ) as THREE.InstancedBufferAttribute;
  const colorArray = colorAttr.array as Float32Array;
  const alphaArray = alphaAttr.array as Float32Array;
  const tileOffsetArray = tileOffsetAttr.array as Float32Array;
  const tileScaleArray = tileScaleAttr.array as Float32Array;
  const stretchArray = stretchAttr.array as Float32Array;

  root.updateWorldMatrix(true, false);
  root.matrixWorld.decompose(worldPos, worldQuat, worldScale);
  invQuat.copy(worldQuat).invert();

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (!slot.alive) continue;
    const nt = slot.age / slot.lifetime;

    let sizeMul = 1;
    if (sizeOver?.enabled) sizeMul = sampleCurve(sizeOver.curve, nt);
    const size = slot.startSize * sizeMul;

    let r = startRgb.r;
    let g = startRgb.g;
    let b = startRgb.b;
    let a = 1;
    if (colorOver?.enabled) {
      const c = sampleGradient(colorOver.gradient, nt);
      r = c.r;
      g = c.g;
      b = c.b;
      a = c.a;
    }

    const uv = sheetUv(spec, nt, slot.seed);
    const speed = Math.hypot(slot.vx, slot.vy, slot.vz);
    const stretch =
      1 +
      (spec.renderer.renderMode === "stretched-billboard"
        ? spec.renderer.lengthScale + speed * spec.renderer.speedScale
        : 0);

    let rx = slot.x;
    let ry = slot.y;
    let rz = slot.z;
    if (spec.simulationSpace === "world") {
      tmp.set(slot.x, slot.y, slot.z).sub(worldPos).applyQuaternion(invQuat);
      rx = tmp.x / (worldScale.x || 1);
      ry = tmp.y / (worldScale.y || 1);
      rz = tmp.z / (worldScale.z || 1);
    }

    dummy.position.set(rx, ry, rz);
    dummy.scale.set(size, size, size);
    dummy.rotation.set(0, 0, slot.startRotation);
    dummy.updateMatrix();
    mesh.setMatrixAt(drawIndex, dummy.matrix);

    colorArray[drawIndex * 3] = r;
    colorArray[drawIndex * 3 + 1] = g;
    colorArray[drawIndex * 3 + 2] = b;
    alphaArray[drawIndex] = a;
    tileOffsetArray[drawIndex * 2] = uv.ox;
    tileOffsetArray[drawIndex * 2 + 1] = uv.oy;
    tileScaleArray[drawIndex * 2] = uv.sx;
    tileScaleArray[drawIndex * 2 + 1] = uv.sy;
    stretchArray[drawIndex] = stretch;

    trails.pushPoint(i, slot.hasTrail, rx, ry, rz, true);
    drawIndex += 1;
  }

  mesh.count = drawIndex;
  mesh.instanceMatrix.needsUpdate = true;
  colorAttr.needsUpdate = true;
  alphaAttr.needsUpdate = true;
  tileOffsetAttr.needsUpdate = true;
  tileScaleAttr.needsUpdate = true;
  stretchAttr.needsUpdate = true;
  trails.endFrame(dt);

  if (camera && material.uniforms.uSoftEnabled.value) {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      material.uniforms.uCameraNear.value = cam.near;
      material.uniforms.uCameraFar.value = cam.far;
    }
  }

  if (camera && spec.renderer.sortMode === "by-distance") {
    root.getWorldPosition(worldPos);
    root.visible = camera.position.distanceTo(worldPos) < 250;
  } else {
    root.visible = true;
  }
}

