import type * as THREE from 'three';
import type { CharacterState, FlightBody, Pose, Vec3 } from '../../types';
import type { createPlayerControls } from '../../input/player-controls';
import type { ShipPhysics } from '../../physics/ship-physics';
import type { DeckCharacterState } from '../../player/ship-deck';
import type { createShipRigState } from '../../player/ship-rig';
import type { createFlightReticle } from '../../render/effects/hud/flight-reticle';
import type { createCockpitGazeHud } from '../../render/effects/hud/cockpit-gaze-hud';
import type { createCockpitSpeedHud } from '../../render/effects/hud/cockpit-speed-hud';
import type { createEntertainmentSystem } from '../../render/effects/hud/entertainment-system';
import type { createGameMenu } from '../../render/effects/hud/game-menu';
import type { createEntertainmentScreen } from '../../render/effects/entertainment-screen';
import type { createShipModel } from '../../render/main/scene/ship-model';
import type { createCharacterAvatar } from '../../render/main/scene/character-avatar';
import type { createSoundSceneController } from '../../audio/sound-scene';
import type { createFootstepController } from '../../audio/footsteps';
import type { createLoopingSfxController } from '../../audio/sfx';
import type { QuantumTravelState } from '../../flight/quantum-travel';
import type { EntertainmentCameraState } from '../../player/entertainment-camera';
import type { FlightCameraFeelResult, FlightCameraFeelState } from '../../player/flight-camera-feel';
import type { PrefabDocument } from '../../world/prefabs/schema';
import type { EffectComposer } from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';

export type SandboxMode =
  | 'deck'
  | 'ground'
  | 'pilot'
  | 'sitting'
  | 'standing'
  | 'lying'
  | 'in-bed'
  | 'getting-up';

export interface SandboxTransition {
  start: Pose;
  end: Pose;
  elapsed: number;
  duration: number;
}

export interface ShipSandboxSession {
  prefabId: string;
  walkable: boolean;
  doc: PrefabDocument | null;
  prefabApplied: boolean;
  mode: SandboxMode;
  ship: FlightBody;
  character: CharacterState | DeckCharacterState;
  rig: ReturnType<typeof createShipRigState>;
  shipPhysics: ShipPhysics | null;
  prompt: string;
  activeBedId: string | null;
  transition: SandboxTransition | null;
  autoRestPending: boolean;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  composer: EffectComposer;
  n8aoPass: N8AOPostPass | null;
  shipModel: ReturnType<typeof createShipModel>;
  avatar: ReturnType<typeof createCharacterAvatar>;
  flightReticle: ReturnType<typeof createFlightReticle>;
  cockpitGazeHud: ReturnType<typeof createCockpitGazeHud>;
  cockpitSpeedHud: ReturnType<typeof createCockpitSpeedHud>;
  entertainmentSystem: ReturnType<typeof createEntertainmentSystem>;
  esScreen: ReturnType<typeof createEntertainmentScreen>;
  esCameraState: EntertainmentCameraState;
  gameMenu: ReturnType<typeof createGameMenu>;
  soundScene: ReturnType<typeof createSoundSceneController>;
  footsteps: ReturnType<typeof createFootstepController>;
  boostSfx: ReturnType<typeof createLoopingSfxController>;
  thrustSfx: ReturnType<typeof createLoopingSfxController>;
  idleQuantum: QuantumTravelState;
  flightCameraFeelState: FlightCameraFeelState;
  flightCameraFeelFrame: FlightCameraFeelResult | null;
  fpsEl: HTMLElement;
  interactPromptEl: HTMLElement;
  lastMs: number;
  fpsAccum: number;
  fpsFrames: number;
  fpsLastUpdate: number;
}

export interface SandboxWalkActions {
  interactPressed: boolean;
  jumpPressed: boolean;
}

export interface SandboxPilotActions {
  exitSeatPressed: boolean;
  coupledToggled?: boolean;
  primaryClickPressed?: boolean;
}

export interface SandboxBedActions {
  exitSeatPressed: boolean;
  interactPressed: boolean;
}

export const SANDBOX_GRAVITY = 9.8;
export const PAD_RADIUS_METERS = 42;
export const SANDBOX_GROUND_Y_METERS = 0.05;
export const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
export const SHIP_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
