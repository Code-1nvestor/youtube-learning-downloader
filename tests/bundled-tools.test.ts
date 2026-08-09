import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveToolBinary } from '../server/core/bundled-tools.ts';

test('prefers a packaged Windows tool over the PATH fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tools-'));
  const binDir = path.join(root, 'bin');
  const executableName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const executablePath = path.join(binDir, executableName);

  try {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(executablePath, '');
    assert.equal(resolveToolBinary('yt-dlp', 'yt-dlp', root), executablePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to the configured command when no packaged tool exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tools-'));
  try {
    assert.equal(resolveToolBinary('ffmpeg', 'custom-ffmpeg', root), 'custom-ffmpeg');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolves a bundled Deno runtime from the desktop resources directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tools-'));
  const executableName = process.platform === 'win32' ? 'deno.exe' : 'deno';
  const executablePath = path.join(root, 'bin', executableName);
  try {
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');
    assert.equal(resolveToolBinary('deno', 'deno', root), executablePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prefers a user-updated tool over the packaged copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tools-'));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-app-data-'));
  const executableName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const bundled = path.join(root, 'bin', executableName);
  const updated = path.join(appData, 'tools', executableName);
  try {
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.mkdirSync(path.dirname(updated), { recursive: true });
    fs.writeFileSync(bundled, 'bundled');
    fs.writeFileSync(updated, 'updated');
    assert.equal(resolveToolBinary('yt-dlp', 'yt-dlp', root, appData), updated);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(appData, { recursive: true, force: true });
  }
});
