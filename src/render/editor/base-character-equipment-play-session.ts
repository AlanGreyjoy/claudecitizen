import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import type { AnimationControllerV1, AnimationLocomotionKind } from '../../player/animation/schema';
import { createPlayerControls } from '../../input/player-controls';
import type { BaseCharacterEquipmentV1 } from '../../player/equipment/base-character-equipment';
import type { BackpackDefinition, WeaponDefinition } from '../../net/admin-api';
import type { CharacterState, JumpPhase, Vec3 } from '../../types';
import type { WeaponSelectSlotId } from '../../player/inventory/weapon-select';
import type { WalkGait } from '../../player/character-locomotion';
import type { SidekickAnimationRuntime } from '../characters/sidekick/animation-runtime';
import type { SidekickUpperBodyAimController } from '../characters/sidekick/upper-body-aim';
import type { SidekickAvatarInstance } from '../characters/sidekick/assemble-avatar';
import type { CharacterPreviewPose } from './base-character-equipment-ui';
import type { CatalogDefinition } from './base-character-equipment-utils';
import { vec3 } from '../../math/vec3';
import {
  renderPlayTestHud,
  setPlayTestActive as setPlayTestActiveState,
  stopPlayTestControls,
  syncPlayTestAnimation,
} from './base-character-equipment-play-active';
import { updatePlayTestFrame } from './base-character-equipment-play-update';

export type { CatalogDefinition };

interface PlayTestDefaultAssignment {
  slotId: 'backpack' | WeaponSelectSlotId;
  definition: CatalogDefinition;
}

export const PLAY_TEST_DEFAULT_ASSIGNMENTS: readonly PlayTestDefaultAssignment[] = [
  {
    slotId: 'backpack',
    definition: {
      id: 'demo-backpack',
      name: 'Demo Backpack',
      description: 'Base Character play-test backpack.',
      itemType: 'backpack',
      subType: 'field',
      prefabId: 'demo-backpack',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      capacityLiters: 48,
      emptyMassKg: 2.5,
    },
  },
  {
    slotId: 'rifle-primary',
    definition: {
      id: 'assault-01',
      name: 'Assault 01',
      description: 'Base Character primary-rifle play-test weapon.',
      itemType: 'weapon',
      subType: 'rifle',
      prefabId: 'assault-01',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'rifle',
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
    },
  },
  {
    slotId: 'rifle-secondary',
    definition: {
      id: 'brown-50',
      name: 'Brown 50',
      description: 'Base Character secondary-rifle play-test weapon.',
      itemType: 'weapon',
      subType: 'rifle',
      prefabId: 'brown-50',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'rifle',
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
    },
  },
  {
    slotId: 'handgun',
    definition: {
      id: 'twin-horned-pistol',
      name: 'Twin Horned Pistol',
      description: 'Base Character handgun play-test weapon.',
      itemType: 'weapon',
      subType: 'handgun',
      prefabId: 'twin-horned-pistol',
      iconUrl: null,
      stackMax: 1,
      costArc: 0,
      rarity: 'common',
      createdAt: '',
      updatedAt: '',
      weaponSlotType: 'handgun',
      ammoItemDefinitionId: null,
      magazineSize: 30,
      fireModes: ['single'],
      roundsPerMinute: 600,
      muzzleVelocityMps: 850,
      bulletGravityMps2: 9.81,
      maxRangeMeters: 1000,
      damage: 20,
    },
  },
] as const;

const PLAY_TEST_STAGE_FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
const PLAY_TEST_WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

export function createPlayTestCharacterState(): CharacterState {
  return {
    animation: 'Idle_Loop',
    forward: { ...PLAY_TEST_STAGE_FORWARD },
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: vec3(0, 0, 0),
    up: { ...PLAY_TEST_WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
}

export interface PlayTestSessionContext {
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement;
  playTestHud: HTMLDivElement;
  playTestHudState: HTMLDivElement;
  playTestHudLoadout: HTMLDivElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  previewRoot: THREE.Group;
  getPlayTestActive: () => boolean;
  setPlayTestActive: (value: boolean) => void;
  getPlayTestWeaponSlotId: () => WeaponSelectSlotId | null;
  setPlayTestWeaponSlotId: (value: WeaponSelectSlotId | null) => void;
  getPlayTestCharacter: () => CharacterState;
  setPlayTestCharacter: (value: CharacterState) => void;
  getPlayTestHardAim: () => boolean;
  setPlayTestHardAim: (value: boolean) => void;
  getPlayTestAimZoom01: () => number;
  setPlayTestAimZoom01: (value: number) => void;
  getPlayTestAnimationKey: () => string;
  setPlayTestAnimationKey: (value: string) => void;
  getPlayTestAnimationGeneration: () => number;
  bumpPlayTestAnimationGeneration: () => number;
  getPlayTestPoseBefore: () => CharacterPreviewPose;
  setPlayTestPoseBefore: (value: CharacterPreviewPose) => void;
  getPlayTestStanceBefore: () => string;
  setPlayTestStanceBefore: (value: string) => void;
  getPlayTestLocomotionBefore: () => AnimationLocomotionKind;
  setPlayTestLocomotionBefore: (value: AnimationLocomotionKind) => void;
  getPlayTestClipBefore: () => string;
  setPlayTestClipBefore: (value: string) => void;
  getAuthoringCameraSuspended: () => boolean;
  setAuthoringCameraSuspended: (value: boolean) => void;
  getSelectedStanceId: () => string;
  setSelectedStanceId: (value: string) => void;
  getPreviewLocomotion: () => AnimationLocomotionKind;
  setPreviewLocomotion: (value: AnimationLocomotionKind) => void;
  getControllerState: () => AnimationControllerV1 | null;
  getAnimation: () => SidekickAnimationRuntime | null;
  getAvatar: () => SidekickAvatarInstance | null;
  getDocumentState: () => BaseCharacterEquipmentV1 | null;
  getAssignments: () => Map<string, CatalogDefinition>;
  getPreviewPose: () => CharacterPreviewPose;
  getWeapons: () => WeaponDefinition[];
  getBackpacks: () => BackpackDefinition[];
  playTestControls: { current: ReturnType<typeof createPlayerControls> | null };
  playTestWeaponButtons: Map<WeaponSelectSlotId, HTMLButtonElement>;
  playTestCameraPositionBefore: THREE.Vector3;
  playTestCameraTargetBefore: THREE.Vector3;
  playTestDesiredCameraPos: THREE.Vector3;
  playTestDesiredCameraTarget: THREE.Vector3;
  playTestSmoothedCameraPos: THREE.Vector3;
  playTestSmoothedCameraTarget: THREE.Vector3;
  playTestUpperAimView: THREE.Vector3;
  playTestUpperAimUp: THREE.Vector3;
  playTestUpperAimForward: THREE.Vector3;
  playTestUpperAimPlanarView: THREE.Vector3;
  playTestUpperAimCross: THREE.Vector3;
  getControllerUpperBodyAim: () => SidekickUpperBodyAimController | null;
  endFly: () => void;
  ensureAvatar: () => Promise<void>;
  setPreviewPose: (pose: CharacterPreviewPose) => Promise<void>;
  rebuildEquipmentPreview: () => Promise<void>;
  ensureControllerClipLoaded: (clip: string) => Promise<string | null>;
  ensureAnimatedPose: () => Promise<void>;
  setStageStatus: (message: string, error?: boolean) => void;
  notifyUiChange: () => void;
  syncGizmo: () => void;
}

export function equipDefaultPlayTestLoadout(
  ctx: Pick<PlayTestSessionContext, 'getAssignments' | 'getWeapons' | 'getBackpacks'>,
  overwrite = false,
): boolean {
  const assignments = ctx.getAssignments();
  const weapons = ctx.getWeapons();
  const backpacks = ctx.getBackpacks();
  let changed = false;
  for (const entry of PLAY_TEST_DEFAULT_ASSIGNMENTS) {
    const current = assignments.get(entry.slotId);
    const shouldReplaceFallback = current === entry.definition;
    if (!overwrite && current && !shouldReplaceFallback) continue;
    const catalog = entry.definition.itemType === 'backpack' ? backpacks : weapons;
    const next = catalog.find((definition) =>
      definition.prefabId === entry.definition.prefabId
      && definition.itemType === entry.definition.itemType
    ) ?? entry.definition;
    if (current === next) continue;
    assignments.set(entry.slotId, next);
    changed = true;
  }
  return changed;
}

export function createPlayTestSession(ctx: PlayTestSessionContext): {
  renderPlayTestHud: () => void;
  updatePlayTest: (deltaSeconds: number) => void;
  setPlayTestActive: (nextActive: boolean) => Promise<void>;
  stopPlayTestControls: () => void;
  onPlayTestKeyDown: (event: KeyboardEvent) => void;
} {
  const renderHud = (): void => renderPlayTestHud(ctx, selectPlayTestWeapon);

  async function selectPlayTestWeapon(
    slotId: WeaponSelectSlotId | null,
    toggle = true,
  ): Promise<void> {
    if (!ctx.getPlayTestActive()) return;
    equipDefaultPlayTestLoadout(ctx);
    const nextSlotId = toggle && slotId === ctx.getPlayTestWeaponSlotId() ? null : slotId;
    ctx.setPlayTestWeaponSlotId(nextSlotId);
    ctx.setPlayTestAnimationKey('');
    ctx.playTestControls.current?.setCombatInputActive(nextSlotId !== null);
    renderHud();
    await ctx.rebuildEquipmentPreview();
    if (!ctx.getPlayTestActive()) return;
    await syncPlayTestAnimation(ctx, renderHud, true);
    ctx.canvas.focus();
  }

  const syncAnimation = (
    force?: boolean,
    locomotion?: {
      isMoving?: boolean;
      isCrouching?: boolean;
      gait?: WalkGait;
      jumpPhase?: JumpPhase;
    },
  ): Promise<void> => syncPlayTestAnimation(ctx, renderHud, force, locomotion);

  return {
    renderPlayTestHud: renderHud,
    updatePlayTest: (deltaSeconds) => updatePlayTestFrame(ctx, deltaSeconds, selectPlayTestWeapon, syncAnimation),
    setPlayTestActive: (nextActive) => setPlayTestActiveState(ctx, nextActive, renderHud, (force) => syncAnimation(force)),
    stopPlayTestControls: () => stopPlayTestControls(ctx),
    onPlayTestKeyDown: (event) => {
      if (!ctx.getPlayTestActive()) return;
      if (event.ctrlKey || event.metaKey) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        void setPlayTestActiveState(ctx, false, renderHud, (force) => syncAnimation(force));
      }
    },
  };
}
