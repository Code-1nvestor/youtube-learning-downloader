import assert from 'node:assert/strict';
import test from 'node:test';
import { connectivitySettingsTarget } from '../client/src/utils/readiness.ts';

test('routes connection failures to the setting that can resolve them', () => {
  assert.equal(connectivitySettingsTarget('RATE_LIMITED'), 'cookie');
  assert.equal(connectivitySettingsTarget('NETWORK_ERROR'), 'network');
  assert.equal(connectivitySettingsTarget('TIMEOUT'), 'network');
  assert.equal(connectivitySettingsTarget('YT_DLP_OUTDATED'), 'update');
  assert.equal(connectivitySettingsTarget('YT_DLP_MISSING'), 'runtime');
  assert.equal(connectivitySettingsTarget('UNKNOWN'), 'diagnostics');
});
