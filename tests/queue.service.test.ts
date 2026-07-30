import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
