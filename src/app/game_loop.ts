import { integrateFlightBody, integrateHoveringShip } from '../flight/flight_body';
import { createPlayerControls } from '../flight/player_controls';
import {
  MODE_IN_SHIP,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from '../player/modes';
import { updateCharacterState } from '../player/character_controller';
import {
  canExitFromDeck,
  canReturnToPilot,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from '../player/ship_deck';
import { canEnterShip } from '../player/ship_interaction';
import {
  beginEnterTransition,
  beginExitTransition,
  beginLeavePilotTransition,
  beginReturnToPilotTransition,
  updateTransition,
} from '../player/transitions';
import { createWorldState, type WorldState } from '../player/world_state';
import { sampleRenderablePlanetSurface } from '../world/planet_surface';
import type { HudUpdateParams } from '../render/hud';
import type { SpikeRenderer } from '../render/spike_renderer';
import type { Planet } from '../types';

type PlayerControls = ReturnType<typeof createPlayerControls>;

export interface GameLoopOptions {
  planet: Planet;
  seed: number;
  controls: PlayerControls;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
}

export function createGameLoop({
  planet,
  seed,
  controls,
  renderer,
  rendererError,
  onHudUpdate,
  onResetPeak,
}: GameLoopOptions) {
  let world: WorldState = createWorldState(planet, seed);
  let lastMs = performance.now();

  const transitionContext = {
    planet,
    seed,
    setControlsMode: controls.setMode.bind(controls),
  };

  function resetWorld(): void {
    world = createWorldState(planet, seed);
    controls.setMode(MODE_ON_FOOT);
    onResetPeak();
  }

  function frame(nowMs: number): void {
    const dt = Math.min((nowMs - lastMs) / 1000, 1 / 30);
    lastMs = nowMs;

    controls.setMode(world.mode === MODE_IN_SHIP ? MODE_IN_SHIP : MODE_ON_FOOT);
    const actions = controls.consumeActions();
    const camera = controls.sampleCameraState(dt);
    world.cameraOrbit = {
      pitchRadians: camera.pitchRadians,
      yawRadians: camera.yawRadians,
      zoomDistance: camera.zoomDistance,
    };
    world.shipCameraZoom = camera.shipZoomDistance;

    const characterInput = controls.sampleCharacterInput();

    if (world.mode === MODE_ON_FOOT) {
      world.character = updateCharacterState(
        world.character,
        {
          ...characterInput,
          jumpPressed: actions.jumpPressed,
        },
        dt,
        planet,
        seed,
      );
      world.prompt = canEnterShip(world.character, world.ship) ? 'Press F to enter' : '';
      if (actions.interactPressed && canEnterShip(world.character, world.ship)) {
        beginEnterTransition(world);
      }
    } else if (world.mode === MODE_IN_SHIP) {
      world.ship = integrateFlightBody(
        world.ship,
        controls.sampleFlightInput(),
        dt,
        planet,
        seed,
      );
      world.prompt = 'Press F to walk the deck';
      if (actions.interactPressed) {
        beginLeavePilotTransition(world);
      }
    } else if (world.mode === MODE_ON_SHIP_DECK) {
      world.ship = integrateHoveringShip(world.ship, dt, planet, seed);
      world.character = updateCharacterOnDeck(
        world.character as DeckCharacterState,
        world.ship,
        characterInput,
        dt,
      );
      const shipSurface = sampleRenderablePlanetSurface(planet, seed, world.ship.position);
      if (canReturnToPilot(world.character.deckLocal!)) {
        world.prompt = 'Press F to pilot';
        if (actions.interactPressed) {
          beginReturnToPilotTransition(world);
        }
      } else if (canExitFromDeck(world.ship, world.character.deckLocal!, shipSurface)) {
        world.prompt = 'Press F to exit';
        if (actions.interactPressed) {
          beginExitTransition(world, planet, seed);
        }
      } else {
        world.prompt = '';
      }
    } else {
      updateTransition(world, dt, transitionContext);
    }

    const shipSurface = sampleRenderablePlanetSurface(planet, seed, world.ship.position);
    const focusPosition =
      world.mode === MODE_IN_SHIP ? world.ship.position : world.character.position;
    const focusVelocity =
      world.mode === MODE_IN_SHIP ? world.ship.velocity : world.character.velocity;
    const focusSurface = sampleRenderablePlanetSurface(planet, seed, focusPosition);

    const renderStats = renderer?.render({
      cameraOrbit: world.cameraOrbit,
      shipCameraZoom: world.shipCameraZoom,
      character:
        world.mode === MODE_IN_SHIP
          ? null
          : {
              animation: world.character.animation,
              forward: world.character.forward,
              position: world.character.position,
              up: world.character.up,
            },
      mode: world.mode,
      prompt: world.prompt,
      ship: world.ship,
      timeSeconds: nowMs / 1000,
    });
    window.__claudecitizenRenderStats = renderStats ?? null;

    onHudUpdate({
      world,
      focusSurface,
      focusVelocity,
      shipSurface,
      renderStats: renderStats ?? null,
      rendererError,
      rendererMode: renderer?.rendererMode,
      planet,
      isPointerLocked: controls.isPointerLocked(),
    });

    requestAnimationFrame(frame);
  }

  function start(): void {
    requestAnimationFrame((now) => {
      lastMs = now;
      requestAnimationFrame(frame);
    });
  }

  return {
    resetWorld,
    start,
  };
}
