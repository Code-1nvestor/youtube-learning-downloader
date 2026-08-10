import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildDiagnosticReport,
  createDiagnosticActions,
  readLogTail,
  redactDiagnosticText,
} = require('../desktop/diagnostics.cjs') as {
  buildDiagnosticReport: (input: Record<string, unknown>) => string;
  createDiagnosticActions: (input: Record<string, unknown>) => {
    saveReport: () => Promise<{ saved: boolean; path?: string }>;
  };
  readLogTail: (filePath: string, maxBytes?: number) => string;
  redactDiagnosticText: (
    input: string,
    knownPaths?: { value: string; label: string }[],
  ) => string;
};

function diagnosticApiFixture(route: string): Promise<Record<string, unknown>> {
  const responses: Record<string, Record<string, unknown>> = {
    '/api/health': {
      status: 'ok',
      runtime: {
        ytDlp: { available: true, version: '2026.07.04' },
        deno: { available: true, version: 'deno 2.9.5' },
        ffmpeg: { available: true, version: 'test-ffmpeg' },
      },
    },
    '/api/settings': {
      downloadPath: String.raw`D:\Private Downloads`,
      maxConcurrent: 2,
      maxRetries: 2,
      namingTemplate: '{title}.{ext}',
      proxyUrl: 'http://127.0.0.1:7890',
      persistent: true,
    },
    '/api/auth/cookie': {
      configured: true,
      source: 'browser',
      browser: 'edge',
    },
    '/api/runtime/yt-dlp': {
      currentVersion: '2026.07.04',
      source: 'bundled',
      updateSupported: true,
      restartRequired: false,
    },
  };
  const value = responses[route];
  if (!value) throw new Error(`Unexpected route: ${route}`);
  return Promise.resolve(value);
}

test('redacts local paths, authentication fields, Cookie rows, and signed URLs', () => {
  const input = [
    String.raw`database: C:\Users\Alice\AppData\Roaming\Learning\app.db`,
    String.raw`download: D:\Private Courses\lesson.mp4`,
    'Cookie: SID=private-cookie-value',
    'authorization="Bearer private-token"',
    String.raw`yt-dlp --cookies "C:\Users\Alice\cookies.txt" --cookies-from-browser "edge:Profile 1"`,
    'proxy=http://student:proxy-secret@127.0.0.1:7890',
    'media=https://video.example/file.mp4?sig=private-signature&expire=123',
    '.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tprivate-cookie-value',
  ].join('\n');

  const output = redactDiagnosticText(input, [
    { value: String.raw`C:\Users\Alice\AppData\Roaming\Learning`, label: '<APP_DATA>' },
    { value: String.raw`D:\Private Courses`, label: '<DOWNLOAD_DIR>' },
  ]);

  assert.match(output, /<APP_DATA>/);
  assert.match(output, /<DOWNLOAD_DIR>/);
  assert.match(output, /<COOKIE_ROW_REDACTED>/);
  assert.match(output, /<REDACTED_QUERY>/);
  for (const secret of [
    'Alice',
    'Private Courses',
    'private-cookie-value',
    'private-token',
    'Profile 1',
    'proxy-secret',
    'private-signature',
  ]) {
    assert.doesNotMatch(output, new RegExp(secret.replace(/ /g, '\\s')));
  }
});

test('builds a useful whitelist report without copying private settings', () => {
  const report = buildDiagnosticReport({
    appVersion: '0.14.0',
    generatedAt: '2026-08-01T04:00:00.000Z',
    platform: 'win32',
    arch: 'x64',
    osRelease: 'test-release',
    isPackaged: true,
    health: {
      status: 'ok',
      runtime: {
        ytDlp: { available: true, version: '2026.07.04' },
        deno: { available: true, version: 'deno 2.9.5' },
        ffmpeg: { available: true, version: 'test-ffmpeg' },
      },
    },
    settings: {
      downloadPath: String.raw`D:\Secret Course`,
      maxConcurrent: 2,
      maxRetries: 3,
      namingTemplate: 'private/{title}.{ext}',
      proxyUrl: 'http://127.0.0.1:7890',
      persistent: true,
    },
    cookie: {
      configured: true,
      source: 'file',
      fileName: 'private-cookies.txt',
    },
    update: {
      currentVersion: '2026.07.04',
      source: 'bundled',
      updateSupported: true,
      restartRequired: false,
    },
    logText: String.raw`[startup] 下载目录: D:\Secret Course`,
    redactionPaths: [
      { value: String.raw`D:\Secret Course`, label: '<DOWNLOAD_DIR>' },
    ],
  });

  assert.match(report, /版本: 0\.14\.0/);
  assert.match(report, /Deno 可用: 是/);
  assert.match(report, /Deno 版本: deno 2\.9\.5/);
  assert.match(report, /下载目录已配置: 是/);
  assert.match(report, /代理已配置: 是/);
  assert.match(report, /来源: 本机 Cookie 文件/);
  assert.match(report, /<DOWNLOAD_DIR>/);
  for (const privateValue of ['Secret Course', 'private/{title}', '127.0.0.1:7890', 'private-cookies.txt']) {
    assert.doesNotMatch(report, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('identifies a Chrome Cookie snapshot without exposing its file', () => {
  const report = buildDiagnosticReport({
    appVersion: '0.23.1',
    generatedAt: '2026-08-10T00:00:00.000Z',
    platform: 'win32',
    arch: 'x64',
    osRelease: 'test-release',
    health: {},
    settings: {},
    cookie: { configured: true, source: 'snapshot', validity: 'valid' },
    update: {},
    logText: '',
  });
  assert.match(report, /来源: Chrome Cookie 快照/);
  assert.match(report, /快照状态: valid/);
  assert.doesNotMatch(report, /chrome-snapshot\.txt/);
});

test('reads only the requested complete-line tail of a backend log', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-diagnostics-'));
  const logPath = path.join(tempDir, 'backend.log');
  fs.writeFileSync(logPath, 'old-line\nsecond-line\nnewest-line\n', 'utf8');

  try {
    const tail = readLogTail(logPath, 24);
    assert.doesNotMatch(tail, /old-line/);
    assert.match(tail, /newest-line/);
    assert.equal(readLogTail(path.join(tempDir, 'missing.log')), '');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('desktop diagnostic action saves a UTF-8 report only after confirmation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-diagnostics-save-'));
  const appData = path.join(tempDir, 'private-app-data');
  const logFile = path.join(appData, 'logs', 'backend.log');
  const outputPath = path.join(tempDir, 'diagnostic.txt');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(
    logFile,
    `${String.raw`[startup] database: ${appData}\data\app.db`}\nCookie: private-cookie-value\n`,
    'utf8',
  );
  let dialogOptions: unknown;
  const action = createDiagnosticActions({
    loadApi: diagnosticApiFixture,
    showSaveDialog: async (options: unknown) => {
      dialogOptions = options;
      return { canceled: false, filePath: outputPath };
    },
    appVersion: '0.14.0',
    platform: 'win32',
    arch: 'x64',
    osRelease: 'test-release',
    isPackaged: true,
    paths: {
      appData,
      resources: path.join(tempDir, 'resources'),
      home: tempDir,
      temp: os.tmpdir(),
      appRoot: tempDir,
      documents: tempDir,
      logFile,
    },
    now: () => new Date('2026-08-01T04:00:00.000Z'),
  });

  try {
    assert.deepEqual(await action.saveReport(), { saved: true, path: outputPath });
    const saved = fs.readFileSync(outputPath, 'utf8');
    assert.equal(saved.startsWith('\uFEFF'), true);
    assert.match(saved, /版本: 0\.14\.0/);
    assert.match(saved, /<APP_DATA>/);
    assert.doesNotMatch(saved, /private-cookie-value|private-app-data|Private Downloads|127\.0\.0\.1:7890/);
    assert.match(JSON.stringify(dialogOptions), /保存脱敏诊断报告/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('desktop diagnostic action writes nothing when the user cancels', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-diagnostics-cancel-'));
  const outputPath = path.join(tempDir, 'should-not-exist.txt');
  const action = createDiagnosticActions({
    loadApi: diagnosticApiFixture,
    showSaveDialog: async () => ({ canceled: true }),
    appVersion: '0.14.0',
    platform: 'win32',
    arch: 'x64',
    osRelease: 'test-release',
    isPackaged: true,
    paths: {
      appData: tempDir,
      resources: tempDir,
      home: tempDir,
      temp: tempDir,
      appRoot: tempDir,
      documents: tempDir,
      logFile: path.join(tempDir, 'missing.log'),
    },
    now: () => new Date('2026-08-01T04:00:00.000Z'),
  });

  try {
    assert.deepEqual(await action.saveReport(), { saved: false });
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
