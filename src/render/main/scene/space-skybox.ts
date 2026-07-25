import * as THREE from 'three';

const SPACE_SKYBOX_URL = new URL(
  '../../../assets/skyboxes/blue-local-star-nebulae-4k.jpg',
  import.meta.url,
).href;

export interface SpaceSkybox {
  dispose: () => void;
  getBackground: (fallback: THREE.Color) => THREE.Color | THREE.Texture;
  initPromise: Promise<void>;
  isReady: () => boolean;
}

export function createSpaceSkybox(): SpaceSkybox {
  let texture: THREE.Texture | null = null;
  let ready = false;
  let failed = false;

  const initPromise = new THREE.TextureLoader()
    .loadAsync(SPACE_SKYBOX_URL)
    .then((loadedTexture) => {
      loadedTexture.name = 'Space Spheremaps - Blue Local Star and Nebulae';
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.mapping = THREE.EquirectangularReflectionMapping;
      loadedTexture.magFilter = THREE.LinearFilter;
      loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
      loadedTexture.generateMipmaps = true;
      texture = loadedTexture;
      ready = true;
    })
    .catch((error) => {
      failed = true;
      console.error('ClaudeCitizen space skybox init failed.', error);
    });

  function dispose(): void {
    texture?.dispose();
  }

  return {
    dispose,
    getBackground(fallback) {
      return ready && texture ? texture : fallback;
    },
    initPromise,
    isReady() {
      return ready && !failed;
    },
  };
}
