import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initDatabase } from '../server/db/database.ts';
import { rowToTask } from '../server/db/task-serializer.ts';

test('migrates version 1 databases without losing unfinished tasks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-db-migration-'));
  const dbPath = path.join(root, 'app.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE download_tasks (
      id TEXT PRIMARY KEY NOT NULL, video_id TEXT NOT NULL, title TEXT NOT NULL,
      playlist_title TEXT, playlist_index INTEGER, format_id TEXT NOT NULL,
      container TEXT NOT NULL, output_path TEXT NOT NULL,
      subtitle_langs TEXT NOT NULL DEFAULT '[]', subtitle_mode TEXT NOT NULL DEFAULT 'none',
      auto_subtitle INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0, speed TEXT NOT NULL DEFAULT '', eta TEXT NOT NULL DEFAULT '',
      downloaded_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO download_tasks (
      id, video_id, title, format_id, container, output_path, status, created_at, updated_at
    ) VALUES (
      'legacy-task', 'legacy-video', 'Legacy task', 'best', 'mp4', 'C:/Downloads/legacy.mp4',
      'queued', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const migrated = initDatabase(dbPath);
  try {
    const version = migrated.db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(version.user_version, 5);

    const row = migrated.stmts.getTaskById.get('legacy-task');
    assert.ok(row);
    const task = rowToTask(row as never);
    assert.equal(task.status, 'queued');
    assert.equal(task.estimatedBytes, 0);
    assert.equal(task.retryCount, 0);
    assert.equal(task.maxRetries, 2);
    assert.equal(task.nextRetryAt, undefined);
    assert.equal(task.errorCode, undefined);
    assert.equal(task.authentication, 'auto');
    assert.equal(task.accessMode, 'direct');
  } finally {
    migrated.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
