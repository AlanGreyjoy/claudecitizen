import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parsePlayerCharacterAppearance,
  parseStoredPlayerCharacterAppearance,
  type PlayerCharacterAppearanceV1,
} from './game.character';

const valid: PlayerCharacterAppearanceV1 = {
  schemaVersion: 1,
  type: 2,
  headVariant: 2,
  hairVariant: 10,
  eyebrowVariant: 4,
  earVariant: 6,
  noseVariant: 11,
  facialHairVariant: null,
  bodySizeValue: -100,
  muscleValue: 100,
};

describe('player character appearance', () => {
  it('accepts and normalizes the complete versioned contract', () => {
    assert.deepEqual(parsePlayerCharacterAppearance(valid), valid);
  });

  it('rejects missing, fractional, out-of-range, and unknown values', () => {
    assert.throws(() => parsePlayerCharacterAppearance({ ...valid, hairVariant: undefined }));
    assert.throws(() => parsePlayerCharacterAppearance({ ...valid, bodySizeValue: 0.5 }));
    assert.throws(() => parsePlayerCharacterAppearance({ ...valid, noseVariant: 12 }));
    assert.throws(() => parsePlayerCharacterAppearance({ ...valid, outfit: 1 }));
  });

  it('treats null or corrupt stored JSON as incomplete creation', () => {
    assert.equal(parseStoredPlayerCharacterAppearance(null), null);
    assert.equal(parseStoredPlayerCharacterAppearance({ ...valid, type: 3 }), null);
    assert.deepEqual(parseStoredPlayerCharacterAppearance(valid), valid);
  });
});
