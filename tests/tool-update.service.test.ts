import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolUpdateService } from '../server/services/tool-update.service.ts';
import type { ProcessResult } from '../server/core/process.ts';

function result(stdout = '', stderr = '', exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 1 };
}

test('updates a verified user-data copy and leaves the bundled binary untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tool-update-'));
  const resourcePath = path.join(root, 'resources');
  const appDataPath = path.join(root, 'app-data');
  const binary = path.join(resourcePath, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'bundled-binary');

  const calls: string[][] = [];
  const service = new ToolUpdateService({
    binary,
    currentVersion: '2026.07.04',
    appDataPath,
    resourcePath,
    runner: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === '--update-to') {
        fs.writeFileSync(command, 'updated-binary');
        return result('Updated to nightly');
      }
      return result('2026.08.01\n');
    },
  });

  try {
    const status = await service.updateYtDlp();
    const destination = path.join(appDataPath, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    assert.equal(fs.readFileSync(binary, 'utf8'), 'bundled-binary');
    assert.equal(fs.readFileSync(destination, 'utf8'), 'updated-binary');
    assert.deepEqual(calls.map((call) => call.slice(1)), [
      ['--update-to', 'nightly'],
      ['--version'],
    ]);
    assert.equal(status.installedVersion, '2026.08.01');
    assert.equal(status.restartRequired, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not replace the existing user copy when the official updater fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tool-update-'));
  const binary = path.join(root, 'bundled', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'bundled');
  const service = new ToolUpdateService({
    binary,
    appDataPath: path.join(root, 'app-data'),
    resourcePath: path.join(root, 'bundled'),
    runner: async () => result('', 'network failed', 1),
  });

  try {
    await assert.rejects(
      () => service.updateYtDlp(),
      (error: unknown) => (error as { code?: string }).code === 'TOOL_UPDATE_FAILED',
    );
    const destination = path.join(root, 'app-data', 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(binary, 'utf8'), 'bundled');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an update when the upstream updater reports skipped verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-tool-update-'));
  const binary = path.join(root, 'bundled', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'bundled');
  const service = new ToolUpdateService({
    binary,
    appDataPath: path.join(root, 'app-data'),
    resourcePath: path.join(root, 'bundled'),
    runner: async () => result('WARNING: hash not found, skipping verification'),
  });

  try {
    await assert.rejects(
      () => service.updateYtDlp(),
      (error: unknown) => (error as { code?: string }).code === 'TOOL_UPDATE_FAILED',
    );
    const destination = path.join(root, 'app-data', 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
