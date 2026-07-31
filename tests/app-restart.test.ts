import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RESTART_DELAY_MS, createAppRestarter } = require('../desktop/app-restart.cjs') as {
  RESTART_DELAY_MS: number;
  createAppRestarter: (options: Record<string, unknown>) => () => void;
};

test('uses Electron relaunch for an installed build', () => {
  const calls: string[] = [];
  let scheduledDelay = 0;
  const restart = createAppRestarter({
    app: {
      relaunch: () => { calls.push('relaunch'); },
      quit: () => { calls.push('quit'); },
    },
    markShuttingDown: () => { calls.push('mark'); },
    env: {},
    platform: 'win32',
    execPath: 'C:\\Program Files\\Learning Downloader\\app.exe',
    tempDir: 'C:\\Users\\person\\AppData\\Local\\Temp',
    schedule: (callback: () => void, delay: number) => {
      scheduledDelay = delay;
      callback();
    },
  });

  restart();

  assert.equal(scheduledDelay, RESTART_DELAY_MS);
  assert.deepEqual(calls, ['mark', 'relaunch', 'quit']);
});

test('relaunches the original portable executable with the existing arguments', () => {
  const calls: string[] = [];
  let relaunchOptions: { execPath?: string; args?: string[] } | undefined;
  const restart = createAppRestarter({
    app: {
      relaunch: (options: { execPath?: string; args?: string[] }) => {
        calls.push('relaunch');
        relaunchOptions = options;
      },
      quit: () => { calls.push('quit'); },
    },
    markShuttingDown: () => { calls.push('mark'); },
    env: {
      PORTABLE_EXECUTABLE_FILE: 'C:\\release\\learning-downloader.exe',
      KEEP_ME: 'yes',
    },
    platform: 'win32',
    argv: ['C:\\temp\\app.exe', '--user-data-dir=C:\\qa data'],
    execPath: 'C:\\temp\\app.exe',
    parentPid: 456,
    tempDir: 'C:\\temp',
    schedule: (callback: () => void) => callback(),
  });

  restart();

  assert.deepEqual(calls, ['mark', 'relaunch', 'quit']);
  assert.deepEqual(relaunchOptions, {
    execPath: 'C:\\release\\learning-downloader.exe',
    args: ['--user-data-dir=C:\\qa data'],
  });
});

test('detects a portable extraction by its temp path when the builder variable is absent', () => {
  let relaunchOptions: { execPath?: string; args?: string[] } | undefined;
  const restart = createAppRestarter({
    app: {
      relaunch: (options: { execPath?: string; args?: string[] }) => { relaunchOptions = options; },
      quit: () => {},
    },
    markShuttingDown: () => {},
    env: {},
    platform: 'win32',
    argv: ['C:\\Users\\person\\AppData\\Local\\Temp\\portable-id\\app.exe'],
    execPath: 'C:\\Users\\person\\AppData\\Local\\Temp\\portable-id\\app.exe',
    parentPid: 789,
    tempDir: 'C:\\Users\\person\\AppData\\Local\\Temp',
    resolveParentExecutable: (parentPid: number) => {
      assert.equal(parentPid, 789);
      return 'C:\\release\\learning-downloader.exe';
    },
    schedule: (callback: () => void) => callback(),
  });

  restart();

  assert.deepEqual(relaunchOptions, {
    execPath: 'C:\\release\\learning-downloader.exe',
    args: [],
  });
});
