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
  readonly discarded: string[] = [];
  readonly cleaned: string[] = [];

  discardTaskArtifacts(task: DownloadTask): void {
    this.discarded.push(task.id);
  }

  cleanupTaskTempArtifacts(task: DownloadTask): void {
    this.cleaned.push(task.id);
  }

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
    const { taskIds } = queue.enqueue([
      { videoId: 'video-1', title: 'one' },
      { videoId: 'video-2', title: 'two' },
      { videoId: 'video-3', title: 'three' },
    ]);
    const first = taskIds[0]!;
    const second = taskIds[1]!;
    const third = taskIds[2]!;

    await waitUntil(() => controlled.started.includes(first));
    queue.pause(first);
    assert.throws(
      () => queue.pause(first),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_STATE',
    );
    await waitUntil(() => controlled.started.includes(second));
    queue.cancel(second);
    assert.throws(
      () => queue.remove(second),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_STATE' && /仍在停止/.test(error.message),
    );
    assert.throws(
      () => queue.forgetTerminalTasks(),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_STATE' && /仍在停止/.test(error.message),
    );
    await waitUntil(() => controlled.started.includes(third));

    assert.equal(controlled.maxActive, 1);
    assert.equal(queue.getTask(first)?.status, 'paused');
    assert.equal(queue.getTask(second)?.status, 'cancelled');

    queue.cancel(third);
    await waitUntil(() => controlled.active === 0 && controlled.discarded.includes(third));
    assert.deepEqual(new Set(controlled.discarded), new Set([second, third]));
    assert.equal(controlled.discarded.includes(first), false);
    assert.doesNotThrow(() => queue.remove(third));
    assert.equal(queue.getTask(third), undefined);
    assert.equal(queue.forgetTerminalTasks(), 1);
    assert.equal(queue.getTask(second), undefined);
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
    const [taskId] = queue.enqueue([{ videoId: 'retry-video', title: 'retry' }]).taskIds;
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
    const [taskId] = queue.enqueue([{ videoId: 'unavailable-video', title: 'unavailable' }]).taskIds;
    await waitUntil(() => queue.getTask(taskId!)?.status === 'failed');
    assert.equal(unavailable.attempts, 1);
    assert.equal(queue.getTask(taskId!)?.retryCount, 0);
    assert.equal(queue.getTask(taskId!)?.errorCode, 'VIDEO_UNAVAILABLE');
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('retries a failed task restored from history after restart', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-history-retry-'));
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
  );
  const failedTask: DownloadTask = {
    id: 'history-failed-task',
    videoId: 'history-id',
    title: 'history retry',
    formatId: 'best',
    container: 'mp4',
    outputPath: path.join(outputRoot, 'history retry.mp4'),
    subtitleLangs: [],
    subtitleMode: 'none',
    autoSubtitle: false,
    status: 'failed',
    progress: 23,
    speed: '',
    eta: '',
    downloadedBytes: 100,
    totalBytes: 400,
    estimatedBytes: 400,
    retryCount: 2,
    maxRetries: 2,
    error: 'previous failure',
    errorCode: 'NETWORK_ERROR',
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  try {
    const status = queue.retryFailedTask(failedTask);
    assert.equal(status.tasks[0]?.status, 'downloading');
    await waitUntil(() => queue.getTask(failedTask.id)?.status === 'completed');
    assert.equal(queue.getTask(failedTask.id)?.retryCount, 0);
    assert.equal(queue.getTask(failedTask.id)?.error, undefined);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('rejects an existing output atomically and can safely rename it', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-conflict-'));
  const existingPath = path.join(outputRoot, 'lesson.mp4');
  fs.writeFileSync(existingPath, 'existing download');
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
    const rejected = queue.enqueue([{ videoId: 'existing-id', title: 'lesson' }]);
    assert.equal(rejected.taskIds.length, 0);
    assert.equal(rejected.conflicts.length, 1);
    assert.equal(rejected.conflicts[0]?.reason, 'file_exists');
    assert.equal(queue.getAllTasks().length, 0);

    const renamed = queue.enqueue(
      [{ videoId: 'existing-id', title: 'lesson' }],
      'rename',
    );
    assert.equal(renamed.taskIds.length, 1);
    assert.equal(renamed.conflicts.length, 0);
    assert.equal(renamed.renamed[0]?.outputPath, path.join(outputRoot, 'lesson (2).mp4'));
    assert.equal(fs.readFileSync(existingPath, 'utf8'), 'existing download');

    const taskId = renamed.taskIds[0]!;
    await waitUntil(() => controlled.started.includes(taskId));
    queue.cancel(taskId);
    await waitUntil(() => controlled.active === 0);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('rejects a duplicate inside one batch without creating partial tasks', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-batch-conflict-'));
  const queue = new QueueService(
    new ControlledDownloadService() as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 1,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
    },
  );

  try {
    const result = queue.enqueue([
      { videoId: 'batch-one', title: 'same' },
      { videoId: 'batch-two', title: 'same' },
    ]);
    assert.equal(result.taskIds.length, 0);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]?.inputIndex, 1);
    assert.equal(result.conflicts[0]?.reason, 'batch_duplicate');
    assert.equal(queue.getAllTasks().length, 0);
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

class CompletingDownloadService {
  readonly started: string[] = [];
  maxActive = 0;
  private active = 0;

  async download(task: DownloadTask): Promise<void> {
    this.started.push(task.id);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.active -= 1;
  }
}

test('gentle mode fixes effective concurrency at one and waits for cooldown', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-gentle-'));
  const completing = new CompletingDownloadService();
  const queue = new QueueService(
    completing as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 4,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
      gentleMode: true,
      gentleRateLimitMbps: 2,
      gentleCooldownSeconds: 10,
      gentleBatchLimit: 20,
    },
  );

  try {
    const { taskIds } = queue.enqueue([
      { videoId: 'gentle-one', title: 'gentle one' },
      { videoId: 'gentle-two', title: 'gentle two' },
    ]);
    await waitUntil(() => queue.getTask(taskIds[0]!)?.status === 'completed');
    assert.equal(completing.maxActive, 1);
    assert.equal(queue.getTask(taskIds[1]!)?.status, 'queued');

    queue.updateOptions({
      maxConcurrent: 4,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
      gentleMode: false,
      gentleRateLimitMbps: 2,
      gentleCooldownSeconds: 10,
      gentleBatchLimit: 20,
    });
    await waitUntil(() => queue.getTask(taskIds[1]!)?.status === 'completed');
    assert.equal(queue.getTask(taskIds[1]!)?.status, 'completed');
  } finally {
    queue.shutdown();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

class ProtectiveDownloadService {
  attempts = 0;

  constructor(private readonly code: 'RATE_LIMITED' | 'COOKIE_ERROR') {}

  async download(): Promise<void> {
    this.attempts += 1;
    if (this.attempts === 1) throw new AppError(this.code, 'protective failure');
  }
}

test('protective errors pause queued work only when gentle mode is enabled', async () => {
  for (const code of ['RATE_LIMITED', 'COOKIE_ERROR'] as const) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yld-queue-protective-${code.toLowerCase()}-`));
    const service = new ProtectiveDownloadService(code);
    const queue = new QueueService(
      service as unknown as DownloadService,
      new NamingService(),
      {
        maxConcurrent: 1,
        maxRetries: 2,
        downloadPath: outputRoot,
        namingTemplate: '{title}.{ext}',
        gentleMode: true,
        gentleRateLimitMbps: 2,
        gentleCooldownSeconds: 30,
        gentleBatchLimit: 20,
      },
    );

    try {
      const { taskIds } = queue.enqueue([
        { videoId: `protect-${code}-one`, title: 'protect one' },
        { videoId: `protect-${code}-two`, title: 'protect two' },
        { videoId: `protect-${code}-three`, title: 'protect three' },
      ]);
      await waitUntil(() => queue.getTask(taskIds[0]!)?.status === 'failed');
      assert.equal(queue.getTask(taskIds[0]!)?.errorCode, code);
      for (const id of taskIds.slice(1)) {
        assert.equal(queue.getTask(id)?.status, 'paused');
        assert.equal(queue.getTask(id)?.errorCode, code);
        assert.match(queue.getTask(id)?.error ?? '', /后续任务已暂停/);
        assert.equal(queue.getTask(id)?.nextRetryAt, undefined);
      }
      assert.equal(service.attempts, 1);
    } finally {
      queue.shutdown();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test('protective errors behave as ordinary failures when gentle mode is disabled', async () => {
  for (const code of ['RATE_LIMITED', 'COOKIE_ERROR'] as const) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yld-queue-normal-${code.toLowerCase()}-`));
    const service = new ProtectiveDownloadService(code);
    const queue = new QueueService(
      service as unknown as DownloadService,
      new NamingService(),
      {
        maxConcurrent: 1,
        maxRetries: 2,
        downloadPath: outputRoot,
        namingTemplate: '{title}.{ext}',
        gentleMode: false,
        gentleRateLimitMbps: 2,
        gentleCooldownSeconds: 30,
        gentleBatchLimit: 20,
      },
    );

    try {
      const { taskIds } = queue.enqueue([
        { videoId: `normal-${code}-one`, title: 'normal one' },
        { videoId: `normal-${code}-two`, title: 'normal two' },
      ]);
      await waitUntil(() => queue.getTask(taskIds[1]!)?.status === 'completed');
      assert.equal(queue.getTask(taskIds[0]!)?.status, 'failed');
      assert.equal(queue.getTask(taskIds[0]!)?.errorCode, code);
      assert.equal(queue.getTask(taskIds[1]!)?.status, 'completed');
      assert.equal(service.attempts, 2);
    } finally {
      queue.shutdown();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test('enforces the gentle batch limit before creating tasks and allows its boundary cases', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-gentle-batch-'));
  const queue = new QueueService(
    new CompletingDownloadService() as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 2,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
      gentleMode: true,
      gentleRateLimitMbps: 2,
      gentleCooldownSeconds: 10,
      gentleBatchLimit: 2,
    },
  );

  try {
    assert.throws(
      () => queue.enqueue([
        { videoId: 'gentle-limit-one', title: 'gentle limit one' },
        { videoId: 'gentle-limit-two', title: 'gentle limit two' },
        { videoId: 'gentle-limit-three', title: 'gentle limit three' },
      ]),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_PARAM',
    );
    assert.equal(queue.getAllTasks().length, 0);

    const atLimit = queue.enqueue([
      { videoId: 'gentle-boundary-one', title: 'gentle boundary one' },
      { videoId: 'gentle-boundary-two', title: 'gentle boundary two' },
    ]);
    assert.equal(atLimit.taskIds.length, 2);
    const single = queue.enqueue([{ videoId: 'gentle-single', title: 'gentle single' }]);
    assert.equal(single.taskIds.length, 1);
  } finally {
    queue.shutdown();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }

  const normalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-queue-normal-batch-'));
  const normalQueue = new QueueService(
    new CompletingDownloadService() as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 2,
      maxRetries: 2,
      downloadPath: normalRoot,
      namingTemplate: '{title}.{ext}',
      gentleMode: false,
      gentleRateLimitMbps: 2,
      gentleCooldownSeconds: 30,
      gentleBatchLimit: 1,
    },
  );
  try {
    const result = normalQueue.enqueue([
      { videoId: 'normal-batch-one', title: 'normal batch one' },
      { videoId: 'normal-batch-two', title: 'normal batch two' },
    ]);
    assert.equal(result.taskIds.length, 2);
  } finally {
    normalQueue.shutdown();
    fs.rmSync(normalRoot, { recursive: true, force: true });
  }
});

class RetryThenProtectiveDownloadService {
  readonly attempts = new Map<string, number>();

  constructor(private readonly protectiveCode: 'RATE_LIMITED' | 'COOKIE_ERROR') {}

  async download(task: DownloadTask): Promise<void> {
    const attempt = (this.attempts.get(task.id) ?? 0) + 1;
    this.attempts.set(task.id, attempt);
    if (task.title === 'retry first' && attempt === 1) {
      throw new AppError('NETWORK_ERROR', 'temporary network failure');
    }
    if (task.title === 'protect second' && attempt === 1) {
      throw new AppError(this.protectiveCode, 'protective failure');
    }
  }
}

test('protective errors pause existing retrying tasks and clear their retry timers', async () => {
  for (const code of ['RATE_LIMITED', 'COOKIE_ERROR'] as const) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yld-queue-clear-retry-${code.toLowerCase()}-`));
    const service = new RetryThenProtectiveDownloadService(code);
    const queue = new QueueService(
      service as unknown as DownloadService,
      new NamingService(),
      {
        maxConcurrent: 1,
        maxRetries: 2,
        downloadPath: outputRoot,
        namingTemplate: '{title}.{ext}',
        gentleMode: true,
        gentleRateLimitMbps: 2,
        gentleCooldownSeconds: 0.5,
        gentleBatchLimit: 20,
      },
      null,
      () => 1_000,
    );

    try {
      const { taskIds } = queue.enqueue([
        { videoId: `retry-${code}-one`, title: 'retry first' },
        { videoId: `protect-${code}-two`, title: 'protect second' },
      ]);
      const retryingId = taskIds[0]!;
      const protectedId = taskIds[1]!;
      await waitUntil(() => queue.getTask(retryingId)?.status === 'retrying');
      await waitUntil(() => queue.getTask(protectedId)?.status === 'failed');

      assert.equal(queue.getTask(retryingId)?.status, 'paused');
      assert.equal(queue.getTask(retryingId)?.errorCode, code);
      assert.equal(queue.getTask(retryingId)?.nextRetryAt, undefined);
      assert.equal(queue.getTask(protectedId)?.errorCode, code);

      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(service.attempts.get(retryingId), 1);
    } finally {
      queue.shutdown();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});
