import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { DownloadService } from '../server/services/download.service.ts';
import { NamingService } from '../server/services/naming.service.ts';
import { QueueService } from '../server/services/queue.service.ts';
import type { DownloadTask } from '../server/types/download.ts';

class CompletingDownloadService {
  readonly started: string[] = [];

  async download(task: DownloadTask): Promise<void> {
    this.started.push(task.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('test timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createQueue(outputRoot: string, service: CompletingDownloadService): QueueService {
  return new QueueService(
    service as unknown as DownloadService,
    new NamingService(),
    {
      maxConcurrent: 3,
      maxRetries: 2,
      downloadPath: outputRoot,
      namingTemplate: '{title}.{ext}',
      gentleMode: true,
      gentleRateLimitMbps: 2,
      gentleCooldownSeconds: 0.05,
      gentleBatchLimit: 20,
    },
  );
}

test('pausing or cancelling the only queued task clears a gentle cooldown timer', async () => {
  for (const action of ['pause', 'cancel'] as const) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yld-gentle-${action}-`));
    const service = new CompletingDownloadService();
    const queue = createQueue(outputRoot, service);

    try {
      const { taskIds } = queue.enqueue([
        { videoId: `cooldown-${action}-one`, title: 'cooldown first' },
        { videoId: `cooldown-${action}-two`, title: 'cooldown second' },
      ]);
      const firstId = taskIds[0]!;
      const secondId = taskIds[1]!;
      await waitUntil(() => queue.getTask(firstId)?.status === 'completed');
      await waitUntil(() => queue.getTask(secondId)?.status === 'queued');

      queue[action](secondId);
      assert.equal(queue.getTask(secondId)?.status, action === 'pause' ? 'paused' : 'cancelled');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(service.started.includes(secondId), false);
    } finally {
      queue.shutdown();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test('shutdown during gentle cooldown prevents queued work from starting after the deadline', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-gentle-shutdown-'));
  const service = new CompletingDownloadService();
  const queue = createQueue(outputRoot, service);

  try {
    const { taskIds } = queue.enqueue([
      { videoId: 'shutdown-first', title: 'shutdown first' },
      { videoId: 'shutdown-second', title: 'shutdown second' },
    ]);
    const firstId = taskIds[0]!;
    const secondId = taskIds[1]!;
    await waitUntil(() => queue.getTask(firstId)?.status === 'completed');
    await waitUntil(() => queue.getTask(secondId)?.status === 'queued');

    queue.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(queue.getTask(secondId)?.status, 'queued');
    assert.equal(service.started.includes(secondId), false);
  } finally {
    queue.shutdown();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
