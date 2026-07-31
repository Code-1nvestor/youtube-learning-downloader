import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDownloadActions } = require('../desktop/download-actions.cjs') as {
  createDownloadActions: (options: {
    loadTask: (taskId: string) => Promise<{ status: string; outputPath: string } | undefined>;
    shell: {
      openPath: (filePath: string) => Promise<string>;
      showItemInFolder: (filePath: string) => void;
    };
  }) => {
    openDownload: (taskId: string) => Promise<{ path?: string; error?: string }>;
    revealDownload: (taskId: string) => Promise<{ path?: string; error?: string }>;
  };
};

const VALID_TASK_ID = '11111111-1111-4111-8111-111111111111';

test('desktop file actions resolve a completed task by ID before opening it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-desktop-actions-'));
  const outputPath = path.join(tempDir, 'lesson.mp4');
  fs.writeFileSync(outputPath, 'downloaded');
  const opened: string[] = [];
  const revealed: string[] = [];
  const actions = createDownloadActions({
    loadTask: async () => ({ status: 'completed', outputPath }),
    shell: {
      openPath: async (filePath) => {
        opened.push(filePath);
        return '';
      },
      showItemInFolder: (filePath) => revealed.push(filePath),
    },
  });

  try {
    assert.deepEqual(await actions.openDownload(VALID_TASK_ID), { path: outputPath });
    assert.deepEqual(await actions.revealDownload(VALID_TASK_ID), { path: outputPath });
    assert.deepEqual(opened, [outputPath]);
    assert.deepEqual(revealed, [outputPath]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('desktop file actions reject untrusted IDs before querying the backend', async () => {
  let loadCalls = 0;
  const actions = createDownloadActions({
    loadTask: async () => {
      loadCalls += 1;
      return undefined;
    },
    shell: { openPath: async () => '', showItemInFolder: () => {} },
  });

  const result = await actions.openDownload('../../Windows/System32/calc.exe');
  assert.match(result.error ?? '', /ID 格式无效/);
  assert.equal(loadCalls, 0);
});

test('desktop file actions report missing or unfinished results without opening anything', async () => {
  let openCalls = 0;
  const missingActions = createDownloadActions({
    loadTask: async () => ({ status: 'completed', outputPath: path.join(os.tmpdir(), 'missing-yld-file.mp4') }),
    shell: {
      openPath: async () => {
        openCalls += 1;
        return '';
      },
      showItemInFolder: () => {},
    },
  });
  const unfinishedActions = createDownloadActions({
    loadTask: async () => ({ status: 'downloading', outputPath: 'C:\\Downloads\\lesson.mp4' }),
    shell: { openPath: async () => '', showItemInFolder: () => {} },
  });

  assert.match((await missingActions.openDownload(VALID_TASK_ID)).error ?? '', /移动或删除/);
  assert.match((await unfinishedActions.openDownload(VALID_TASK_ID)).error ?? '', /尚未完成/);
  assert.equal(openCalls, 0);
});

test('desktop file actions never open a non-media extension', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-desktop-extension-'));
  const outputPath = path.join(tempDir, 'unexpected.exe');
  fs.writeFileSync(outputPath, 'not executable');
  let openCalls = 0;
  const actions = createDownloadActions({
    loadTask: async () => ({ status: 'completed', outputPath }),
    shell: {
      openPath: async () => {
        openCalls += 1;
        return '';
      },
      showItemInFolder: () => {},
    },
  });

  try {
    assert.match((await actions.openDownload(VALID_TASK_ID)).error ?? '', /不是受支持的媒体文件/);
    assert.equal(openCalls, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
