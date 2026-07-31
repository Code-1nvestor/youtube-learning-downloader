import assert from 'node:assert/strict';
import test from 'node:test';
import { connectivitySettingsTarget } from '../client/src/utils/readiness.ts';
import { getErrorGuidance } from '../client/src/utils/error-actions.ts';

test('routes connection failures to the setting that can resolve them', () => {
  assert.equal(connectivitySettingsTarget('RATE_LIMITED'), 'cookie');
  assert.equal(connectivitySettingsTarget('COOKIE_ERROR'), 'cookie');
  assert.equal(connectivitySettingsTarget('NETWORK_ERROR'), 'network');
  assert.equal(connectivitySettingsTarget('TIMEOUT'), 'network');
  assert.equal(connectivitySettingsTarget('YT_DLP_OUTDATED'), 'update');
  assert.equal(connectivitySettingsTarget('YT_DLP_MISSING'), 'runtime');
  assert.equal(connectivitySettingsTarget('UNKNOWN'), 'diagnostics');
});

test('routes Cookie extraction failures to an actionable Cookie repair step', () => {
  const guidance = getErrorGuidance('COOKIE_ERROR');
  assert.equal(guidance.settingsTarget, 'cookie');
  assert.match(guidance.guidance, /关闭浏览器|重新导入/);
});

test('explains task state conflicts without sending users to unrelated settings', () => {
  const guidance = getErrorGuidance('INVALID_STATE');
  assert.match(guidance.guidance, /刷新队列/);
  assert.equal(guidance.settingsTarget, undefined);
});
