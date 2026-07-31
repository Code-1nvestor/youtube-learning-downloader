import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveResultIdentity } from '../client/src/utils/resolve-result.ts';

const base = {
  kind: 'playlist',
  title: '课程列表',
  videos: [{ id: 'video-a' }, { id: 'video-b' }],
};

test('keeps equivalent resolve results on the same stable identity', () => {
  assert.equal(
    resolveResultIdentity(base),
    resolveResultIdentity({
      kind: 'playlist',
      title: '课程列表',
      videos: [{ id: 'video-a' }, { id: 'video-b' }],
    }),
  );
});

test('changes identity when result content or ordering changes', () => {
  const identity = resolveResultIdentity(base);

  assert.notEqual(identity, resolveResultIdentity({ ...base, title: '另一个列表' }));
  assert.notEqual(identity, resolveResultIdentity({ ...base, kind: 'channel' }));
  assert.notEqual(identity, resolveResultIdentity({
    ...base,
    videos: [{ id: 'video-b' }, { id: 'video-a' }],
  }));
  assert.notEqual(identity, resolveResultIdentity({
    ...base,
    videos: [{ id: 'video-a' }],
  }));
});
