import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { clearChildren, chevronIcon, el } from '../dom';
import {
  ASSET_DND_TYPE,
  fetchPlanet,
  fetchPlanetList,
  savePlanet,
  type PlanetListEntry,
} from '../api';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { sampleSurfaceHeight } from '../../world/elevation';
import { activatePlanetDocument } from '../../world/planets/runtime';
import {
  createDefaultPlanetDocument,
  createDefaultSpawnLayer,
  parsePlanetDocument,
  planetPhysicsFromDocument,
  type PlanetBiomePalette,
  type PlanetDocument,
} from '../../world/planets/schema';
import { samplePlanetSurface } from '../../world/planet_surface';
import type { Biome, PlanetSpawnLayer } from '../../types';

function isModelAssetUrl(url: string): boolean {
  return /\.(glb|gltf)(\?|$)/i.test(url);
}

function nextSpawnLayerId(layers: readonly PlanetSpawnLayer[]): string {
  let n = layers.length + 1;
  const used = new Set(layers.map((layer) => layer.id));
  while (used.has(`spawn-${n}`)) n += 1;
  return `spawn-${n}`;
}

export interface PlanetAuthoringEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  loadPlanet: (id: string) => Promise<boolean>;
  getDocument: () => PlanetDocument | null;
  previewPlanet: () => Promise<boolean>;
}

const BIOME_KEYS: Biome[] = [
  'ocean',
  'lake',
  'river',
  'beach',
  'desert',
  'plains',
  'forest',
  'tundra',
  'highlands',
  'peak',
  'rock',
];

function cloneDocument(doc: PlanetDocument): PlanetDocument {
  return structuredClone(doc);
}

function documentsEqual(a: PlanetDocument | null, b: PlanetDocument | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step = 0.01,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input',
    attrs: { type: 'number', step: String(step), value: String(value) },
    on: {
      input: () => {
        const next = Number(input.value);
        if (Number.isFinite(next)) onChange(next);
      },
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el(
    'label',
    { className: 'ed-planet-field' },
    [el('span', { text: label }), input],
  );
}

function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input',
    attrs: { type: 'text', value },
    on: {
      input: () => onChange(input.value),
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el(
    'label',
    { className: 'ed-planet-field' },
    [el('span', { text: label }), input],
  );
}

function colorField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input ed-planet-color',
    attrs: { type: 'color', value },
    on: {
      input: () => onChange(input.value),
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el(
    'label',
    { className: 'ed-planet-field' },
    [el('span', { text: label }), input],
  );
}

function checkboxField(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const input = el('input', {
    className: 'ed-planet-checkbox',
    attrs: { type: 'checkbox', ...(checked ? { checked: 'true' } : {}) },
    on: {
      change: () => onChange(input.checked),
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el(
    'label',
    { className: 'ed-planet-field ed-planet-field-check' },
    [el('span', { text: label }), input],
  );
}

function modelAssetField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input ed-planet-drop-input',
    attrs: {
      type: 'text',
      value,
      placeholder: 'Drop .glb / .gltf from Project…',
    },
    on: {
      input: () => onChange(input.value.trim()),
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  input.addEventListener('dragover', (event) => {
    event.preventDefault();
    input.classList.add('is-drop-target');
  });
  input.addEventListener('dragleave', () => {
    input.classList.remove('is-drop-target');
  });
  input.addEventListener('drop', (event) => {
    event.preventDefault();
    input.classList.remove('is-drop-target');
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData('text/plain');
    if (url?.startsWith('/') && isModelAssetUrl(url)) {
      input.value = url;
      onChange(url);
    }
  });
  return el(
    'label',
    { className: 'ed-planet-field ed-planet-field-wide' },
    [el('span', { text: label }), input],
  );
}

function biomeMultiSelect(
  selected: readonly Biome[],
  onChange: (next: Biome[]) => void,
): HTMLElement {
  const selectedSet = new Set(selected);
  const chips = el('div', { className: 'ed-planet-biome-chips' });
  for (const biome of BIOME_KEYS) {
    const active = selectedSet.has(biome);
    chips.append(
      el('button', {
        className: `ed-planet-biome-chip${active ? ' is-active' : ''}`,
        text: biome,
        attrs: { type: 'button' },
        on: {
          click: () => {
            const next = new Set(selectedSet);
            if (next.has(biome)) next.delete(biome);
            else next.add(biome);
            onChange(BIOME_KEYS.filter((key) => next.has(key)));
          },
        },
      }),
    );
  }
  return el('div', { className: 'ed-planet-biome-row' }, [
    el('span', { className: 'ed-planet-biome-label', text: 'Biomes' }),
    chips,
  ]);
}

function spawnLayerEditor(
  layer: PlanetSpawnLayer,
  onChange: () => void,
  onRemove: () => void,
  onRebuild: () => void,
): HTMLElement {
  const half = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
  const body: HTMLElement[] = [
    checkboxField('Enabled', layer.enabled, (value) => {
      layer.enabled = value;
      onChange();
    }),
    textField('Name', layer.name, (value) => {
      layer.name = value;
      onChange();
    }),
    modelAssetField('Asset', layer.assetUrl, (value) => {
      layer.assetUrl = value;
      onChange();
    }),
    numberField('Density', layer.density, (value) => {
      layer.density = value;
      onChange();
    }),
    numberField('Gap (m)', layer.gapMeters, (value) => {
      layer.gapMeters = value;
      onChange();
    }),
    numberField('Min scale', layer.minScale, (value) => {
      layer.minScale = value;
      onChange();
    }),
    numberField('Max scale', layer.maxScale, (value) => {
      layer.maxScale = value;
      onChange();
    }),
    numberField('Min height 0–1', layer.minNormalizedHeight, (value) => {
      layer.minNormalizedHeight = value;
      onChange();
    }, 0.001),
    numberField('Max height 0–1', layer.maxNormalizedHeight, (value) => {
      layer.maxNormalizedHeight = value;
      onChange();
    }, 0.001),
    checkboxField('Align to normal', layer.alignToNormal, (value) => {
      layer.alignToNormal = value;
      onChange();
    }),
    biomeMultiSelect(layer.biomes, (biomes) => {
      layer.biomes = biomes;
      onChange();
      onRebuild();
    }),
  ];

  const shapeSelect = el('select', {
    className: 'ed-input',
    on: {
      change: () => {
        const shape = shapeSelect.value === 'capsule' ? 'capsule' : 'box';
        if (shape === 'capsule') {
          layer.collider = {
            shape: 'capsule',
            radius: layer.collider.radius ?? 0.4,
            halfHeight: layer.collider.halfHeight ?? 0.5,
          };
        } else {
          layer.collider = {
            shape: 'box',
            halfExtents: layer.collider.halfExtents ?? [0.5, 0.5, 0.5],
          };
        }
        onChange();
        onRebuild();
      },
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLSelectElement;
  shapeSelect.append(
    el('option', {
      text: 'box',
      attrs: {
        value: 'box',
        ...(layer.collider.shape === 'box' ? { selected: 'true' } : {}),
      },
    }),
    el('option', {
      text: 'capsule',
      attrs: {
        value: 'capsule',
        ...(layer.collider.shape === 'capsule' ? { selected: 'true' } : {}),
      },
    }),
  );
  body.push(
    el('label', { className: 'ed-planet-field' }, [
      el('span', { text: 'Collider' }),
      shapeSelect,
    ]),
  );

  if (layer.collider.shape === 'capsule') {
    body.push(
      numberField('Radius', layer.collider.radius ?? 0.4, (value) => {
        layer.collider.radius = value;
        onChange();
      }),
      numberField('Half height', layer.collider.halfHeight ?? 0.5, (value) => {
        layer.collider.halfHeight = value;
        onChange();
      }),
    );
  } else {
    body.push(
      numberField('Half X', half[0], (value) => {
        const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
        layer.collider.halfExtents = [value, next[1], next[2]];
        onChange();
      }),
      numberField('Half Y', half[1], (value) => {
        const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
        layer.collider.halfExtents = [next[0], value, next[2]];
        onChange();
      }),
      numberField('Half Z', half[2], (value) => {
        const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
        layer.collider.halfExtents = [next[0], next[1], value];
        onChange();
      }),
    );
  }

  body.push(
    el('button', {
      className: 'ed-btn ed-planet-remove-layer',
      text: 'Remove layer',
      attrs: { type: 'button' },
      on: { click: onRemove },
    }),
  );

  return el('div', { className: 'ed-planet-spawn-layer' }, [
    el('div', {
      className: 'ed-planet-spawn-layer-title',
      text: layer.name || layer.id,
    }),
    ...body,
  ]);
}

export function createPlanetAuthoringEditor(host: HTMLElement): PlanetAuthoringEditor {
  let active = false;
  let initialized = false;
  let documentState: PlanetDocument = createDefaultPlanetDocument();
  let savedSnapshot: PlanetDocument = cloneDocument(documentState);
  let planetList: PlanetListEntry[] = [];
  let previewDirty = true;
  let raf = 0;
  let loadGeneration = 0;
  /** Reset orbit/fly camera on next mesh rebuild (planet load / New). */
  let resetCameraOnRebuild = true;
  /** Persist across rebuildForm(); sections start collapsed unless listed here. */
  const expandedSections = new Set<string>();

  function section(title: string, children: HTMLElement[]): HTMLElement {
    const collapsed = !expandedSections.has(title);
    const caret = el('span', { className: 'ed-section-caret' }, [
      chevronIcon(!collapsed),
    ]);
    const sectionEl = el('section', {
      className: `ed-planet-section${collapsed ? ' is-collapsed' : ''}`,
    });
    const titleEl = el(
      'h3',
      {
        className: 'ed-planet-section-title ed-section-title-toggle',
        title: collapsed ? `Expand ${title}` : `Collapse ${title}`,
        attrs: { role: 'button', tabindex: '0' },
        on: {
          click: () => {
            const nextCollapsed = !sectionEl.classList.contains('is-collapsed');
            sectionEl.classList.toggle('is-collapsed', nextCollapsed);
            if (nextCollapsed) expandedSections.delete(title);
            else expandedSections.add(title);
            caret.replaceChildren(chevronIcon(!nextCollapsed));
            titleEl.title = nextCollapsed
              ? `Expand ${title}`
              : `Collapse ${title}`;
          },
          keydown: (event) => {
            const keyEvent = event as KeyboardEvent;
            if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
            keyEvent.preventDefault();
            titleEl.click();
          },
        },
      },
      [el('span', { text: title }), caret],
    );
    sectionEl.append(
      titleEl,
      el('div', { className: 'ed-planet-section-body' }, children),
    );
    return sectionEl;
  }

  const root = el('div', { className: 'ed-planet-authoring' });
  const sidebar = el('div', { className: 'ed-planet-sidebar' });
  const formHost = el('div', { className: 'ed-planet-form' });
  const previewHost = el('div', { className: 'ed-planet-preview' });
  const statusEl = el('div', { className: 'ed-planet-status', text: 'Asteron' });
  const actions = el('div', { className: 'ed-base-actions' });
  const previewHint = el('div', {
    className: 'ed-planet-preview-hint',
    text: 'LMB orbit · MMB pan · hold RMB + WASD/QE fly · wheel (while flying) speed · Shift boost',
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x07101c, 1);
  const canvas = renderer.domElement;
  canvas.className = 'ed-planet-canvas';
  previewHost.append(canvas, previewHint);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 50_000);
  const clock = new THREE.Clock();
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(0.4, 1, 0.2);
  scene.add(light, new THREE.AmbientLight(0x8899aa, 0.55));
  let previewMesh: THREE.Mesh | null = null;
  let previewWaterMesh: THREE.Mesh | null = null;

  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.target.set(0, 0, 0);
  // Right mouse is reserved for Unity-style flythrough; pan lives on middle mouse.
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };

  // ---- flythrough camera (hold RMB, same as Scene viewport) ----------------
  const FLY_KEY_CODES = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ShiftLeft',
    'ShiftRight',
  ]);
  const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
  const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  // Planet preview units are large (~km-scale patch); start faster than prefab fly.
  let flySpeed = 80;
  let flyTargetDistance = 400;

  function beginFly(): void {
    if (flying || !active) return;
    flying = true;
    flyTargetDistance = Math.max(40, camera.position.distanceTo(orbit.target));
    flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    flyEuler.z = 0;
    orbit.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.getWorldDirection(flyForward);
    orbit.target.copy(camera.position).addScaledVector(flyForward, flyTargetDistance);
    orbit.enabled = true;
    orbit.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(-FLY_PITCH_LIMIT, Math.min(FLY_PITCH_LIMIT, flyEuler.x));
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has('KeyW')) flyMove.add(flyForward);
    if (flyKeys.has('KeyS')) flyMove.sub(flyForward);
    if (flyKeys.has('KeyD')) flyMove.add(flyRight);
    if (flyKeys.has('KeyA')) flyMove.sub(flyRight);
    if (flyKeys.has('KeyE')) flyMove.y += 1;
    if (flyKeys.has('KeyQ')) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight') ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    if (event.type === 'keydown') flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }

  function onPointerLockChange(): void {
    if (flying && document.pointerLockElement !== canvas) endFly();
  }

  window.addEventListener('keydown', onFlyKey);
  window.addEventListener('keyup', onFlyKey);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointermove', onFlyLook);
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 2) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id — flythrough still works.
    }
    beginFly();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 2) endFly();
  });
  canvas.addEventListener('pointercancel', () => endFly());
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!flying) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flySpeed = Math.min(
        800,
        Math.max(2, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
      );
    },
    { passive: false },
  );

  host.append(root);
  root.append(sidebar, previewHost);
  sidebar.append(
    el('h2', { className: 'ed-base-panel-title', text: 'Planet Authoring' }),
    statusEl,
    actions,
    formHost,
  );

  function hasUnsavedChanges(): boolean {
    return !documentsEqual(documentState, savedSnapshot);
  }

  function setStatus(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
  }

  function markDirty(): void {
    previewDirty = true;
    setStatus(`${documentState.name} — unsaved`);
  }

  function rebuildForm(): void {
    clearChildren(formHost);
    const doc = documentState;

    formHost.append(
      section('Identity', [
        textField('Id', doc.id, (value) => {
          doc.id = value.trim().toLowerCase();
          markDirty();
        }),
        textField('Name', doc.name, (value) => {
          doc.name = value;
          markDirty();
        }),
        numberField('Seed', doc.seed, (value) => {
          doc.seed = Math.round(value);
          markDirty();
        }, 1),
      ]),
      section('Physics', [
        numberField('Radius (m)', doc.radiusMeters, (value) => {
          doc.radiusMeters = value;
          markDirty();
        }, 1000),
        numberField('Amplitude (m)', doc.terrainAmplitudeMeters, (value) => {
          doc.terrainAmplitudeMeters = value;
          markDirty();
        }, 10),
        numberField('Atmosphere (m)', doc.atmosphereHeightMeters, (value) => {
          doc.atmosphereHeightMeters = value;
          markDirty();
        }, 100),
        numberField('Gravity', doc.gravityMetersPerSecond2, (value) => {
          doc.gravityMetersPerSecond2 = value;
          markDirty();
        }),
        numberField('Drag sea level', doc.dragSeaLevel, (value) => {
          doc.dragSeaLevel = value;
          markDirty();
        }, 0.001),
      ]),
      section('Height recipe', [
        numberField('Continent scale', doc.height.continentScale, (value) => {
          doc.height.continentScale = value;
          markDirty();
        }),
        numberField('Continent weight', doc.height.continentWeight, (value) => {
          doc.height.continentWeight = value;
          markDirty();
        }),
        numberField('Ridge scale', doc.height.ridgeScale, (value) => {
          doc.height.ridgeScale = value;
          markDirty();
        }),
        numberField('Ridge weight', doc.height.ridgeWeight, (value) => {
          doc.height.ridgeWeight = value;
          markDirty();
        }),
        numberField('Hill scale', doc.height.hillScale, (value) => {
          doc.height.hillScale = value;
          markDirty();
        }),
        numberField('Detail scale', doc.height.detailScale, (value) => {
          doc.height.detailScale = value;
          markDirty();
        }),
      ]),
      section('Regions', [
        numberField('Mountain start', doc.regions.mountainRegionStart, (value) => {
          doc.regions.mountainRegionStart = value;
          markDirty();
        }),
        numberField('Mountain full', doc.regions.mountainRegionFull, (value) => {
          doc.regions.mountainRegionFull = value;
          markDirty();
        }),
        numberField('Hill start', doc.regions.hillRegionStart, (value) => {
          doc.regions.hillRegionStart = value;
          markDirty();
        }),
        numberField('Hill full', doc.regions.hillRegionFull, (value) => {
          doc.regions.hillRegionFull = value;
          markDirty();
        }),
      ]),
      section('Hydrology', [
        numberField('Lake threshold', doc.hydrology.lakeMaskThreshold, (value) => {
          doc.hydrology.lakeMaskThreshold = value;
          markDirty();
        }),
        numberField('Lake carve', doc.hydrology.lakeMaxCarveNormalized, (value) => {
          doc.hydrology.lakeMaxCarveNormalized = value;
          markDirty();
        }),
        numberField('River half-width', doc.hydrology.riverHalfWidth, (value) => {
          doc.hydrology.riverHalfWidth = value;
          markDirty();
        }, 0.001),
        numberField('River carve', doc.hydrology.riverMaxCarveNormalized, (value) => {
          doc.hydrology.riverMaxCarveNormalized = value;
          markDirty();
        }),
      ]),
      section('Vegetation', [
        numberField('Grass density', doc.vegetation.grass.density, (value) => {
          doc.vegetation.grass.density = value;
          markDirty();
        }),
        numberField('Grass gap (m)', doc.vegetation.grass.gapMeters, (value) => {
          doc.vegetation.grass.gapMeters = value;
          markDirty();
        }),
        numberField('Tree density', doc.vegetation.tree.density, (value) => {
          doc.vegetation.tree.density = value;
          markDirty();
        }),
        numberField('Tree gap (m)', doc.vegetation.tree.gapMeters, (value) => {
          doc.vegetation.tree.gapMeters = value;
          markDirty();
        }),
      ]),
      section(
        'Palette',
        BIOME_KEYS.map((biome) =>
          colorField(biome, doc.palette[biome], (value) => {
            doc.palette[biome] = value;
            markDirty();
          }),
        ),
      ),
      section('Spawning', buildSpawningSection(doc)),
    );
  }

  function buildSpawningSection(doc: PlanetDocument): HTMLElement[] {
    if (!Array.isArray(doc.spawning)) doc.spawning = [];
    const children: HTMLElement[] = [
      el('div', {
        className: 'ed-empty-note',
        text: 'Drag .glb props from Project. Height is normalized 0–1 (sea→peak). Plains/forest usually need min≈0, max≈1 — not min=1. Shore: beach + max≈0.012.',
      }),
    ];
    for (let i = 0; i < doc.spawning.length; i += 1) {
      const layer = doc.spawning[i]!;
      const index = i;
      children.push(
        spawnLayerEditor(
          layer,
          () => markDirty(),
          () => {
            doc.spawning.splice(index, 1);
            markDirty();
            rebuildForm();
          },
          () => rebuildForm(),
        ),
      );
    }
    children.push(
      el('button', {
        className: 'ed-btn',
        text: 'Add spawn layer',
        attrs: { type: 'button' },
        on: {
          click: () => {
            const id = nextSpawnLayerId(doc.spawning);
            doc.spawning.push(createDefaultSpawnLayer(id, `Spawn ${doc.spawning.length + 1}`));
            markDirty();
            rebuildForm();
          },
        },
      }),
    );
    return children;
  }

  function hexToRgb(hex: string): [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  function rebuildPreviewMesh(): void {
    activatePlanetDocument(documentState);
    const planet = planetPhysicsFromDocument(documentState);
    const seed = documentState.seed;
    const hint = documentState.spawnHint ?? { latRadians: -0.18, lonRadians: 1.0524073464102095 };
    const segments = 48;
    const halfExtentRadians = 0.012;
    const heightScale = 0.08;
    const patchExtentMeters = 2_400;
    const gridWidth = segments + 1;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const waterLevels = new Float64Array(gridWidth * gridWidth);
    const waterKinds = new Uint8Array(gridWidth * gridWidth); // 0 none, 1 inland, 2 ocean

    for (let y = 0; y <= segments; y += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const u = x / segments;
        const v = y / segments;
        const lat = hint.latRadians + (v - 0.5) * 2 * halfExtentRadians;
        const lon = hint.lonRadians + (u - 0.5) * 2 * halfExtentRadians;
        const probe = cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters);
        const height = sampleSurfaceHeight(planet, seed, probe);
        const surface = samplePlanetSurface(planet, seed, probe);
        const localX = (u - 0.5) * patchExtentMeters;
        const localZ = (v - 0.5) * patchExtentMeters;
        const vertex = y * gridWidth + x;
        positions.push(localX, height * heightScale, localZ);
        const [r, g, b] = hexToRgb(
          (documentState.palette as PlanetBiomePalette)[surface.biome] ?? '#719447',
        );
        colors.push(r, g, b);

        if (surface.biome === 'ocean' || height < 0) {
          waterLevels[vertex] = 0;
          waterKinds[vertex] = 2;
        } else if (
          surface.lakeWaterLevelMeters != null &&
          height < surface.lakeWaterLevelMeters - 0.5
        ) {
          waterLevels[vertex] = surface.lakeWaterLevelMeters;
          waterKinds[vertex] = 1;
        } else {
          waterLevels[vertex] = Number.NaN;
          waterKinds[vertex] = 0;
        }
      }
    }

    for (let y = 0; y < segments; y += 1) {
      for (let x = 0; x < segments; x += 1) {
        const a = y * gridWidth + x;
        const b = a + 1;
        const c = a + gridWidth;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    if (previewMesh) {
      scene.remove(previewMesh);
      previewMesh.geometry.dispose();
      (previewMesh.material as THREE.Material).dispose();
      previewMesh = null;
    }
    if (previewWaterMesh) {
      scene.remove(previewWaterMesh);
      previewWaterMesh.geometry.dispose();
      (previewWaterMesh.material as THREE.Material).dispose();
      previewWaterMesh = null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    previewMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.02,
        flatShading: true,
      }),
    );
    scene.add(previewMesh);

    const waterPositions: number[] = [];
    const waterColors: number[] = [];
    const waterIndices: number[] = [];
    const oceanRgb = hexToRgb(documentState.palette.ocean);
    const lakeRgb = hexToRgb(documentState.palette.lake);
    const shallowRgb = hexToRgb('#3f7898');

    for (let y = 0; y < segments; y += 1) {
      for (let x = 0; x < segments; x += 1) {
        const corners = [
          y * gridWidth + x,
          y * gridWidth + x + 1,
          (y + 1) * gridWidth + x,
          (y + 1) * gridWidth + x + 1,
        ];
        const wetCorners = corners.filter((index) => waterKinds[index] !== 0);
        if (wetCorners.length === 0) continue;

        const base = waterPositions.length / 3;
        let oceanCount = 0;
        for (const index of corners) {
          const u = (index % gridWidth) / segments;
          const v = Math.floor(index / gridWidth) / segments;
          const localX = (u - 0.5) * patchExtentMeters;
          const localZ = (v - 0.5) * patchExtentMeters;
          const level = waterKinds[index] !== 0 ? waterLevels[index] : wetCorners.reduce(
            (sum, wetIndex) => sum + waterLevels[wetIndex],
            0,
          ) / wetCorners.length;
          waterPositions.push(localX, level * heightScale, localZ);
          if (waterKinds[index] === 2) oceanCount += 1;
        }

        const useOcean = oceanCount >= 2;
        const tint = useOcean
          ? [
              oceanRgb[0] * 0.55 + shallowRgb[0] * 0.45,
              oceanRgb[1] * 0.55 + shallowRgb[1] * 0.45,
              oceanRgb[2] * 0.55 + shallowRgb[2] * 0.45,
            ]
          : lakeRgb;
        for (let i = 0; i < 4; i += 1) {
          waterColors.push(tint[0], tint[1], tint[2]);
        }
        waterIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    if (waterPositions.length > 0) {
      const waterGeometry = new THREE.BufferGeometry();
      waterGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(waterPositions, 3),
      );
      waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
      waterGeometry.setIndex(waterIndices);
      waterGeometry.computeVertexNormals();
      previewWaterMesh = new THREE.Mesh(
        waterGeometry,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          roughness: 0.28,
          metalness: 0.08,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      previewWaterMesh.renderOrder = 2;
      scene.add(previewWaterMesh);
    }

    const midHeight =
      sampleSurfaceHeight(
        planet,
        seed,
        cartesianFromLatLonAlt(hint.latRadians, hint.lonRadians, 0, planet.radiusMeters),
      ) * heightScale;
    if (resetCameraOnRebuild) {
      endFly();
      camera.position.set(0, midHeight + 420, 780);
      orbit.target.set(0, midHeight, 0);
      camera.lookAt(orbit.target);
      orbit.update();
      resetCameraOnRebuild = false;
    }
    previewDirty = false;
  }

  function resize(): void {
    const width = Math.max(1, previewHost.clientWidth);
    const height = Math.max(1, previewHost.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame(): void {
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    if (previewDirty) rebuildPreviewMesh();
    resize();
    if (flying) updateFly(dt);
    else orbit.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  async function refreshPlanetList(): Promise<void> {
    try {
      planetList = await fetchPlanetList();
    } catch {
      planetList = [{ id: documentState.id, name: documentState.name }];
    }
  }

  async function loadPlanet(id: string): Promise<boolean> {
    if (hasUnsavedChanges() && !window.confirm('Discard unsaved planet changes?')) {
      return false;
    }
    const generation = ++loadGeneration;
    try {
      const loaded = await fetchPlanet(id);
      if (generation !== loadGeneration) return false;
      documentState = loaded;
      savedSnapshot = cloneDocument(loaded);
      activatePlanetDocument(loaded);
      rebuildForm();
      resetCameraOnRebuild = true;
      previewDirty = true;
      setStatus(`${loaded.name} (${loaded.id})`);
      return true;
    } catch (error) {
      if (generation !== loadGeneration) return false;
      setStatus(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  async function save(): Promise<boolean> {
    const parsed = parsePlanetDocument(documentState);
    if (!parsed) {
      setStatus('Invalid planet document — check id slug and fields.', true);
      return false;
    }
    try {
      const path = await savePlanet(parsed);
      documentState = parsed;
      savedSnapshot = cloneDocument(parsed);
      activatePlanetDocument(parsed);
      await refreshPlanetList();
      setStatus(`Saved ${path}`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  async function previewPlanet(): Promise<boolean> {
    const ok = await save();
    if (!ok) return false;
    const id = documentState.id;
    window.location.href = `/?boot=play&planetId=${encodeURIComponent(id)}&spawn=surface&from=editor&debug=1`;
    return true;
  }

  function openPlanetPicker(): void {
    const query = window.prompt(
      `Open planet id:\n${planetList.map((entry) => `${entry.id} — ${entry.name}`).join('\n')}`,
      documentState.id,
    );
    if (!query) return;
    void loadPlanet(query.trim());
  }

  actions.append(
    el('button', {
      className: 'ed-btn',
      text: 'Open…',
      on: { click: () => openPlanetPicker() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Save',
      on: { click: () => void save() },
    }),
    el('button', {
      className: 'ed-btn ed-btn-accent',
      text: 'Preview Planet',
      on: { click: () => void previewPlanet() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'New',
      on: {
        click: () => {
          if (hasUnsavedChanges() && !window.confirm('Discard unsaved planet changes?')) return;
          const id = window.prompt('New planet id (slug)', 'new-planet')?.trim().toLowerCase();
          if (!id) return;
          documentState = createDefaultPlanetDocument(id, id);
          savedSnapshot = cloneDocument(documentState);
          rebuildForm();
          resetCameraOnRebuild = true;
          previewDirty = true;
          setStatus(`New ${id} — unsaved`);
        },
      },
    }),
  );

  return {
    activate: () => {
      active = true;
      clock.start();
      if (!initialized) {
        initialized = true;
        rebuildForm();
        void (async () => {
          await refreshPlanetList();
          const params = new URLSearchParams(window.location.search);
          const planetId = params.get('planetId') ?? 'asteron';
          await loadPlanet(planetId);
          previewDirty = true;
        })();
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    deactivate: () => {
      active = false;
      endFly();
      cancelAnimationFrame(raf);
    },
    canLeave: () =>
      !hasUnsavedChanges() ||
      window.confirm('Leave Planet Authoring with unsaved changes?'),
    isDirty: hasUnsavedChanges,
    save,
    loadPlanet,
    getDocument: () => documentState,
    previewPlanet,
  };
}
