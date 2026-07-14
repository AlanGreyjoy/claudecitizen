import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canEnterInstance,
  lodForDistance,
  shouldSeeEntity,
  shouldSendLod,
} from './world.visibility';
import type { NetworkEntityState } from './world.types';

function entity(overrides: Partial<NetworkEntityState>): NetworkEntityState {
  return {
    id: 'p2',
    playerId: 'p2',
    displayName: 'Pilot Two',
    characterAppearance: null,
    instanceId: 'station:public',
    mode: 'in-station',
    character: {
      animation: 'Idle_Loop',
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    },
    ship: null,
    shipRig: null,
    stationRoomId: 'lobby',
    shipZoneId: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('world visibility', () => {
  it('allows only owners into private apartment and hangar instances', () => {
    assert.equal(canEnterInstance('p1', 'apartment:p1'), true);
    assert.equal(canEnterInstance('p1', 'hangar:p1'), true);
    assert.equal(canEnterInstance('p1', 'apartment:p2'), false);
    assert.equal(canEnterInstance('p1', 'station:public'), true);
  });

  it('hides entities in different rooms of public station space', () => {
    assert.equal(
      shouldSeeEntity(
        {
          playerId: 'p1',
          instanceId: 'station:public',
          stationRoomId: 'lobby',
          focusPosition: { x: 0, y: 0, z: 0 },
        },
        entity({ stationRoomId: 'hab-room' }),
      ),
      false,
    );
  });

  it('selects and throttles LOD tiers', () => {
    assert.equal(lodForDistance(249), 'full');
    assert.equal(lodForDistance(1_000), 'medium');
    assert.equal(lodForDistance(20_000), 'marker');
    assert.equal(shouldSendLod('full', 1), true);
    assert.equal(shouldSendLod('medium', 1), false);
    assert.equal(shouldSendLod('medium', 2), true);
    assert.equal(shouldSendLod('marker', 9), false);
    assert.equal(shouldSendLod('marker', 10), true);
  });
});
