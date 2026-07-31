import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  APP_WEB_CACHE_STORAGES,
  clearDesktopWebCaches,
  hasVersionConflict,
  normalizeAppVersion,
  normalizeLoopbackOrigin,
} = require('../desktop/release-policy.cjs');

test('normalizes trusted app versions and detects a different running release', () => {
  assert.equal(normalizeAppVersion(' 0.9.0 '), '0.9.0');
  assert.equal(normalizeAppVersion('1.0.0-beta.1'), '1.0.0-beta.1');
  assert.equal(normalizeAppVersion('<script>'), null);
  assert.equal(hasVersionConflict('0.9.0', '1.0.0'), true);
  assert.equal(hasVersionConflict('0.9.0', '0.9.0'), false);
  assert.equal(hasVersionConflict('0.9.0', '<script>'), false);
});

test('clears only service worker and Cache Storage for the local desktop origin', async () => {
  const calls: unknown[] = [];
  const electronSession = {
    clearStorageData: async (options: unknown) => {
      calls.push(options);
    },
  };

  await clearDesktopWebCaches(electronSession, 'http://127.0.0.1:47831/path');

  assert.deepEqual(calls, [{
    origin: 'http://127.0.0.1:47831',
    storages: [...APP_WEB_CACHE_STORAGES],
  }]);
});

test('refuses to clear storage for a non-local or non-HTTP origin', async () => {
  assert.throws(() => normalizeLoopbackOrigin('https://127.0.0.1:47831'), /本机 HTTP/);
  assert.throws(() => normalizeLoopbackOrigin('http://example.com'), /本机 HTTP/);
  await assert.rejects(
    clearDesktopWebCaches({ clearStorageData: async () => {} }, 'not a url'),
    /地址无效/,
  );
});
