import {
  bedInteractPrompt,
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  isOnShipRampDeck,
  nearestBed,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  resolveDoorInteractAim,
  seatInteractPrompt,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from '../../player/ship_deck';
import { getShipLayout } from '../../player/ship_layout';
import {
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
} from '../../physics/ship_physics';
import { getPilotSeatAnchor, getBedAnchor, nearShipRampOutside } from '../../player/ship_interaction';
import { doorBlends } from '../../player/ship_rig';
import { playSfx } from '../../audio/sfx';
import { playShipRampToggleSfx } from '../../player/ship_articulation_sfx';
import { LIE_TRANSITION_SECONDS } from '../../player/modes';
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
  if (handleBedInteract(session, deckLocal, doorAim, actions)) return;
  if (handleDoorInteract(session, deckLocal, doorAim, actions)) return;
  handleInteriorRampInteract(session, deckLocal, actions);
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
