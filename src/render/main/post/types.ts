import type * as THREE from 'three';
import type {
  ColorCorrectionSettings,
  FogSettings,
  SsaoSettings,
  Vec3,
} from '../../../types';

export interface MainPostEnvironmentFrame {
  camera: THREE.PerspectiveCamera;
  dt: number;
  altitudeMeters: number;
  atmosphereHeightMeters: number;
  focusPosition: Vec3;
  volumetricEnabled: boolean;
  planetFogActive: boolean;
  stationInteriorActive: boolean;
  renderScale: number;
  planetCenter: THREE.Vector3;
  planetRadiusMeters: number;
  sunDirection: THREE.Vector3;
  backgroundColor: THREE.Color;
  fogColorDay: THREE.Color;
  fogColorNight: THREE.Color;
  sunColor: THREE.Color;
  nowSeconds: number;
  daylightFactor: number;
  spaceFactor: number;
  /** auto = altitude gate; solid = never skybox; space-skybox = always. */
  backgroundMode: 'auto' | 'solid' | 'space-skybox';
}

export interface MainPostEnvironmentResult {
  background: THREE.Color | THREE.Texture;
  volumetricSkyActive: boolean;
}

export interface MainPostBloomSettings {
  intensity?: number;
  luminanceThreshold?: number;
  luminanceSmoothing?: number;
}

/**
 * Backend-neutral control surface for the main scene's post-processing graph.
 *
 * Frame and environment code describe presentation intent through this
 * interface; WebGL passes, WebGPU nodes, and their resource ownership remain
 * private to the implementation.
 */
export interface MainPostStack {
  render: (deltaSeconds: number) => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  setEffectsEnabled: (enabled: boolean) => void;
  setSpeedBlurStrength: (strength: number) => void;
  updateMotionBlurCamera: (
    camera: THREE.PerspectiveCamera,
    focusPosition: THREE.Vector3,
    renderScale: number,
  ) => void;
  resetMotionBlur: () => void;
  updateEnvironment: (
    frame: MainPostEnvironmentFrame,
  ) => MainPostEnvironmentResult;
  setFogSettings: (settings: FogSettings) => void;
  setColorCorrectionSettings: (
    settings: Partial<ColorCorrectionSettings>,
  ) => void;
  setAmbientOcclusionSettings: (settings: Partial<SsaoSettings>) => void;
  setAmbientOcclusionColor: (color: string | null) => void;
  setBloomSettings: (settings: MainPostBloomSettings) => void;
  setExposure: (exposure: number) => void;
  dispose: () => void;
}
