import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import type { AppConfig } from '../server/config.ts';
import type { YtDlpService } from '../server/core/yt-dlp.service.ts';
import { initDatabase, type DbContext } from '../server/db/database.ts';
import { taskToRow } from '../server/db/task-serializer.ts';
import { CookieService } from '../server/services/cookie.service.ts';
import { ConnectivityService } from '../server/services/connectivity.service.ts';
import { BackupService } from '../server/services/backup.service.ts';
import type { DownloadService } from '../server/services/download.service.ts';
import { HistoryService } from '../server/services/history.service.ts';
import { NamingService } from '../server/services/naming.service.ts';
import { QueueService } from '../server/services/queue.service.ts';
import { SettingsService } from '../server/services/settings.service.ts';
import { SubtitleService } from '../server/services/subtitle.service.ts';
import { ToolUpdateService } from '../server/services/tool-update.service.ts';
import type { DownloadTask, ProgressInfo } from '../server/types/download.ts';
import type { ResolveResult } from '../server/types/video.ts';

const fakeResolveResult: ResolveResult = {
  kind: 'video',
  title: 'Integration test video',
  videos: [{
    id: 'YE7VzlLtp-4',
    title: 'Integration test video',
    duration: 10,
    thumbnails: [],
    formats: [],
    subtitles: [],
  }],
};

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  db: DbContext;
  queue: QueueService;
}

async function createHarness(tempDir: string, databasePath: string): Promise<Harness> {
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(databasePath);
  const settings = new SettingsService({
    downloadPath,
    maxConcurrent: 1,
    maxRetries: 2,
    namingTemplate: 'integration/{title}.{ext}',
    proxyUrl: '',
    gentleMode: false,
    gentleRateLimitMbps: 2,
    gentleCooldownSeconds: 10,
    gentleBatchLimit: 20,
  }, db);

  const fakeYtDlp = {
    resolve: async () => fakeResolveResult,
  } as unknown as YtDlpService;
  const fakeDownload = {
    download: async (
      task: DownloadTask,
      signal: AbortSignal,
      callbacks: { onProgress: (progress: ProgressInfo) => void },
    ) => {
      for (let step = 1; step <= 5; step += 1) {
        if (signal.aborted) throw new Error('download aborted');
        callbacks.onProgress({
          percent: step * 20,
          totalSize: 100,
          totalSizeUnit: '100B',
          speed: 1,
          speedUnit: 'MiB/s',
          eta: `00:0${5 - step}`,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await writeFile(task.outputPath, 'integration-download');
    },
  } as unknown as DownloadService;

  const queue = new QueueService(fakeDownload, new NamingService(), settings.getSettings(), db);
  const cookie = new CookieService(tempDir);
  const subtitle = new SubtitleService(fakeYtDlp, {
    binary: 'fake-yt-dlp',
    outputRoot: downloadPath,
  });
  const history = new HistoryService(db);
  const toolUpdate = new ToolUpdateService({
    binary: 'fake-yt-dlp',
    currentVersion: 'fake',
    appDataPath: tempDir,
    resourcePath: tempDir,
  });
  const connectivity = new ConnectivityService(fakeYtDlp, settings, cookie);
  const backup = new BackupService({
    db,
    getSettings: () => settings.getSettings(),
    getQueueStatus: () => queue.getQueueStatus(),
    appVersion: '0.22.0-test',
  });
  const config: AppConfig = {
    port: 0,
    ytDlpBinary: 'fake-yt-dlp',
    denoBinary: 'fake-deno',
    ffmpegBinary: 'fake-ffmpeg',
    resolveTimeoutMs: 1_000,
    downloadPath,
    maxConcurrent: 1,
    maxRetries: 2,
    namingTemplate: 'integration/{title}.{ext}',
    proxyUrl: '',
    dbPath: databasePath,
    isDev: true,
    webDistPath: path.join(tempDir, 'missing-client'),
    appDataPath: tempDir,
    resourcePath: tempDir,
  };
  const app = createApp(
    config,
    fakeYtDlp,
    queue,
    cookie,
    subtitle,
    history,
    settings,
    toolUpdate,
    connectivity,
    {
      ytDlp: { available: true, version: 'fake' },
      deno: { available: true, version: 'fake' },
      ffmpeg: { available: true, version: 'fake' },
    },
    backup,
    'test-desktop-token',
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
    candidate.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP port');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    db,
    queue,
    close: async () => {
      server.close();
      await once(server, 'close');
      db.close();
    },
  };
}

async function apiRequest<T>(baseUrl: string, route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  });
  const payload = await response.json() as {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
  };
  assert.equal(response.ok, true, payload.error?.message);
  assert.equal(payload.success, true, payload.error?.message);
  return payload.data as T;
}

async function waitForTask(
  baseUrl: string,
  taskId: string,
  expectedStatus: string,
): Promise<DownloadTask> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const queue = await apiRequest<{ tasks: DownloadTask[] }>(baseUrl, '/api/queue');
    const task = queue.tasks.find((candidate) => candidate.id === taskId);
    if (task?.status === expectedStatus) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Task ${taskId} did not reach ${expectedStatus}`);
}

test('managed YouTube login Cookie can only be saved by the desktop main process', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yld-app-auth-'));
  let harness: Harness | undefined;
  const body = JSON.stringify({
    content: '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\ttest-value',
  });
  try {
    harness = await createHarness(tempDir, path.join(tempDir, 'app.db'));
    const unauthorized = await fetch(`${harness.baseUrl}/api/auth/cookie/managed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(unauthorized.status, 403);

    const authorized = await fetch(`${harness.baseUrl}/api/auth/cookie/managed`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-desktop-token': 'test-desktop-token',
      },
      body,
    });
    assert.equal(authorized.status, 200);
    const payload = await authorized.json() as { success: boolean; data?: { source: string; fileName?: string } };
    assert.equal(payload.success, true);
    assert.equal(payload.data?.source, 'managed');
    assert.equal(payload.data?.fileName, 'youtube-auth.txt');
    assert.doesNotMatch(await (await fetch(`${harness.baseUrl}/api/auth/cookie`)).text(), /test-value/);
  } finally {
    await harness?.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HTTP download flow persists completed and cancelled tasks across restart', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yld-app-e2e-'));
  const databasePath = path.join(tempDir, 'app.db');
  let harness: Harness | undefined;

  try {
    harness = await createHarness(tempDir, databasePath);
    const resolved = await apiRequest<ResolveResult>(
      harness.baseUrl,
      '/api/resolve?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DYE7VzlLtp-4',
    );
    assert.equal(resolved.videos[0]?.id, 'YE7VzlLtp-4');

    const updateStatus = await apiRequest<{ updateSupported: boolean; channel: string }>(
      harness.baseUrl,
      '/api/runtime/yt-dlp',
    );
    assert.equal(updateStatus.updateSupported, false);
    assert.equal(updateStatus.channel, 'nightly');

    const connectivity = await apiRequest<{ ok: boolean; code: string; videoTitle?: string }>(
      harness.baseUrl,
      '/api/runtime/connectivity',
      { method: 'POST' },
    );
    assert.equal(connectivity.ok, true);
    assert.equal(connectivity.code, 'OK');
    assert.equal(connectivity.videoTitle, fakeResolveResult.title);

    const unauthorizedBackup = await fetch(`${harness.baseUrl}/api/backup`);
    assert.equal(unauthorizedBackup.status, 403);
    const authorizedBackup = await fetch(`${harness.baseUrl}/api/backup`, {
      headers: { 'x-desktop-token': 'test-desktop-token' },
    });
    assert.equal(authorizedBackup.status, 200);
    const authorizedBackupPayload = await authorizedBackup.json() as {
      success: boolean;
      data?: { format: string; cookieIncluded: boolean };
    };
    assert.equal(authorizedBackupPayload.success, true);
    assert.equal(authorizedBackupPayload.data?.format, 'youtube-learning-downloader-backup');
    assert.equal(authorizedBackupPayload.data?.cookieIncluded, false);

    const blocked = await fetch(`${harness.baseUrl}/api/runtime/yt-dlp/update`, {
      method: 'POST',
      headers: { origin: 'https://malicious.example' },
    });
    assert.equal(blocked.status, 403);
    const blockedPayload = await blocked.json() as { success: boolean; error?: { code: string } };
    assert.equal(blockedPayload.success, false);
    assert.equal(blockedPayload.error?.code, 'PATH_NOT_ALLOWED');

    const invalidContainer = await fetch(`${harness.baseUrl}/api/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tasks: [{ videoId: 'YE7VzlLtp-4', title: 'unsafe extension', container: 'exe' }],
      }),
    });
    assert.equal(invalidContainer.status, 400);
    const invalidContainerPayload = await invalidContainer.json() as {
      success: boolean;
      error?: { code: string };
    };
    assert.equal(invalidContainerPayload.success, false);
    assert.equal(invalidContainerPayload.error?.code, 'INVALID_PARAM');

    const invalidAudioSubtitle = await fetch(`${harness.baseUrl}/api/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tasks: [{
          videoId: 'YE7VzlLtp-4',
          title: 'invalid audio subtitle',
          container: 'mp3',
          subtitleMode: 'embed',
          subtitleLangs: ['en'],
        }],
      }),
    });
    assert.equal(invalidAudioSubtitle.status, 400);
    const invalidAudioSubtitlePayload = await invalidAudioSubtitle.json() as {
      success: boolean;
      error?: { code: string };
    };
    assert.equal(invalidAudioSubtitlePayload.success, false);
    assert.equal(invalidAudioSubtitlePayload.error?.code, 'INVALID_PARAM');

    const created = await apiRequest<{ taskIds: string[] }>(harness.baseUrl, '/api/download', {
      method: 'POST',
      body: JSON.stringify({
        tasks: [
          { videoId: 'YE7VzlLtp-4', title: 'completed', container: 'mp4' },
          { videoId: 'YE7VzlLtp-4', title: 'cancelled', container: 'mp4' },
        ],
      }),
    });
    const [completedId, cancelledId] = created.taskIds;
    assert.ok(completedId);
    assert.ok(cancelledId);

    await apiRequest(harness.baseUrl, `/api/queue/${cancelledId}/cancel`, { method: 'POST' });
    const completedTask = await waitForTask(harness.baseUrl, completedId, 'completed');
    const cancelledTask = await waitForTask(harness.baseUrl, cancelledId, 'cancelled');
    assert.equal(cancelledTask.status, 'cancelled');
    await access(completedTask.outputPath);
    assert.ok((await stat(completedTask.outputPath)).size > 0);

    const historyItem = await apiRequest<DownloadTask>(
      harness.baseUrl,
      `/api/history/${completedId}`,
    );
    assert.equal(historyItem.id, completedId);
    assert.equal(historyItem.status, 'completed');
    assert.equal(historyItem.outputPath, completedTask.outputPath);

    const failedId = 'persisted-failed-retry';
    const failedOutputPath = path.join(tempDir, 'downloads', 'integration', 'failed retry.mp4');
    harness.db.stmts.upsertTask.run(taskToRow({
      id: failedId,
      videoId: 'YE7VzlLtp-4',
      title: 'failed retry',
      formatId: 'best',
      container: 'mp4',
      outputPath: failedOutputPath,
      subtitleLangs: [],
      subtitleMode: 'none',
      autoSubtitle: false,
      status: 'failed',
      progress: 35,
      speed: '',
      eta: '',
      downloadedBytes: 35,
      totalBytes: 100,
      estimatedBytes: 100,
      retryCount: 2,
      maxRetries: 2,
      error: 'previous network failure',
      errorCode: 'NETWORK_ERROR',
      createdAt: '2026-08-01T00:00:00.000Z',
    }));

    const firstHistory = await apiRequest<{ tasks: DownloadTask[]; total: number }>(
      harness.baseUrl,
      '/api/history?page=1&pageSize=20',
    );
    assert.equal(firstHistory.total, 3);
    assert.deepEqual(
      new Set(firstHistory.tasks.map((task) => task.status)),
      new Set(['completed', 'cancelled', 'failed']),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await apiRequest(harness.baseUrl, `/api/history/${cancelledId}`, { method: 'DELETE' });
    const queueAfterHistoryDelete = await apiRequest<{ tasks: DownloadTask[] }>(
      harness.baseUrl,
      '/api/queue',
    );
    assert.equal(queueAfterHistoryDelete.tasks.some((task) => task.id === cancelledId), false);

    await harness.close();
    harness = undefined;
    harness = await createHarness(tempDir, databasePath);
    const restartedHistory = await apiRequest<{ tasks: DownloadTask[]; total: number }>(
      harness.baseUrl,
      '/api/history?page=1&pageSize=20',
    );
    assert.equal(restartedHistory.total, 2);
    assert.deepEqual(
      new Set(restartedHistory.tasks.map((task) => task.id)),
      new Set([completedId, failedId]),
    );

    const retriedQueue = await apiRequest<{ tasks: DownloadTask[] }>(
      harness.baseUrl,
      `/api/history/${failedId}/retry`,
      { method: 'POST' },
    );
    assert.equal(retriedQueue.tasks.some((task) => task.id === failedId), true);
    const retriedTask = await waitForTask(harness.baseUrl, failedId, 'completed');
    assert.equal(retriedTask.retryCount, 0);
    await access(failedOutputPath);

    const cleared = await apiRequest<{ deleted: number }>(
      harness.baseUrl,
      '/api/history',
      { method: 'DELETE' },
    );
    assert.equal(cleared.deleted, 2);
    const queueAfterClear = await apiRequest<{ tasks: DownloadTask[] }>(harness.baseUrl, '/api/queue');
    assert.equal(queueAfterClear.tasks.length, 0);
  } finally {
    await harness?.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HTTP history deletion cannot remove an active task or its persisted state', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yld-app-history-guard-'));
  const databasePath = path.join(tempDir, 'app.db');
  let harness: Harness | undefined;

  try {
    harness = await createHarness(tempDir, databasePath);
    const created = await apiRequest<{ taskIds: string[] }>(harness.baseUrl, '/api/download', {
      method: 'POST',
      body: JSON.stringify({
        tasks: Array.from({ length: 10 }, (_, index) => ({
          videoId: 'YE7VzlLtp-4',
          title: `active history guard ${index + 1}`,
          container: 'mp4',
        })),
      }),
    });
    const protectedId = created.taskIds.at(-1);
    assert.ok(protectedId);

    await apiRequest(harness.baseUrl, `/api/queue/${protectedId}/pause`, { method: 'POST' });
    const paused = await waitForTask(harness.baseUrl, protectedId, 'paused');
    assert.equal(paused.status, 'paused');

    const response = await fetch(`${harness.baseUrl}/api/history/${protectedId}`, {
      method: 'DELETE',
    });
    const payload = await response.json() as {
      success: boolean;
      error?: { code: string; message: string };
    };
    assert.equal(response.status, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.error?.code, 'INVALID_STATE');

    const queue = await apiRequest<{ tasks: DownloadTask[] }>(harness.baseUrl, '/api/queue');
    assert.equal(queue.tasks.find((task) => task.id === protectedId)?.status, 'paused');
    assert.ok(harness.db.stmts.getTaskById.get(protectedId));
  } finally {
    if (harness) {
      for (const task of harness.queue.getAllTasks()) {
        if (['downloading', 'queued', 'retrying', 'paused'].includes(task.status)) {
          harness.queue.cancel(task.id);
        }
      }
      // 等待 AbortSignal 传到测试下载器并完成 QueueService 的 finally 清理。
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await harness?.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HTTP download creation rejects conflicts atomically and safely renames on confirmation', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yld-app-conflict-'));
  const databasePath = path.join(tempDir, 'app.db');
  let harness: Harness | undefined;

  try {
    harness = await createHarness(tempDir, databasePath);
    const first = await apiRequest<{
      taskIds: string[];
      conflicts: unknown[];
      renamed: unknown[];
    }>(harness.baseUrl, '/api/download', {
      method: 'POST',
      body: JSON.stringify({
        tasks: [{ videoId: 'YE7VzlLtp-4', title: 'duplicate lesson', container: 'mp4' }],
      }),
    });
    const firstId = first.taskIds[0];
    assert.ok(firstId);
    const firstTask = await waitForTask(harness.baseUrl, firstId, 'completed');
    await access(firstTask.outputPath);

    const rejected = await apiRequest<{
      taskIds: string[];
      conflicts: { reason: string; outputPath: string }[];
      renamed: unknown[];
    }>(harness.baseUrl, '/api/download', {
      method: 'POST',
      body: JSON.stringify({
        tasks: [{ videoId: 'YE7VzlLtp-4', title: 'duplicate lesson', container: 'mp4' }],
      }),
    });
    assert.equal(rejected.taskIds.length, 0);
    assert.equal(rejected.conflicts[0]?.reason, 'file_exists');
    assert.equal(rejected.conflicts[0]?.outputPath, firstTask.outputPath);

    const renamed = await apiRequest<{
      taskIds: string[];
      conflicts: unknown[];
      renamed: { outputPath: string }[];
    }>(harness.baseUrl, '/api/download', {
      method: 'POST',
      body: JSON.stringify({
        conflictPolicy: 'rename',
        tasks: [{ videoId: 'YE7VzlLtp-4', title: 'duplicate lesson', container: 'mp4' }],
      }),
    });
    assert.equal(renamed.conflicts.length, 0);
    assert.match(renamed.renamed[0]?.outputPath ?? '', /duplicate lesson \(2\)\.mp4$/);
    const renamedId = renamed.taskIds[0];
    assert.ok(renamedId);
    const renamedTask = await waitForTask(harness.baseUrl, renamedId, 'completed');
    await access(renamedTask.outputPath);
    assert.notEqual(renamedTask.outputPath, firstTask.outputPath);
  } finally {
    await harness?.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
