import * as THREE from "three";
import type { PrefabComponent } from "../../world/prefabs/schema";
import {
  globalSpawnScale,
  releaseParticleSlots,
  reserveParticleSlots,
} from "./budget";
import { resolveParticlePlaneCollisions } from "./collision";
import {
  hash01,
  sampleCurve,
  sampleGradient,
  sampleMinMax,
} from "./curves";
import { sampleBurstCount, sampleEmitterShape } from "./emitter";
import {
  createDefaultParticleTexture,
  createParticleMaterial,
} from "./material";
import { createParticleTrails } from "./trails";

type ParticleSystemComponent = PrefabComponent & { type: "particle-system" };

export interface ParticleSystemHandle {
  object3d: THREE.Object3D;
  update: (dt: number, camera?: THREE.Camera) => void;
  setPlaying: (playing: boolean) => void;
  isPlaying: () => boolean;
  restart: () => void;
  applyComponent: (component: ParticleSystemComponent) => void;
  dispose: () => void;
  getComponent: () => ParticleSystemComponent;
}

interface ParticleSlot {
  alive: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  startSize: number;
  startRotation: number;
  seed: number;
  hasTrail: boolean;
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();
const sharedDefaultTexture = createDefaultParticleTexture();

function loadTexture(url: string | undefined): THREE.Texture {
  if (!url) return sharedDefaultTexture;
  const cached = textureCache.get(url);
  if (cached) return cached;
  const texture = textureLoader.load(url);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  textureCache.set(url, texture);
  return texture;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(color.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function createSlot(): ParticleSlot {
  return {
    alive: false,
    age: 0,
    lifetime: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    startSize: 0.1,
    startRotation: 0,
    seed: 0,
    hasTrail: false,
  };
}

export function createParticleSystem(
  component: ParticleSystemComponent,
  options: { depthTexture?: THREE.Texture | null } = {},
): ParticleSystemHandle {
  let spec = component;
  const root = new THREE.Group();
  root.name = "particle-system";

  let maxParticles = Math.max(1, spec.maxParticles);
  let slots: ParticleSlot[] = Array.from({ length: maxParticles }, createSlot);
  let reserved = 0;
  let playing = spec.playOnAwake !== false && spec.enabled !== false;
  let time = 0;
  let emitCarry = 0;
  let delayRemaining = 0;
  let seeded = false;
  let disposed = false;
  let lastBurstFire = new Float32Array(0);

  const baseGeometry = new THREE.PlaneGeometry(1, 1);
  let activeGeometry = baseGeometry.clone();
  let material = createParticleMaterial({
    blendMode: spec.renderer.blendMode,
    renderMode: spec.renderer.renderMode,
    softParticles: spec.renderer.softParticles,
    softNear: spec.renderer.softParticleNearFade,
    softFar: spec.renderer.softParticleFarFade,
    map: loadTexture(spec.renderer.textureUrl),
    depthTexture: options.depthTexture ?? null,
  });

  let mesh = new THREE.InstancedMesh(activeGeometry, material, maxParticles);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instance positions move every frame; geometry bounds do not cover them.
  mesh.frustumCulled = false;
  mesh.count = 0;

  function attachInstanceAttributes(target: THREE.InstancedMesh, count: number): void {
    target.geometry.setAttribute(
      "instanceColorAttr",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    );
    target.geometry.setAttribute(
      "instanceAlpha",
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    );
    target.geometry.setAttribute(
      "instanceTileOffset",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2),
    );
    target.geometry.setAttribute(
      "instanceTileScale",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2),
    );
    target.geometry.setAttribute(
      "instanceStretch",
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    );
  }

  attachInstanceAttributes(mesh, maxParticles);
  root.add(mesh);

  let trails = createParticleTrails(maxParticles, spec.trails);
  root.add(trails.object3d);

  const dummy = new THREE.Object3D();
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  const invQuat = new THREE.Quaternion();
  const localVel = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function releaseAll(): void {
    releaseParticleSlots(reserved);
    reserved = 0;
  }

  function liveCount(): number {
    let n = 0;
    for (const slot of slots) if (slot.alive) n += 1;
    return n;
  }

  function syncBudget(): void {
    const live = liveCount();
    if (live > reserved) {
      reserved += reserveParticleSlots(live - reserved);
    } else if (live < reserved) {
      releaseParticleSlots(reserved - live);
      reserved = live;
    }
  }

  function rebuildCapacity(nextMax: number): void {
    root.remove(mesh);
    mesh.dispose();
    activeGeometry.dispose();
    material.dispose();
    trails.dispose();
    root.remove(trails.object3d);
    releaseAll();

    maxParticles = Math.max(1, nextMax);
    slots = Array.from({ length: maxParticles }, createSlot);
    material = createParticleMaterial({
      blendMode: spec.renderer.blendMode,
      renderMode: spec.renderer.renderMode,
      softParticles: spec.renderer.softParticles,
      softNear: spec.renderer.softParticleNearFade,
      softFar: spec.renderer.softParticleFarFade,
      map: loadTexture(spec.renderer.textureUrl),
      depthTexture: options.depthTexture ?? null,
    });
    activeGeometry = baseGeometry.clone();
    mesh = new THREE.InstancedMesh(activeGeometry, material, maxParticles);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instance positions move every frame; geometry bounds do not cover them.
    mesh.frustumCulled = false;
    mesh.count = 0;
    attachInstanceAttributes(mesh, maxParticles);
    root.add(mesh);
    trails = createParticleTrails(maxParticles, spec.trails);
    root.add(trails.object3d);
  }

  function spawnOne(seed: number): boolean {
    if (liveCount() >= maxParticles) return false;
    if (globalSpawnScale() <= 0) return false;
    let index = -1;
    for (let i = 0; i < slots.length; i += 1) {
      if (!slots[i].alive) {
        index = i;
        break;
      }
    }
    if (index < 0) return false;
    if (reserveParticleSlots(1) < 1) return false;
    reserved += 1;

    const spawn = sampleEmitterShape(spec.shape, seed);
    const speed = sampleMinMax(spec.startSpeed, hash01(seed + 3));
    let dirX = spawn.dirX;
    let dirY = spawn.dirY;
    let dirZ = spawn.dirZ;
    if (!spec.shape.alignToDirection) {
      dirX = 0;
      dirY = 1;
      dirZ = 0;
    }
    const slot = slots[index];
    slot.alive = true;
    slot.age = 0;
    slot.lifetime = Math.max(0.01, sampleMinMax(spec.startLifetime, hash01(seed + 4)));
    slot.x = spawn.x;
    slot.y = spawn.y;
    slot.z = spawn.z;
    slot.vx = dirX * speed;
    slot.vy = dirY * speed;
    slot.vz = dirZ * speed;
    slot.startSize = Math.max(0.001, sampleMinMax(spec.startSize, hash01(seed + 5)));
    slot.startRotation =
      (sampleMinMax(spec.startRotation, hash01(seed + 6)) * Math.PI) / 180;
    slot.seed = seed;
    slot.hasTrail = Boolean(
      spec.trails?.enabled && hash01(seed + 7) <= (spec.trails.ratio ?? 0),
    );

    if (spec.simulationSpace === "world") {
      root.updateWorldMatrix(true, false);
      root.matrixWorld.decompose(worldPos, worldQuat, worldScale);
      tmp.set(slot.x, slot.y, slot.z).applyQuaternion(worldQuat);
      slot.x = tmp.x * worldScale.x + worldPos.x;
      slot.y = tmp.y * worldScale.y + worldPos.y;
      slot.z = tmp.z * worldScale.z + worldPos.z;
      localVel.set(slot.vx, slot.vy, slot.vz).applyQuaternion(worldQuat);
      slot.vx = localVel.x;
      slot.vy = localVel.y;
      slot.vz = localVel.z;
    }
    return true;
  }

  function emit(count: number, baseSeed: number): void {
    const n = Math.floor(count * globalSpawnScale() + 1e-6);
    for (let i = 0; i < n; i += 1) {
      if (!spawnOne(baseSeed + i * 17.13)) break;
    }
  }

  function restartInternal(prewarm: boolean): void {
    for (const slot of slots) slot.alive = false;
    releaseAll();
    trails.reset();
    time = 0;
    emitCarry = 0;
    delayRemaining = sampleMinMax(spec.startDelay, Math.random());
    lastBurstFire = new Float32Array(spec.emission.bursts.length);
    lastBurstFire.fill(-1);
    seeded = true;
    if (prewarm && spec.looping) {
      const steps = 24;
      const stepDt = Math.min(spec.duration, 1.5) / steps;
      for (let i = 0; i < steps; i += 1) stepSimulation(stepDt);
    }
  }

  function sheetUv(normalizedAge: number, seed: number): {
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

  function stepSimulation(dt: number): void {
    if (playing) {
      if (delayRemaining > 0) {
        delayRemaining -= dt;
      } else {
        const duration = Math.max(0.01, spec.duration);
        const prevTime = time;
        time += dt;
        if (!spec.looping && prevTime >= duration) {
          playing = false;
        } else if (playing) {
          const cycleTime = spec.looping ? time % duration : Math.min(time, duration);
          const prevCycle = spec.looping ? prevTime % duration : prevTime;
          emitCarry += spec.emission.rateOverTime * dt;
          const rateCount = Math.floor(emitCarry);
          emitCarry -= rateCount;
          if (rateCount > 0) emit(rateCount, time * 100);

          for (let bi = 0; bi < spec.emission.bursts.length; bi += 1) {
            const burst = spec.emission.bursts[bi];
            const cycles = Math.max(1, burst.cycles ?? 1);
            const interval = Math.max(0.01, burst.interval ?? duration);
            for (let c = 0; c < cycles; c += 1) {
              const t = burst.time + c * interval;
              if (t > duration && !spec.looping) break;
              const fireKey = bi * 1000 + c;
              const crossed =
                (prevCycle <= t && cycleTime >= t) ||
                (spec.looping && prevCycle > cycleTime && (t >= prevCycle || t <= cycleTime));
              if (crossed && lastBurstFire[bi] !== fireKey + Math.floor(time / duration)) {
                lastBurstFire[bi] = fireKey + Math.floor(time / duration);
                emit(sampleBurstCount(burst.count, time * 90 + c), time * 90 + c);
              }
            }
          }
        }
      }
    }

    const gravity = -9.81 * spec.gravityModifier;
    const vol = spec.velocityOverLifetime;
    const force = spec.forceOverLifetime;

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (!slot.alive) continue;
      slot.age += dt;
      if (slot.age >= slot.lifetime) {
        slot.alive = false;
        continue;
      }

      if (vol?.enabled) {
        slot.vx += vol.linear.x * dt;
        slot.vy += vol.linear.y * dt;
        slot.vz += vol.linear.z * dt;
        const ox = slot.x;
        const oz = slot.z;
        const ang = vol.orbital.y * dt;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        slot.x = ox * cos - oz * sin;
        slot.z = ox * sin + oz * cos;
        const radial = vol.radial * dt;
        const len = Math.hypot(slot.x, slot.y, slot.z) || 1;
        slot.vx += (slot.x / len) * radial;
        slot.vy += (slot.y / len) * radial;
        slot.vz += (slot.z / len) * radial;
      }
      if (force?.enabled) {
        slot.vx += force.force.x * dt;
        slot.vy += force.force.y * dt;
        slot.vz += force.force.z * dt;
      }
      slot.vy += gravity * dt;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;
      slot.z += slot.vz * dt;

      if (spec.collision?.enabled) {
        resolveParticlePlaneCollisions(slot, spec.collision, 0);
      }
    }
  }

  function render(dt: number, camera: THREE.Camera | undefined): void {
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

      const uv = sheetUv(nt, slot.seed);
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

  function step(dt: number, camera?: THREE.Camera): void {
    if (disposed || spec.enabled === false) {
      mesh.count = 0;
      return;
    }
    if (!seeded) restartInternal(Boolean(spec.prewarm));
    if (!playing && liveCount() === 0) {
      mesh.count = 0;
      return;
    }
    stepSimulation(dt);
    render(dt, camera);
    syncBudget();
  }

  restartInternal(Boolean(spec.prewarm));

  return {
    object3d: root,
    update(dt, camera) {
      step(Math.min(0.1, Math.max(0, dt)), camera);
    },
    setPlaying(next) {
      playing = next && spec.enabled !== false;
    },
    isPlaying() {
      return playing;
    },
    restart() {
      playing = spec.enabled !== false;
      restartInternal(Boolean(spec.prewarm));
    },
    applyComponent(next) {
      const needsRebuild = next.maxParticles !== spec.maxParticles;
      spec = next;
      material.uniforms.uMap.value = loadTexture(next.renderer.textureUrl);
      material.uniforms.uHasMap.value = 1;
      material.uniforms.uSoftNear.value = next.renderer.softParticleNearFade;
      material.uniforms.uSoftFar.value = next.renderer.softParticleFarFade;
      material.uniforms.uSoftEnabled.value =
        next.renderer.softParticles && options.depthTexture ? 1 : 0;
      material.uniforms.uAdditive.value =
        next.renderer.blendMode === "additive" ? 1 : 0;
      material.blending =
        next.renderer.blendMode === "additive"
          ? THREE.AdditiveBlending
          : THREE.NormalBlending;
      material.uniforms.uRenderMode.value =
        next.renderer.renderMode === "stretched-billboard"
          ? 1
          : next.renderer.renderMode === "horizontal"
            ? 2
            : next.renderer.renderMode === "vertical"
              ? 3
              : 0;
      trails.applyConfig(next.trails);
      if (needsRebuild) {
        rebuildCapacity(next.maxParticles);
        restartInternal(Boolean(next.prewarm));
      }
      if (next.enabled === false) {
        playing = false;
        for (const slot of slots) slot.alive = false;
        releaseAll();
        mesh.count = 0;
      }
    },
    dispose() {
      disposed = true;
      releaseAll();
      trails.dispose();
      mesh.dispose();
      material.dispose();
      activeGeometry.dispose();
      baseGeometry.dispose();
    },
    getComponent() {
      return spec;
    },
  };
}
