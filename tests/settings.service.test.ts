import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initDatabase, type DbContext } from '../server/db/database.ts';
import { SettingsService } from '../server/services/settings.service.ts';
import { AppError } from '../server/types/errors.ts';

function assertAppError(code: AppError['code']): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code;
}

test('persists application settings and reloads them after restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-settings-'));
  const dbPath = path.join(root, 'data', 'app.db');
  const defaultDownloadPath = path.join(root, 'default-downloads');
  const customDownloadPath = path.join(root, 'course-downloads');
  let db: DbContext | null = null;

  try {
    db = initDatabase(dbPath);
    const service = new SettingsService(
      {
        downloadPath: defaultDownloadPath,
        maxConcurrent: 2,
        namingTemplate: '{course}/{date}_{num}_{title}.{ext}',
      },
      db,
    );

    const updated = service.update({
      downloadPath: customDownloadPath,
      maxConcurrent: 4,
      namingTemplate: '{course}/{num}_{title}.{ext}',
    });
    assert.equal(updated.persistent, true);
    assert.equal(updated.maxConcurrent, 4);
    assert.equal(updated.downloadPath, path.resolve(customDownloadPath));
    assert.equal(fs.existsSync(customDownloadPath), true);

    db.close();
    db = initDatabase(dbPath);
    const restored = new SettingsService(
      {
        downloadPath: defaultDownloadPath,
        maxConcurrent: 1,
        namingTemplate: '{title}.{ext}',
      },
      db,
    ).getStatus();

    assert.equal(restored.downloadPath, path.resolve(customDownloadPath));
    assert.equal(restored.maxConcurrent, 4);
    assert.equal(restored.namingTemplate, '{course}/{num}_{title}.{ext}');
  } finally {
    db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe or invalid application settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-settings-'));
  try {
    const service = new SettingsService({
      downloadPath: path.join(root, 'downloads'),
      maxConcurrent: 2,
      namingTemplate: '{title}.{ext}',
    });

    assert.throws(() => service.update({ downloadPath: 'relative/downloads' }), assertAppError('PATH_NOT_ALLOWED'));
    assert.throws(() => service.update({ maxConcurrent: 0 }), assertAppError('INVALID_PARAM'));
    assert.throws(() => service.update({ maxConcurrent: 9 }), assertAppError('INVALID_PARAM'));
    assert.throws(
      () => service.update({ namingTemplate: '../outside/{title}.{ext}' }),
      assertAppError('PATH_NOT_ALLOWED'),
    );
    assert.throws(
      () => service.update({ namingTemplate: '{course}/{unknown}/{title}.{ext}' }),
      assertAppError('INVALID_PARAM'),
    );
    assert.throws(
      () => service.update({ namingTemplate: '{course}/{date}.mp4' }),
      assertAppError('INVALID_PARAM'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to the default directory when a persisted path is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-settings-'));
  const db = initDatabase(path.join(root, 'data', 'app.db'));
  try {
    const unavailablePath = path.join(root, 'not-a-directory');
    const defaultPath = path.join(root, 'default-downloads');
    fs.writeFileSync(unavailablePath, 'file blocks directory creation');
    const updatedAt = new Date().toISOString();
    db.stmts.upsertSetting.run('downloadPath', JSON.stringify(unavailablePath), updatedAt);
    db.stmts.upsertSetting.run('maxConcurrent', JSON.stringify(5), updatedAt);

    const status = new SettingsService(
      {
        downloadPath: defaultPath,
        maxConcurrent: 2,
        namingTemplate: '{title}.{ext}',
      },
      db,
    ).getStatus();

    assert.equal(status.downloadPath, path.resolve(defaultPath));
    assert.equal(status.maxConcurrent, 5);
    assert.equal(fs.statSync(defaultPath).isDirectory(), true);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
