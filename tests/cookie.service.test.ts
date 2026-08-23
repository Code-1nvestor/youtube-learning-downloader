import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CookieService } from '../server/services/cookie.service.ts';

const COOKIE_CONTENT = [
  '# Netscape HTTP Cookie File',
  '.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\ttest-value',
].join('\n');

test('restores file Cookie configuration across application restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  try {
    const first = new CookieService(root);
    first.setFromFile(COOKIE_CONTENT);
    const restored = new CookieService(root);

    assert.equal(restored.getStatus().source, 'file');
    assert.equal(restored.getStatus().configured, true);
    assert.equal(restored.getArg()?.flag, '--cookies');

    restored.clear();
    assert.equal(new CookieService(root).getStatus().configured, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restores an explicitly selected 0.24 browser compatibility mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  try {
    new CookieService(root).setFromBrowser('edge');
    const restored = new CookieService(root);
    assert.deepEqual(restored.getArg(), { flag: '--cookies-from-browser', value: 'edge' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrates a legacy direct-browser configuration without reading Chrome again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  try {
    const cookieDir = path.join(root, '.cookies');
    fs.mkdirSync(cookieDir, { recursive: true });
    fs.writeFileSync(path.join(cookieDir, 'config.json'), JSON.stringify({ source: 'browser', browser: 'chrome' }));
    const service = new CookieService(root);
    assert.equal(service.getStatus().configured, false);
    assert.equal(service.getStatus().migrationRequired, true);
    assert.equal(service.getArg(), undefined);
    assert.match(fs.readFileSync(path.join(cookieDir, 'config.json'), 'utf8'), /"schemaVersion":2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stores and restores app-managed YouTube login cookies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  const now = new Date('2026-08-23T00:00:00.000Z');
  try {
    const service = new CookieService(root, { now: () => now });
    service.setFromManagedBrowser(COOKIE_CONTENT);
    const status = service.getStatus();
    assert.equal(status.source, 'managed');
    assert.equal(status.validity, 'valid');
    assert.equal(status.importedAt, now.toISOString());
    assert.equal(path.basename(service.getArg()?.value ?? ''), 'youtube-auth.txt');

    const restored = new CookieService(root, { now: () => now });
    assert.equal(restored.getStatus().source, 'managed');
    assert.equal(restored.getArg()?.flag, '--cookies');
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.cookies', 'config.json'), 'utf8'), /test-value/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('imports and restores an isolated Chrome Cookie snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  const importedAt = new Date('2026-08-10T00:00:00.000Z');
  try {
    const service = new CookieService(root, {
      now: () => importedAt,
      detectBrowserRunning: async () => false,
      exportBrowserCookies: async (_browser, outputPath) => {
        fs.writeFileSync(outputPath, COOKIE_CONTENT, 'utf8');
      },
    });
    const status = await service.importBrowserSnapshot('chrome');
    assert.equal(status.source, 'snapshot');
    assert.equal(status.validity, 'valid');
    assert.equal(status.importedAt, importedAt.toISOString());
    assert.equal(service.getArg()?.flag, '--cookies');
    assert.equal(path.basename(service.getArg()?.value ?? ''), 'chrome-snapshot.txt');

    const restored = new CookieService(root, { now: () => importedAt });
    assert.equal(restored.getStatus().source, 'snapshot');
    assert.equal(restored.getStatus().validity, 'valid');
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.cookies', 'config.json'), 'utf8'), /test-value/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed snapshot refresh preserves the previous valid snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  let fail = false;
  try {
    const service = new CookieService(root, {
      detectBrowserRunning: async () => false,
      exportBrowserCookies: async (_browser, outputPath) => {
        if (fail) throw new Error('simulated export failure');
        fs.writeFileSync(outputPath, COOKIE_CONTENT, 'utf8');
      },
    });
    await service.importBrowserSnapshot('chrome');
    const snapshotPath = service.getArg()?.value;
    assert.ok(snapshotPath);
    const original = fs.readFileSync(snapshotPath, 'utf8');

    fail = true;
    await assert.rejects(service.importBrowserSnapshot('chrome'), /simulated export failure/);
    assert.equal(service.getStatus().source, 'snapshot');
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('running Chrome blocks snapshot import before browser data is accessed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  let exported = false;
  try {
    const service = new CookieService(root, {
      detectBrowserRunning: async () => true,
      exportBrowserCookies: async () => { exported = true; },
    });
    await assert.rejects(service.importBrowserSnapshot('chrome'), /Chrome 正在运行/);
    assert.equal(exported, false);
    assert.equal(service.getStatus().source, 'none');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
