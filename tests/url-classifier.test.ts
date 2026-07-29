import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyQuery } from '../server/core/url-classifier.ts';

test('classifies a video URL before treating it as search text', () => {
  assert.deepEqual(
    classifyQuery('https://www.youtube.com/watch?v=abcdefghijk'),
    { kind: 'video', normalized: 'https://www.youtube.com/watch?v=abcdefghijk' },
  );
});

test('classifies playlist URLs before video URLs', () => {
  assert.equal(
    classifyQuery('https://www.youtube.com/watch?v=abcdefghijk&list=PL123').kind,
    'playlist',
  );
});

test('supports explicit search syntax', () => {
  assert.deepEqual(classifyQuery('? python basics'), {
    kind: 'search',
    normalized: 'python basics',
  });
});
