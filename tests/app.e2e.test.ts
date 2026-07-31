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
import { CookieService } from '../server/services/cookie.service.ts';
import type { DownloadService } from '../server/services/download.service.ts';
import { HistoryService } from '../server/services/history.service.ts';
import { NamingService } from '../server/services/naming.service.ts';
import { QueueService } from '../server/services/queue.service.ts';
import { SettingsService } from '../server/services/settings.service.ts';
import { SubtitleService } from '../server/services/subtitle.service.ts';
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
}

async function createHarness(tempDir: string, databasePath: string): Promise<Harness> {
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(databasePath);
  const settings = new SettingsService({
    downloadPath,
    maxConcurrent: 1,
    maxRetries: 2,
    namingTemplate: 'integration/{title}.{ext}',
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
  const config: AppConfig = {
    port: 0,
    ytDlpBinary: 'fake-yt-dlp',
    ffmpegBinary: 'fake-ffmpeg',
    resolveTimeoutMs: 1_000,
    downloadPath,
    maxConcurrent: 1,
    maxRetries: 2,
    namingTemplate: 'integration/{title}.{ext}',
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
    {
      ytDlp: { available: true, version: 'fake' },
      ffmpeg: { available: true, version: 'fake' },
    },
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

    const firstHistory = await apiRequest<{ tasks: DownloadTask[]; total: number }>(
      harness.baseUrl,
      '/api/history?page=1&pageSize=20',
    );
    assert.equal(firstHistory.total, 2);
    assert.deepEqual(
      new Set(firstHistory.tasks.map((task) => task.status)),
      new Set(['completed', 'cancelled']),
    );

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
      new Set([completedId, cancelledId]),
    );
  } finally {
    await harness?.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
