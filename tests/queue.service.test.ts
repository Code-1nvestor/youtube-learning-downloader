import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initDatabase } from '../server/db/database.ts';
import { taskToRow } from '../server/db/task-serializer.ts';
import type { DownloadService } from '../server/services/download.service.ts';
import { NamingService } from '../server/services/naming.service.ts';
import { QueueService } from '../server/services/queue.service.ts';
import { AppError } from '../server/types/errors.ts';
import type { DownloadTask } from '../server/types/download.ts';

class ControlledDownloadService {
  active = 0;
  maxActive = 0;
  readonly started: string[] = [];

  async download(task: DownloadTask, signal: AbortSignal): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.started.push(task.id);

    await new Promise<void>((_resolve, reject) => {
      const abort = () => {
        this.active--;
        reject(new AppError('DOWNLOAD_FAILED', 'test abort'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('test timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('pause and cancel never exceed the configured concurrency', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-'));
  const controlled = new ControlledDownloadService();
  const queue = new QueueService(
    controlled as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
    },
  );

  try {
    const taskIds = queue.enqueue([
      { videoId: 'video-1', title: 'one' },
      { videoId: 'video-2', title: 'two' },
      { videoId: 'video-3', title: 'three' },
    ]);
    const first = taskIds[0]!;
    const second = taskIds[1]!;
    const third = taskIds[2]!;

    await waitUntil(() => controlled.started.includes(first));
    queue.pause(first);
    await waitUntil(() => controlled.started.includes(second));
    queue.cancel(second);
    await waitUntil(() => controlled.started.includes(third));

    assert.equal(controlled.maxActive, 1);
    assert.equal(queue.getTask(first)?.status, 'paused');
    assert.equal(queue.getTask(second)?.status, 'cancelled');

    queue.cancel(third);
    await waitUntil(() => controlled.active === 0);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('rejects an output path that escapes the download root', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-path-'));
  const queue = new QueueService(
    new ControlledDownloadService() as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '../outside/{title}.{ext}',
    },
  );

  try {
    assert.throws(
      () => queue.enqueue([{ videoId: 'video-path', title: 'unsafe' }]),
      (error: unknown) => error instanceof AppError && error.code === 'PATH_NOT_ALLOWED',
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

class FlakyDownloadService {
  attempts = 0;

  constructor(
    private readonly failures: number,
    private readonly code: AppError['code'] = 'NETWORK_ERROR',
  ) {}

  async download(): Promise<void> {
    this.attempts++;
    if (this.attempts <= this.failures) {
      throw new AppError(this.code, `temporary failure ${this.attempts}`);
    }
  }
}

test('automatically retries transient failures and eventually completes', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-retry-'));
  const flaky = new FlakyDownloadService(1);
  const queue = new QueueService(
    flaky as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
    },
    null,
    () => 10,
  );

  try {
    const [taskId] = queue.enqueue([{ videoId: 'retry-video', title: 'retry' }]);
    await waitUntil(() => queue.getTask(taskId!)?.status === 'completed');
    assert.equal(flaky.attempts, 2);
    assert.equal(queue.getTask(taskId!)?.retryCount, 1);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('does not automatically retry non-transient failures', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-no-retry-'));
  const unavailable = new FlakyDownloadService(1, 'VIDEO_UNAVAILABLE');
  const queue = new QueueService(
    unavailable as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
    },
  );

  try {
    const [taskId] = queue.enqueue([{ videoId: 'unavailable-video', title: 'unavailable' }]);
    await waitUntil(() => queue.getTask(taskId!)?.status === 'failed');
    assert.equal(unavailable.attempts, 1);
    assert.equal(queue.getTask(taskId!)?.retryCount, 0);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('restores a persisted retry timer after restart without duplicating the task', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-restore-retry-'));
  const db = initDatabase(path.join(outputRoot, 'data', 'app.db'));
  const persistedTask: DownloadTask = {
    id: 'persisted-retry',
    videoId: 'persisted-video',
    title: 'persisted retry',
    formatId: 'best',
    container: 'mp4',
    outputPath: path.join(outputRoot, 'persisted.mp4'),
    subtitleLangs: [],
    subtitleMode: 'none',
    autoSubtitle: false,
    status: 'retrying',
    progress: 25,
    speed: '',
    eta: '',
    downloadedBytes: 100,
    totalBytes: 400,
    estimatedBytes: 400,
    retryCount: 1,
    maxRetries: 2,
    nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
    error: 'temporary network error',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
  db.stmts.upsertTask.run(taskToRow(persistedTask));
  const succeeding = new FlakyDownloadService(0);
  const queue = new QueueService(
    succeeding as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
    },
    db,
    () => 10,
  );

  try {
    assert.deepEqual(queue.restoreFromDb(), { restored: 1, resumed: 1 });
    await waitUntil(() => queue.getTask('persisted-retry')?.status === 'completed');
    assert.equal(succeeding.attempts, 1);
    assert.equal(queue.getAllTasks().filter((task) => task.id === 'persisted-retry').length, 1);
  } finally {
    db.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
