import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compactEntity } from './world.service';
import type { NetworkEntityState } from './world.types';

const entity: NetworkEntityState = {
  id: 'player-1',
  playerId: 'player-1',
  displayName: 'Citizen',
  characterAppearance: {
    schemaVersion: 1,
    type: 1,
    headVariant: 1,
    hairVariant: 2,
    eyebrowVariant: 3,
    earVariant: 4,
    noseVariant: 5,
    facialHairVariant: null,
    hairColor: '26272D',
    eyebrowColor: '26272D',
    facialHairColor: '26272D',
    eyeColor: '503E2B',
    bodySizeValue: 0,
    muscleValue: -100,
  },
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
};

describe('world character appearance snapshots', () => {
  it('includes the authoritative saved appearance for visible entities', () => {
    assert.deepEqual(compactEntity(entity, 'full').characterAppearance, entity.characterAppearance);
    assert.deepEqual(compactEntity(entity, 'medium').characterAppearance, entity.characterAppearance);
  });

  it('omits appearance and character details at marker LOD', () => {
    const marker = compactEntity(entity, 'marker');
    assert.equal(marker.characterAppearance, undefined);
    assert.equal(marker.character, undefined);
  });
});
