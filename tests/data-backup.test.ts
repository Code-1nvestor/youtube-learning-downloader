import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { MAX_BACKUP_BYTES, createDataBackupActions } = require('../desktop/data-backup.cjs') as {
  MAX_BACKUP_BYTES: number;
  createDataBackupActions: (options: Record<string, unknown>) => {
    saveBackup: () => Promise<{ saved: boolean; path?: string; taskCount?: number }>;
    restoreBackup: () => Promise<{ restored: boolean; restarting?: boolean }>;
  };
};

const backup = {
  format: 'youtube-learning-downloader-backup',
  version: 1,
  appVersion: '0.22.0-test',
  exportedAt: '2026-08-01T00:00:00.000Z',
  cookieIncluded: false,
  data: { settings: {}, tasks: [{ id: 'one' }] },
};

test('saves a backup through a temporary file before atomically renaming it', async () => {
  const calls: string[] = [];
  let written = '';
  const actions = createDataBackupActions({
    loadApi: async () => backup,
    showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\backup\\data.json' }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    confirmRestore: async () => false,
    restartApp: () => {},
    documentsPath: 'C:\\Documents',
    createTempPath: () => 'C:\\backup\\data.tmp',
    fileSystem: {
      writeFile: async (filePath: string, content: string) => {
        calls.push(`write:${filePath}`);
        written = content;
      },
      rename: async (from: string, to: string) => { calls.push(`rename:${from}->${to}`); },
      unlink: async () => {},
    },
  });

  const result = await actions.saveBackup();
  assert.deepEqual(result, { saved: true, path: 'C:\\backup\\data.json', taskCount: 1 });
  assert.deepEqual(calls, [
    'write:C:\\backup\\data.tmp',
    'rename:C:\\backup\\data.tmp->C:\\backup\\data.json',
  ]);
  assert.equal(JSON.parse(written).cookieIncluded, false);
});

test('does not write anything when backup save is cancelled', async () => {
  let writes = 0;
  const actions = createDataBackupActions({
    loadApi: async () => backup,
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    confirmRestore: async () => false,
    restartApp: () => {},
    documentsPath: 'C:\\Documents',
    fileSystem: { writeFile: async () => { writes += 1; } },
  });

  assert.deepEqual(await actions.saveBackup(), { saved: false });
  assert.equal(writes, 0);
});

test('validates and confirms a restore before replacing data and restarting', async () => {
  const routes: string[] = [];
  let restarts = 0;
  const actions = createDataBackupActions({
    loadApi: async (route: string, init?: { body?: string }) => {
      routes.push(route);
      assert.deepEqual(JSON.parse(init?.body ?? '{}'), backup);
      if (route.endsWith('/inspect')) return { taskCount: 1, willPauseCount: 0 };
      return { restored: true, taskCount: 1 };
    },
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\backup\\data.json'] }),
    confirmRestore: async ({ filePath, summary }: { filePath: string; summary: { taskCount: number } }) => {
      assert.equal(filePath, 'C:\\backup\\data.json');
      assert.equal(summary.taskCount, 1);
      return true;
    },
    restartApp: () => { restarts += 1; },
    documentsPath: 'C:\\Documents',
    fileSystem: {
      stat: async () => ({ isFile: () => true, size: 1_000 }),
      readFile: async () => JSON.stringify(backup),
    },
  });

  assert.deepEqual(await actions.restoreBackup(), { restored: true, restarting: true, summary: { restored: true, taskCount: 1 } });
  assert.deepEqual(routes, ['/api/backup/inspect', '/api/backup/restore']);
  assert.equal(restarts, 1);
});

test('a cancelled confirmation and oversized file cannot restore data', async () => {
  let restoreCalls = 0;
  const makeActions = (size: number, confirm: boolean) => createDataBackupActions({
    loadApi: async (route: string) => {
      if (route.endsWith('/restore')) restoreCalls += 1;
      return { taskCount: 1 };
    },
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\backup\\data.json'] }),
    confirmRestore: async () => confirm,
    restartApp: () => {},
    documentsPath: 'C:\\Documents',
    fileSystem: {
      stat: async () => ({ isFile: () => true, size }),
      readFile: async () => JSON.stringify(backup),
    },
  });

  assert.deepEqual(await makeActions(1_000, false).restoreBackup(), { restored: false });
  await assert.rejects(makeActions(MAX_BACKUP_BYTES + 1, true).restoreBackup(), /20 MB/);
  assert.equal(restoreCalls, 0);
});
