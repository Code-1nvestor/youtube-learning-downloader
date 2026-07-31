import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initDatabase } from '../server/db/database.ts';
import { rowToTask, taskToRow, type TaskRow } from '../server/db/task-serializer.ts';
import { BackupService } from '../server/services/backup.service.ts';
import { SettingsService } from '../server/services/settings.service.ts';
import type { DownloadTask, QueueStatus } from '../server/types/download.ts';

function makeTask(root: string, id: string, status: DownloadTask['status']): DownloadTask {
  return {
    id,
    videoId: 'YE7VzlLtp-4',
    title: `课程 ${id}`,
    formatId: 'bestvideo+bestaudio',
    container: 'mp4',
    outputPath: path.join(root, `${id}.mp4`),
    subtitleLangs: ['zh-Hans'],
    subtitleMode: 'separate',
    autoSubtitle: true,
    status,
    progress: status === 'completed' ? 100 : 42,
    speed: status === 'downloading' ? '2MiB/s' : '',
    eta: status === 'downloading' ? '00:20' : '',
    downloadedBytes: 42,
    totalBytes: 100,
    estimatedBytes: 100,
    retryCount: 0,
    maxRetries: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...(status === 'completed' ? { completedAt: '2026-08-01T00:01:00.000Z' } : {}),
  };
}

function emptyQueue(tasks: DownloadTask[] = []): QueueStatus {
  return { tasks, active: 0, waiting: 0, completed: 0, failed: 0 };
}

test('exports settings and tasks without Cookie material', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-backup-export-'));
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(path.join(tempDir, 'app.db'));
  try {
    const settings = new SettingsService({
      downloadPath,
      maxConcurrent: 2,
      maxRetries: 2,
      namingTemplate: '{date}_{title}.{ext}',
      proxyUrl: '',
    }, db);
    settings.update({ maxConcurrent: 3 });
    db.stmts.upsertTask.run(taskToRow(makeTask(downloadPath, 'completed-one', 'completed')));
    const service = new BackupService({
      db,
      getSettings: () => settings.getSettings(),
      getQueueStatus: () => emptyQueue(),
      appVersion: '0.22.0-test',
    });

    const backup = service.createBackup();
    assert.equal(backup.format, 'youtube-learning-downloader-backup');
    assert.equal(backup.version, 1);
    assert.equal(backup.appVersion, '0.22.0-test');
    assert.equal(backup.cookieIncluded, false);
    assert.equal(backup.data.settings.maxConcurrent, 3);
    assert.equal(backup.data.tasks[0]?.id, 'completed-one');
    assert.doesNotMatch(JSON.stringify(backup), /cookie(source|file|browser|content)/i);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('restores atomically and converts runnable backup tasks to paused', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-backup-restore-'));
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(path.join(tempDir, 'app.db'));
  try {
    const settings = new SettingsService({
      downloadPath,
      maxConcurrent: 1,
      maxRetries: 1,
      namingTemplate: '{title}.{ext}',
      proxyUrl: '',
    }, db);
    const oldTask = makeTask(downloadPath, 'old-task', 'failed');
    db.stmts.upsertTask.run(taskToRow(oldTask));
    const service = new BackupService({
      db,
      getSettings: () => settings.getSettings(),
      getQueueStatus: () => emptyQueue(),
      appVersion: '0.22.0-test',
    });
    const backup = service.createBackup();
    backup.data.settings.maxRetries = 4;
    backup.data.tasks = [
      makeTask(downloadPath, 'finished', 'completed'),
      makeTask(downloadPath, 'was-running', 'downloading'),
      { ...makeTask(downloadPath, 'was-retrying', 'retrying'), nextRetryAt: '2026-08-01T00:10:00.000Z' },
    ];

    const inspected = service.inspectBackup(backup);
    assert.equal(inspected.taskCount, 3);
    assert.equal(inspected.willPauseCount, 2);
    assert.equal(inspected.relocatedTaskCount, 0);
    const restored = service.restoreBackup(backup);
    assert.equal(restored.restored, true);
    assert.equal(restored.restartRequired, true);

    const rows = db.db.prepare('SELECT * FROM download_tasks ORDER BY id').all() as unknown as TaskRow[];
    const tasks = rows.map(rowToTask);
    assert.deepEqual(tasks.map((task) => task.id), ['finished', 'was-retrying', 'was-running']);
    assert.equal(tasks.find((task) => task.id === 'was-running')?.status, 'paused');
    assert.equal(tasks.find((task) => task.id === 'was-retrying')?.status, 'paused');
    assert.equal(tasks.find((task) => task.id === 'was-retrying')?.nextRetryAt, undefined);
    assert.equal(db.stmts.getTaskById.get('old-task'), undefined);
    const savedRetries = db.db.prepare("SELECT value FROM app_settings WHERE key = 'maxRetries'").get() as { value: string };
    assert.equal(JSON.parse(savedRetries.value), 4);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rejects unsafe backups and refuses restore while work is running', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-backup-guard-'));
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(path.join(tempDir, 'app.db'));
  try {
    const settings = new SettingsService({
      downloadPath,
      maxConcurrent: 1,
      maxRetries: 1,
      namingTemplate: '{title}.{ext}',
      proxyUrl: '',
    }, db);
    const running = makeTask(downloadPath, 'current', 'downloading');
    const service = new BackupService({
      db,
      getSettings: () => settings.getSettings(),
      getQueueStatus: () => emptyQueue([running]),
      appVersion: '0.22.0-test',
    });
    const backup = service.createBackup();
    backup.data.tasks = [makeTask(downloadPath, 'incoming', 'completed')];
    assert.throws(() => service.restoreBackup(backup), /请先暂停或取消/);

    const idleService = new BackupService({
      db,
      getSettings: () => settings.getSettings(),
      getQueueStatus: () => emptyQueue(),
      appVersion: '0.22.0-test',
    });
    const relocated = structuredClone(backup);
    relocated.data.tasks[0] = makeTask(path.join(tempDir, 'outside'), 'incoming-failed', 'failed');
    assert.equal(idleService.inspectBackup(relocated).relocatedTaskCount, 1);
    idleService.restoreBackup(relocated);
    const relocatedRow = db.stmts.getTaskById.get('incoming-failed') as unknown as TaskRow;
    const relocatedTask = rowToTask(relocatedRow);
    assert.match(relocatedTask.outputPath, /downloads[\\/]已恢复任务[\\/]/);

    const unsafe = structuredClone(backup);
    unsafe.data.tasks[0]!.id = '../unsafe';
    assert.throws(() => idleService.inspectBackup(unsafe), /不能安全用于任务目录/);
    assert.throws(
      () => idleService.inspectBackup({ ...backup, cookieIncluded: true }),
      /敏感 Cookie/,
    );
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rolls the database back when a restore write fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-backup-rollback-'));
  const downloadPath = path.join(tempDir, 'downloads');
  const db = initDatabase(path.join(tempDir, 'app.db'));
  try {
    const settings = new SettingsService({
      downloadPath,
      maxConcurrent: 1,
      maxRetries: 1,
      namingTemplate: '{title}.{ext}',
      proxyUrl: '',
    }, db);
    const original = makeTask(downloadPath, 'original', 'completed');
    db.stmts.upsertTask.run(taskToRow(original));
    const service = new BackupService({
      db,
      getSettings: () => settings.getSettings(),
      getQueueStatus: () => emptyQueue(),
      appVersion: '0.22.0-test',
    });
    const backup = service.createBackup();
    backup.data.tasks = [makeTask(downloadPath, 'forced-failure', 'completed')];
    db.db.exec(`
      CREATE TRIGGER reject_forced_restore
      BEFORE INSERT ON download_tasks
      WHEN NEW.id = 'forced-failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced restore failure');
      END;
    `);

    assert.throws(() => service.restoreBackup(backup), /原有数据已保留/);
    assert.ok(db.stmts.getTaskById.get('original'));
    assert.equal(db.stmts.getTaskById.get('forced-failure'), undefined);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
