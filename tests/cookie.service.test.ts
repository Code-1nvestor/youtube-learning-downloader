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

test('restores browser Cookie selection without storing Cookie contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-cookie-'));
  try {
    new CookieService(root).setFromBrowser('edge');
    const restored = new CookieService(root);
    assert.deepEqual(restored.getArg(), { flag: '--cookies-from-browser', value: 'edge' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
