import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calculateRequiredDiskBytes, DownloadService } from '../server/services/download.service.ts';
import { AppError } from '../server/types/errors.ts';
import type { DownloadTask } from '../server/types/download.ts';

const TEST_TEMP_ROOT = path.join(os.tmpdir(), 'yld-download-service-tests');

function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'task-1',
    videoId: 'BaW_jenozKc',
    title: 'yt-dlp test video',
    formatId: 'bestvideo+bestaudio/best',
    container: 'mp4',
    outputPath: 'C:\\Downloads\\test.mp4',
    subtitleLangs: [],
    subtitleMode: 'none',
    autoSubtitle: false,
    status: 'queued',
    progress: 0,
    speed: '',
    eta: '',
    downloadedBytes: 0,
    totalBytes: 0,
    estimatedBytes: 0,
    retryCount: 0,
    maxRetries: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('builds download arguments with ffmpeg, subtitles, cookies, and a safe video URL', () => {
  const service = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    ffmpegBinary: 'C:\\Tools\\ffmpeg.exe',
    denoBinary: 'C:\\Tools\\deno.exe',
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\cookies.txt' }),
    getProxyUrl: () => 'http://127.0.0.1:7890',
  });

  const args = service.buildDownloadArgs(createTask({
    subtitleLangs: ['zh-Hans', 'en'],
    subtitleMode: 'separate',
    autoSubtitle: true,
  }));

  assert.deepEqual(args.slice(0, 8), [
    '-f',
    'bestvideo+bestaudio/best',
    '--paths',
    'home:C:\\Downloads',
    '--paths',
    `temp:${path.join(TEST_TEMP_ROOT, 'task-1')}`,
    '-o',
    'test.mp4',
  ]);
  assert.ok(args.includes('--ffmpeg-location'));
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args.includes('--write-subs'));
  assert.ok(args.includes('--write-auto-subs'));
  assert.ok(args.includes('--convert-subs'));
  assert.deepEqual(args.slice(args.indexOf('--js-runtimes'), args.indexOf('--js-runtimes') + 2), [
    '--js-runtimes',
    'deno:C:\\Tools\\deno.exe',
  ]);
  assert.deepEqual(args.slice(-5), [
    '--proxy',
    'http://127.0.0.1:7890',
    '--cookies',
    'C:\\Data\\cookies.txt',
    'https://www.youtube.com/watch?v=BaW_jenozKc',
  ]);
});

test('adds gentle download limits only while gentle mode is enabled', () => {
  const gentleSettings = {
    gentleMode: true,
    gentleRateLimitMbps: 3,
    gentleCooldownSeconds: 30,
    gentleBatchLimit: 20,
  };
  const gentle = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    getGentleSettings: () => gentleSettings,
  });
  const gentleArgs = gentle.buildDownloadArgs(createTask());
  assert.deepEqual(gentleArgs.slice(gentleArgs.indexOf('--limit-rate'), gentleArgs.indexOf('--limit-rate') + 6), [
    '--limit-rate',
    '3M',
    '--concurrent-fragments',
    '1',
    '--sleep-requests',
    '1',
  ]);
  assert.equal(gentleArgs.includes('--limit-rate'), true);
  assert.equal(gentleArgs.includes('--concurrent-fragments'), true);
  assert.equal(gentleArgs.includes('--sleep-requests'), true);

  const normal = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    getGentleSettings: () => ({ ...gentleSettings, gentleMode: false }),
  });
  const normalArgs = normal.buildDownloadArgs(createTask());
  assert.equal(normalArgs.includes('--limit-rate'), false);
  assert.equal(normalArgs.includes('--concurrent-fragments'), false);
  assert.equal(normalArgs.includes('--sleep-requests'), false);
});

test('blocks a download before launch when disk space is insufficient', () => {
  const estimatedBytes = 400 * 1024 * 1024;
  const service = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    getAvailableDiskBytes: () => 100 * 1024 * 1024,
  });

  assert.throws(
    () => service.checkDiskSpace(createTask({ estimatedBytes })),
    (error: unknown) => error instanceof AppError && error.code === 'DISK_FULL',
  );
  assert.equal(calculateRequiredDiskBytes(0), 256 * 1024 * 1024);
});

test('allows a download when disk space is sufficient or cannot be read', () => {
  const sufficient = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    getAvailableDiskBytes: () => 2 * 1024 * 1024 * 1024,
  });
  const unknown = new DownloadService({
    binary: 'yt-dlp',
    tempRootPath: TEST_TEMP_ROOT,
    getAvailableDiskBytes: () => null,
  });

  assert.doesNotThrow(() => sufficient.checkDiskSpace(createTask({ estimatedBytes: 400 * 1024 * 1024 })));
  assert.doesNotThrow(() => unknown.checkDiskSpace(createTask()));
});

test('extracts real MP3 and M4A audio instead of only changing the file extension', () => {
  const service = new DownloadService({ binary: 'yt-dlp', tempRootPath: TEST_TEMP_ROOT });

  for (const container of ['mp3', 'm4a']) {
    const args = service.buildDownloadArgs(createTask({
      container,
      outputPath: `C:\\Downloads\\audio.${container}`,
      formatId: 'bestaudio/best',
    }));
    const extractIndex = args.indexOf('--extract-audio');
    assert.ok(extractIndex >= 0);
    assert.deepEqual(args.slice(extractIndex, extractIndex + 3), [
      '--extract-audio',
      '--audio-format',
      container,
    ]);
    assert.equal(args.includes('--merge-output-format'), false);
  }
});

test('rejects embedded subtitles for audio-only output before launching yt-dlp', () => {
  const service = new DownloadService({ binary: 'yt-dlp', tempRootPath: TEST_TEMP_ROOT });

  for (const subtitleLangs of [['en'], []]) {
    assert.throws(
      () => service.buildDownloadArgs(createTask({
        container: 'mp3',
        outputPath: 'C:\\Downloads\\audio.mp3',
        formatId: 'bestaudio/best',
        subtitleLangs,
        subtitleMode: 'embed',
      })),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_PARAM',
    );
  }
});

test('parses JSON progress output and ignores unrelated or malformed lines', () => {
  const service = new DownloadService({ binary: 'yt-dlp', tempRootPath: TEST_TEMP_ROOT });
  const parsed = service.parseProgress(
    '[download] {"percent":" 42.3%","speed":" 2.34MiB/s","eta":" 00:41","downloaded_bytes":52000000,"total_bytes":123456789}',
  );

  assert.deepEqual(parsed, {
    percent: 42.3,
    totalSize: 123456789,
    totalSizeUnit: '117.7MiB',
    speed: 2.34,
    speedUnit: 'MiB/s',
    eta: '00:41',
  });
  assert.equal(service.parseProgress('[download] 42.3%'), null);
  assert.equal(service.parseProgress('{not-json}'), null);
});

test('isolates and removes only one cancelled task artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-artifacts-'));
  const tempRootPath = path.join(root, 'download-cache');
  const outputPath = path.join(root, 'downloads', 'lesson.mp4');
  const service = new DownloadService({ binary: 'yt-dlp', tempRootPath });
  const task = createTask({ id: 'safe-task-1', outputPath });
  const siblingTask = createTask({ id: 'safe-task-2', outputPath: path.join(root, 'downloads', 'other.mp4') });

  try {
    fs.mkdirSync(service.getTaskTempPath(task), { recursive: true });
    fs.mkdirSync(service.getTaskTempPath(siblingTask), { recursive: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(path.join(service.getTaskTempPath(task), 'video.part'), 'partial');
    fs.writeFileSync(path.join(service.getTaskTempPath(siblingTask), 'keep.part'), 'keep');
    fs.writeFileSync(outputPath, 'cancelled output');

    service.discardTaskArtifacts(task);

    assert.equal(fs.existsSync(service.getTaskTempPath(task)), false);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.existsSync(path.join(service.getTaskTempPath(siblingTask), 'keep.part')), true);
    assert.throws(
      () => service.getTaskTempPath(createTask({ id: '../outside' })),
      (error: unknown) => error instanceof AppError && error.code === 'PATH_NOT_ALLOWED',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
