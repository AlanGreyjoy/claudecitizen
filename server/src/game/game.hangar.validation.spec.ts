import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HAB_FLOOR_UP,
  validatePlacementTransform,
  type PlacementTransform,
} from './game.hangar.validation';

const definition = {
  allowRotateY: true,
  snapGridM: 0.5,
};

function validateApartment(transform: PlacementTransform) {
  return validatePlacementTransform({
    area: 'apartment',
    definition,
    existingPlacements: [],
    hangarIndex: 2,
    transform,
  });
}

describe('build placement validation', () => {
  it('snaps apartment placements to the hab room floor', () => {
    const result = validateApartment({
      right: -4.36,
      up: 0,
      forward: 5.24,
      rotationY: 0.2,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.transform.up, HAB_FLOOR_UP);
    assert.equal(result.transform.right, -4.5);
    assert.equal(result.transform.forward, 5);
  });

  it('rejects apartment placements outside the private room', () => {
    const result = validateApartment({
      right: 0,
      up: HAB_FLOOR_UP,
      forward: 0,
      rotationY: 0,
    });

    assert.equal(result.ok, false);
  });

  it('uses area-specific rejection messages', () => {
    const apartmentResult = validateApartment({
      right: 0,
      up: HAB_FLOOR_UP,
      forward: 1,
      rotationY: 0,
    });
    const hangarResult = validatePlacementTransform({
      area: 'hangar',
      definition,
      existingPlacements: [],
      hangarIndex: 2,
      transform: {
        right: 0,
        up: 0,
        forward: 1,
        rotationY: 0,
      },
    });

    assert.equal(apartmentResult.ok, false);
    if (!apartmentResult.ok) {
      assert.match(apartmentResult.message, /apartment/i);
    }
    assert.equal(hangarResult.ok, false);
    if (!hangarResult.ok) {
      assert.match(hangarResult.message, /ship pad/i);
    }
  });
});
