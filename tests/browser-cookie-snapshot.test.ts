import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrowserProcessSnapshotArgs,
  buildBrowserCookieSnapshotArgs,
  detectBrowserRunning,
  exportBrowserCookieSnapshot,
  OFFICIAL_COOKIE_TEST_VIDEO,
  parseBrowserProcessSnapshot,
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

test('browser process snapshot ignores exited records and Chrome crashpad only', () => {
  assert.equal(parseBrowserProcessSnapshot(JSON.stringify([
    {
      processId: 100,
      hasExited: false,
      commandLine: 'chrome.exe --type=crashpad-handler --database=C:\\Crashpad',
    },
    {
      processId: 101,
      hasExited: true,
      commandLine: 'chrome.exe --restore-last-session',
    },
  ])), false);
});

test('browser process snapshot blocks every other live or uncertain Chrome process', () => {
  assert.equal(parseBrowserProcessSnapshot(JSON.stringify([
    { processId: 100, hasExited: false, commandLine: 'chrome.exe --type=renderer' },
  ])), true);
  assert.equal(parseBrowserProcessSnapshot(JSON.stringify([
    { processId: 101, hasExited: false, commandLine: null },
  ])), true);
  assert.equal(parseBrowserProcessSnapshot(JSON.stringify([
    { processId: 102, commandLine: 'chrome.exe' },
  ])), true);
});

test('browser process snapshot handles empty and malformed PowerShell output safely', () => {
  assert.equal(parseBrowserProcessSnapshot('[]'), false);
  assert.equal(parseBrowserProcessSnapshot(''), false);
  assert.equal(parseBrowserProcessSnapshot('{broken json'), undefined);
  assert.equal(parseBrowserProcessSnapshot('{}'), undefined);
});

test('Windows browser detection requests structured process state without a shell', {
  skip: process.platform !== 'win32',
}, async () => {
  let observedCommand = '';
  let observedArgs: string[] = [];
  const detected = await detectBrowserRunning('chrome', async (command, args) => {
    observedCommand = command;
    observedArgs = args;
    return {
      stdout: JSON.stringify([
        { processId: 100, hasExited: false, commandLine: 'chrome.exe --type=crashpad-handler' },
      ]),
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    };
  });

  assert.equal(detected, false);
  assert.equal(observedCommand, 'powershell.exe');
  assert.deepEqual(observedArgs.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  assert.match(observedArgs.at(-1) ?? '', /Get-Process -Name 'chrome'/);
  assert.match(observedArgs.at(-1) ?? '', /Get-CimInstance Win32_Process/);
});

test('browser process snapshot command uses only the mapped process name', () => {
  const args = buildBrowserProcessSnapshotArgs('chrome');
  assert.equal(args.at(0), '-NoLogo');
  assert.match(args.at(-1) ?? '', /ConvertTo-Json -Compress/);
});
