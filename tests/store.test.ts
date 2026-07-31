import assert from 'node:assert/strict';
import test from 'node:test';
import { useStore } from '../client/src/store.ts';

test('a newer notice is not cleared by an older notice timer', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  useStore.getState().clearNotice();

  useStore.getState().notify('第一条');
  context.mock.timers.tick(2_000);
  useStore.getState().notify('第二条');
  context.mock.timers.tick(1_000);
  assert.equal(useStore.getState().notice, '第二条');

  context.mock.timers.tick(2_000);
  assert.equal(useStore.getState().notice, null);
});
