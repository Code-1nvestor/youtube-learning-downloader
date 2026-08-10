import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrowserCookieSnapshotArgs,
  exportBrowserCookieSnapshot,
  OFFICIAL_COOKIE_TEST_VIDEO,
} from '../server/services/browser-cookie-snapshot.ts';

test('snapshot export targets only the official video and writes a Cookie file', () => {
  const args = buildBrowserCookieSnapshotArgs('chrome', 'C:\\Temp\\snapshot.txt', 'deno.exe', 'http://127.0.0.1:7890');
  assert.deepEqual(args.slice(0, 4), ['--cookies-from-browser', 'chrome', '--cookies', 'C:\\Temp\\snapshot.txt']);
  assert.ok(args.includes('deno:deno.exe'));
  assert.ok(args.includes('--proxy'));
  assert.equal(args.at(-1), OFFICIAL_COOKIE_TEST_VIDEO);
});

test('snapshot export never exposes yt-dlp stderr in its public error', async () => {
  await assert.rejects(
    exportBrowserCookieSnapshot({
      binary: 'yt-dlp',
      browser: 'chrome',
      outputPath: 'snapshot.txt',
      run: async () => ({
        stdout: '',
        stderr: 'unclassified secret-cookie-value',
        exitCode: 1,
        durationMs: 1,
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-cookie-value/);
      return true;
    },
  );
});
