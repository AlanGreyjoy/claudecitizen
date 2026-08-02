import {
  bedInteractPrompt,
  chairInteractPromptFromDeck,
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  isOnShipRampDeck,
  nearestBed,
  nearestChair,
  nearestDeckLadder,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  resolveDoorInteractAim,
  seatInteractPrompt,
  updateCharacterClimbingOnDeck,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from '../../player/ship-deck';
import { findLadderById } from '../../world/ladders';
import { getShipLayout } from '../../player/ship-layout';
import {
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
} from '../../physics/ship-physics';
import { getPilotSeatAnchor, getBedAnchor, nearShipRampOutside } from '../../player/ship-interaction';
import { doorBlends } from '../../player/ship-rig';
import { playSfx } from '../../audio/sfx';
import { playShipRampToggleSfx } from '../../player/ship-articulation-sfx';
import { CHAIR_SIT_TRANSITION_SECONDS, LIE_TRANSITION_SECONDS } from '../../player/modes';
import { getSandboxChairAnchor } from './chair';
import type { ShipSandboxSession, SandboxWalkActions } from './types';
import { PAD_RADIUS_METERS, SANDBOX_GRAVITY } from './types';

const SIT_SECONDS = 1.3;

function sandboxPadRestHeightMeters(session: ShipSandboxSession): number {
  return Math.max(0.3, session.ship.position.y - 0.05);
}

function clampLocalToSandboxPad(right: number, forward: number): {
  right: number;
  forward: number;
} {
  const radial = Math.hypot(right, forward);
  const maxR = PAD_RADIUS_METERS - 2;
  if (radial <= maxR || radial < 1e-4) return { right, forward };
  const pull = maxR / radial;
  return { right: right * pull, forward: forward * pull };
}

function softTagWalkModeFromPad(session: ShipSandboxSession): void {
  if (!session.shipPhysics) return;
  const local = getShipPlayerLocal(session.shipPhysics);
  const onPad =
    Math.abs(local.up + sandboxPadRestHeightMeters(session)) <= 0.85;
  session.mode = onPad ? 'ground' : 'deck';
}

function colliderRig(session: ShipSandboxSession) {
  return {
    gear01: session.rig.gear01,
    ramp01: session.rig.ramp01,
    doors: doorBlends(session.rig),
  };
}

function handleDismount(session: ShipSandboxSession, deckLocal: { right: number; forward: number }): void {
  const rest = sandboxPadRestHeightMeters(session);
  const rig = colliderRig(session);
  const clamped = clampLocalToSandboxPad(deckLocal.right, deckLocal.forward);
  teleportShipPlayerLocal(session.shipPhysics!, {
    right: clamped.right,
    up: -rest + DECK_FLOOR_OFFSET_METERS,
    forward: clamped.forward,
  });
  session.character = createDeckCharacterState(
    session.ship,
    clamped,
    undefined,
    rig,
    -rest,
  );
  session.character.position = getShipPlayerWorldPosition(session.shipPhysics!, session.ship);
  softTagWalkModeFromPad(session);
}

function handlePadRampInteract(session: ShipSandboxSession, actions: SandboxWalkActions): boolean {
  if (!nearShipRampOutside(session.character, session.ship)) return false;
  session.prompt = session.rig.rampDown ? 'Press F — raise ramp' : 'Press F — lower ramp';
  if (actions.interactPressed) {
    session.rig.rampDown = !session.rig.rampDown;
    playShipRampToggleSfx(getShipLayout().spec, session.rig.rampDown);
  }
  return true;
}

function handleSeatInteract(
  session: ShipSandboxSession,
  deckLocal: DeckCharacterState['deckLocal'],
  actions: SandboxWalkActions,
): boolean {
  const seatNearby = nearestSeat(deckLocal);
  if (!seatNearby) return false;
  session.prompt = seatInteractPrompt(seatNearby);
  if (actions.interactPressed && seatNearby.role === 'pilot') {
    session.transition = {
      start: {
        forward: session.character.forward,
        position: session.character.position,
        up: session.character.up,
      },
      end: getPilotSeatAnchor(session.ship),
      elapsed: 0,
      duration: SIT_SECONDS,
    };
    session.mode = 'sitting';
  }
  return true;
}

function handleChairInteract(
  session: ShipSandboxSession,
  deckLocal: DeckCharacterState['deckLocal'],
  doorAim: ReturnType<typeof resolveDoorInteractAim>,
  actions: SandboxWalkActions,
): boolean {
  const chairNearby = nearestChair(deckLocal, doorAim);
  if (!chairNearby) return false;
  session.prompt = chairInteractPromptFromDeck(chairNearby);
  if (actions.interactPressed) {
    const end = getSandboxChairAnchor(session.ship, chairNearby.id);
    if (!end) return true;
    session.activeChairId = chairNearby.id;
    session.transition = {
      start: {
        forward: session.character.forward,
        position: session.character.position,
        up: session.character.up,
      },
      end,
      elapsed: 0,
      duration: CHAIR_SIT_TRANSITION_SECONDS,
    };
    session.mode = 'chair-sitting';
  }
  return true;
}

function handleBedInteract(
  session: ShipSandboxSession,
  deckLocal: DeckCharacterState['deckLocal'],
  doorAim: ReturnType<typeof resolveDoorInteractAim>,
  actions: SandboxWalkActions,
): boolean {
  const bedNearby = nearestBed(deckLocal, doorAim);
  if (!bedNearby) return false;
  session.prompt = bedInteractPrompt(bedNearby);
  if (actions.interactPressed) {
    session.activeBedId = bedNearby.id;
    session.transition = {
      start: {
        forward: session.character.forward,
        position: session.character.position,
        up: session.character.up,
      },
      end: getBedAnchor(session.ship, bedNearby.id),
      elapsed: 0,
      duration: LIE_TRANSITION_SECONDS,
    };
    session.mode = 'lying';
  }
  return true;
}

function handleDoorInteract(
  session: ShipSandboxSession,
  deckLocal: DeckCharacterState['deckLocal'],
  doorAim: ReturnType<typeof resolveDoorInteractAim>,
  actions: SandboxWalkActions,
): boolean {
  const doorNearby = nearestDoor(deckLocal, doorAim);
  if (!doorNearby) return false;
  const door = getShipLayout().doors.find((entry) => entry.id === doorNearby.doorId);
  const doorRig = session.rig.doors[doorNearby.doorId];
  if (!door || !doorRig) return false;
  session.prompt = doorRig.isOpen
    ? `Press F — close ${door.label}`
    : `Press F — open ${door.label}`;
  if (actions.interactPressed) {
    doorRig.isOpen = !doorRig.isOpen;
    const sfx = doorRig.isOpen ? door.openSoundUrl : door.closeSoundUrl;
    if (sfx) playSfx(sfx);
  }
  return true;
}

function handleInteriorRampInteract(
  session: ShipSandboxSession,
  deckLocal: DeckCharacterState['deckLocal'],
  actions: SandboxWalkActions,
): void {
  const standingOnRamp = isOnShipRampDeck(deckLocal);
  if (!nearRampPanel(deckLocal) || standingOnRamp) return;
  session.prompt = session.rig.rampDown ? 'Press F — raise ramp' : 'Press F — lower ramp';
  if (actions.interactPressed) {
    session.rig.rampDown = !session.rig.rampDown;
    playShipRampToggleSfx(getShipLayout().spec, session.rig.rampDown);
  }
}

function handleLadderInteract(
  session: ShipSandboxSession,
  actions: SandboxWalkActions,
): boolean {
  if (!session.shipPhysics) return false;
  const mount = nearestDeckLadder(getShipPlayerLocal(session.shipPhysics));
  if (!mount) return false;
  session.prompt = `Press F — climb ${mount.ladder.label || 'ladder'}`;
  if (actions.interactPressed) {
    session.ladderClimb = {
      surface: 'ship',
      ladderId: mount.ladder.id,
      along: mount.along,
    };
  }
  return true;
}

/**
 * Ladder climbing replaces deck locomotion while attached. Returns false when
 * not on a ladder so the caller falls through to walking.
 */
function updateLadderClimb(
  session: ShipSandboxSession,
  dt: number,
  actions: SandboxWalkActions,
): boolean {
  const climb = session.ladderClimb;
  if (!climb) return false;
  const ladder = findLadderById(getShipLayout().ladders, climb.ladderId);
  if (!ladder || actions.jumpPressed) {
    session.ladderClimb = null;
    return false;
  }
  const result = updateCharacterClimbingOnDeck(
    session.character as DeckCharacterState,
    session.ship,
    ladder,
    session.controls.sampleCharacterInput(),
    dt,
    session.shipPhysics,
  );
  session.character = result.state;
  session.mode = 'deck';
  if (result.exit === 'none') {
    climb.along = result.along;
    session.prompt = 'Forward / back to climb · Space to let go';
    return true;
  }
  session.ladderClimb = null;
  session.prompt = '';
  return true;
}

function handleDeckInteractions(
  session: ShipSandboxSession,
  state: DeckCharacterState,
  actions: SandboxWalkActions,
): void {
  const deckLocal = state.deckLocal;
  if (session.mode === 'ground') {
    handlePadRampInteract(session, actions);
    return;
  }
  if (handleSeatInteract(session, deckLocal, actions)) return;
  const cameraState = session.controls.sampleCameraState(0);
  const doorAim = resolveDoorInteractAim(
    session.ship,
    state.position,
    cameraState.yawRadians,
    cameraState.pitchRadians,
    cameraState.zoomDistance,
  );
  if (handleChairInteract(session, deckLocal, doorAim, actions)) return;
  if (handleBedInteract(session, deckLocal, doorAim, actions)) return;
  if (handleDoorInteract(session, deckLocal, doorAim, actions)) return;
  handleInteriorRampInteract(session, deckLocal, actions);
  if (session.prompt) return;
  handleLadderInteract(session, actions);
}

export function updateShipSandboxWalk(
  session: ShipSandboxSession,
  dt: number,
  actions: SandboxWalkActions,
): void {
  if (!session.shipPhysics) return;
  const input = session.controls.sampleCharacterInput();
  const rig = colliderRig(session);
  session.shipPhysics.setPadEnabled(true);
  syncShipArticulationColliders(
    session.shipPhysics,
    rig,
    getShipLayout().doors.map((door) => door.id),
  );
  if (updateLadderClimb(session, dt, actions)) return;
  const result = updateCharacterOnDeck(
    session.character as DeckCharacterState,
    session.ship,
    { ...input, jumpPressed: actions.jumpPressed },
    dt,
    SANDBOX_GRAVITY,
    session.shipPhysics,
  );
  session.character = result.state;
  session.prompt = '';

  if (result.dismounted || result.fellOffDeck) {
    handleDismount(session, result.state.deckLocal);
    return;
  }

  softTagWalkModeFromPad(session);
  handleDeckInteractions(session, result.state, actions);
}
