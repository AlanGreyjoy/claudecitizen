import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { CharacterPartType } from '../player/character_creator/sidekick_manifest';
import {
  buildDefaultDefinition,
  findPreviewSpecies,
  getPartsForSpecies,
  loadSidekickCatalog,
} from '../player/character_creator/sidekick_catalog';
import {
  getDefinitionPartName,
  setDefinitionPart,
  type SidekickCharacterDefinition,
} from '../player/character_creator/sidekick_definition';
import { assembleSidekickCharacter } from '../render/characters/sidekick/assemble_avatar';
import {
  canRetargetUalToUnityHumanoid,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
} from '../render/characters/unity_humanoid_retarget';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const loader = new GLTFLoader();

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement))
    throw new Error(`Missing #${id} element for Sidekick preview.`);
  return element as T;
}

function showPreviewShell(): HTMLCanvasElement {
  hideTitleScreen();
  requireElement<HTMLElement>('app').classList.remove('is-hidden');

  for (const selector of [
    '.sc-hud-minimap',
    '.sc-hud-chat',
    '.sc-hud-debug-wrap',
    '.hud',
    '#interact-prompt',
    '#flight-reticle',
    '#vegetation-menu',
    '#game-menu',
    '#avms-terminal',
    '#build-terminal',
    '#haloband',
  ]) {
    document.querySelector<HTMLElement>(selector)?.style.setProperty('display', 'none');
  }

  const canvas = requireElement<HTMLCanvasElement>('view');
  if (!(canvas instanceof HTMLCanvasElement))
    throw new Error('Missing #view canvas for Sidekick preview.');
  return canvas;
}

function hideTitleScreen(): void {
  document.getElementById('title-screen')?.classList.add('is-hidden');
  document.getElementById('loading-screen')?.classList.add('is-hidden');
}

function createControlsPanel(): {
  root: HTMLDivElement;
  setStatus: (text: string) => void;
  setHairLabel: (text: string) => void;
  setTorsoLabel: (text: string) => void;
  onHairPrev: (handler: () => void) => void;
  onHairNext: (handler: () => void) => void;
  onTorsoPrev: (handler: () => void) => void;
  onTorsoNext: (handler: () => void) => void;
} {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed',
    'left:16px',
    'bottom:16px',
    'z-index:30',
    'padding:12px 14px',
    'border-radius:10px',
    'background:rgba(8,14,28,0.84)',
    'color:#e8efff',
    'font:600 14px/1.4 Rajdhani,sans-serif',
    'min-width:280px',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Sidekick Preview';
  title.style.cssText = 'font-size:18px;margin-bottom:8px;letter-spacing:0.04em;';

  const status = document.createElement('div');
  status.style.cssText = 'opacity:0.85;margin-bottom:10px;';

  const hairLabel = document.createElement('div');
  const torsoLabel = document.createElement('div');
  hairLabel.style.marginBottom = '6px';
  torsoLabel.style.marginBottom = '10px';

  const buttonRow = (label: string, onPrev: () => void, onNext: () => void): HTMLDivElement => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const text = document.createElement('span');
    text.textContent = label;
    text.style.flex = '1';
    const prev = document.createElement('button');
    prev.textContent = 'Prev';
    const next = document.createElement('button');
    next.textContent = 'Next';
    for (const button of [prev, next]) {
      button.style.cssText = 'padding:4px 10px;border:1px solid rgba(139,216,255,0.5);background:rgba(20,34,58,0.9);color:#e8efff;border-radius:6px;cursor:pointer;';
      button.type = 'button';
    }
    prev.addEventListener('click', onPrev);
    next.addEventListener('click', onNext);
    row.append(text, prev, next);
    return row;
  };

  const hairHandlers: Array<() => void> = [];
  const torsoHandlers: Array<() => void> = [];
  const hairRow = buttonRow('Hair', () => hairHandlers[0]?.(), () => hairHandlers[1]?.());
  const torsoRow = buttonRow('Torso', () => torsoHandlers[0]?.(), () => torsoHandlers[1]?.());

  root.append(title, status, hairLabel, torsoLabel, hairRow, torsoRow);
  document.body.append(root);

  return {
    root,
    setStatus: (text) => {
      status.textContent = text;
    },
    setHairLabel: (text) => {
      hairLabel.textContent = `Hair: ${text}`;
    },
    setTorsoLabel: (text) => {
      torsoLabel.textContent = `Torso: ${text}`;
    },
    onHairPrev: (handler) => {
      hairHandlers[0] = handler;
    },
    onHairNext: (handler) => {
      hairHandlers[1] = handler;
    },
    onTorsoPrev: (handler) => {
      torsoHandlers[0] = handler;
    },
    onTorsoNext: (handler) => {
      torsoHandlers[1] = handler;
    },
  };
}

function cyclePart(
  parts: { name: string }[],
  currentName: string | null,
  direction: -1 | 1,
): string | null {
  if (parts.length === 0)
    return null;
  const index = Math.max(
    0,
    parts.findIndex((part) => part.name === currentName),
  );
  const nextIndex = (index + direction + parts.length) % parts.length;
  return parts[nextIndex]?.name ?? null;
}

export async function startSidekickPreviewSession(): Promise<void> {
  const canvas = showPreviewShell();
  const panel = createControlsPanel();
  panel.setStatus('Loading Sidekick catalog...');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101826);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(0, 1.55, 2.8);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.2, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xb8c4dc, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(2.5, 4.5, 2.0);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  let catalog;
  try {
    catalog = await loadSidekickCatalog();
  } catch (error) {
    panel.setStatus(
      error instanceof Error ? error.message : 'Failed to load Sidekick manifest.',
    );
    console.error('Sidekick preview failed to load catalog.', error);
    return;
  }

  const species = findPreviewSpecies(catalog);
  if (!species) {
    panel.setStatus('No species found in Sidekick manifest.');
    return;
  }

  let definition: SidekickCharacterDefinition = buildDefaultDefinition(catalog, species);
  let assembled: Awaited<ReturnType<typeof assembleSidekickCharacter>> | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let activeAction: THREE.AnimationAction | null = null;
  const clock = new THREE.Clock();

  const hairParts = getPartsForSpecies(catalog, species.id, CharacterPartType.Hair);
  const torsoParts = getPartsForSpecies(catalog, species.id, CharacterPartType.Torso);

  const updateLabels = (): void => {
    panel.setHairLabel(getDefinitionPartName(definition, CharacterPartType.Hair) ?? 'None');
    panel.setTorsoLabel(getDefinitionPartName(definition, CharacterPartType.Torso) ?? 'None');
  };

  const rebuildCharacter = async (): Promise<void> => {
    panel.setStatus('Assembling character...');
    if (assembled) {
      scene.remove(assembled.root);
      assembled.dispose();
      assembled = null;
    }
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
      activeAction = null;
    }

    try {
      assembled = await assembleSidekickCharacter(catalog, definition);
      scene.add(assembled.root);

      try {
        const box = new THREE.Box3().setFromObject(assembled.root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        controls.target.copy(center);
        camera.position.set(center.x, center.y + size.y * 0.15, center.z + Math.max(2.2, size.y * 1.35));
        controls.update();
      } catch (framingError) {
        console.warn('Sidekick preview: camera framing skipped.', framingError);
        controls.target.set(0, 1.2, 0);
        camera.position.set(0, 1.55, 2.8);
        controls.update();
      }

      updateLabels();
      panel.setStatus(`Previewing ${species.name} (${definition.parts.length} parts)`);

      try {
        const animationGltf = await new Promise<THREE.Object3D>((resolve, reject) => {
          loader.load(
            UNIVERSAL_ANIMATION_LIBRARY_URL,
            (gltf) => resolve(gltf.scene),
            undefined,
            reject,
          );
        });
        const clips = await new Promise<THREE.AnimationClip[]>((resolve, reject) => {
          loader.load(
            UNIVERSAL_ANIMATION_LIBRARY_URL,
            (gltf) => resolve(gltf.animations),
            undefined,
            reject,
          );
        });
        if (canRetargetUalToUnityHumanoid(assembled.root, animationGltf)) {
          const retargeted = retargetUnityHumanoidAnimations(assembled.root, animationGltf, clips);
          const idle = retargeted.find((clip) => clip.name === 'Idle_Loop') ?? retargeted[0];
          if (idle) {
            const skinned = findFirstSkinnedMesh(assembled.root);
            mixer = new THREE.AnimationMixer(skinned ?? assembled.root);
            activeAction = mixer.clipAction(idle);
            activeAction.play();
          }
        }
      } catch (error) {
        console.warn('Sidekick preview: animation retarget skipped.', error);
      }
    } catch (error) {
      console.error('Sidekick preview assembly failed.', error);
      panel.setStatus(error instanceof Error ? error.message : 'Character assembly failed.');
    }
  };

  panel.onHairPrev(() => {
    const nextName = cyclePart(
      hairParts,
      getDefinitionPartName(definition, CharacterPartType.Hair),
      -1,
    );
    if (!nextName)
      return;
    definition = setDefinitionPart(definition, CharacterPartType.Hair, nextName);
    void rebuildCharacter();
  });
  panel.onHairNext(() => {
    const nextName = cyclePart(
      hairParts,
      getDefinitionPartName(definition, CharacterPartType.Hair),
      1,
    );
    if (!nextName)
      return;
    definition = setDefinitionPart(definition, CharacterPartType.Hair, nextName);
    void rebuildCharacter();
  });
  panel.onTorsoPrev(() => {
    const nextName = cyclePart(
      torsoParts,
      getDefinitionPartName(definition, CharacterPartType.Torso),
      -1,
    );
    if (!nextName)
      return;
    definition = setDefinitionPart(definition, CharacterPartType.Torso, nextName);
    void rebuildCharacter();
  });
  panel.onTorsoNext(() => {
    const nextName = cyclePart(
      torsoParts,
      getDefinitionPartName(definition, CharacterPartType.Torso),
      1,
    );
    if (!nextName)
      return;
    definition = setDefinitionPart(definition, CharacterPartType.Torso, nextName);
    void rebuildCharacter();
  });

  const onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  window.addEventListener('resize', onResize);

  let disposed = false;
  const animate = (): void => {
    if (disposed)
      return;
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    mixer?.update(dt);
    controls.update();
    renderer.render(scene, camera);
  };

  void rebuildCharacter().then(() => {
    animate();
  });

  window.addEventListener('beforeunload', () => {
    disposed = true;
    window.removeEventListener('resize', onResize);
    assembled?.dispose();
    panel.root.remove();
    renderer.dispose();
  });
}
