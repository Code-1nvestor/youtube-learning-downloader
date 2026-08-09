import assert from 'node:assert/strict';
import test from 'node:test';
import { getGentleBatchLimit, isGentleBatchAllowed } from '../client/src/utils/gentle-mode.ts';

test('uses a safe batch limit when settings cannot be loaded', () => {
  assert.equal(getGentleBatchLimit(), 20);
  assert.equal(isGentleBatchAllowed(20), true);
  assert.equal(isGentleBatchAllowed(21), false);
});

test('respects enabled setting and does not limit batches when disabled', () => {
  assert.equal(getGentleBatchLimit({ gentleMode: true, gentleBatchLimit: 5 }), 5);
  assert.equal(isGentleBatchAllowed(5, { gentleMode: true, gentleBatchLimit: 5 }), true);
  assert.equal(isGentleBatchAllowed(6, { gentleMode: true, gentleBatchLimit: 5 }), false);
  assert.equal(getGentleBatchLimit({ gentleMode: false, gentleBatchLimit: 1 }), Number.POSITIVE_INFINITY);
  assert.equal(isGentleBatchAllowed(100, { gentleMode: false, gentleBatchLimit: 1 }), true);
});
