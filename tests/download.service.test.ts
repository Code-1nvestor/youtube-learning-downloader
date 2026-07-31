import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRequiredDiskBytes, DownloadService } from '../server/services/download.service.ts';
import { AppError } from '../server/types/errors.ts';
import type { DownloadTask } from '../server/types/download.ts';

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
    ffmpegBinary: 'C:\\Tools\\ffmpeg.exe',
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\cookies.txt' }),
  });

  const args = service.buildDownloadArgs(createTask({
    subtitleLangs: ['zh-Hans', 'en'],
    subtitleMode: 'separate',
    autoSubtitle: true,
  }));

  assert.deepEqual(args.slice(0, 4), [
    '-f',
    'bestvideo+bestaudio/best',
    '-o',
    'C:\\Downloads\\test.mp4',
  ]);
  assert.ok(args.includes('--ffmpeg-location'));
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args.includes('--write-subs'));
  assert.ok(args.includes('--write-auto-subs'));
  assert.ok(args.includes('--convert-subs'));
  assert.deepEqual(args.slice(-3), [
    '--cookies',
    'C:\\Data\\cookies.txt',
    'https://www.youtube.com/watch?v=BaW_jenozKc',
  ]);
});

test('blocks a download before launch when disk space is insufficient', () => {
  const estimatedBytes = 400 * 1024 * 1024;
  const service = new DownloadService({
    binary: 'yt-dlp',
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
    getAvailableDiskBytes: () => 2 * 1024 * 1024 * 1024,
  });
  const unknown = new DownloadService({
    binary: 'yt-dlp',
    getAvailableDiskBytes: () => null,
  });

  assert.doesNotThrow(() => sufficient.checkDiskSpace(createTask({ estimatedBytes: 400 * 1024 * 1024 })));
  assert.doesNotThrow(() => unknown.checkDiskSpace(createTask()));
});

test('extracts real MP3 and M4A audio instead of only changing the file extension', () => {
  const service = new DownloadService({ binary: 'yt-dlp' });

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

test('parses JSON progress output and ignores unrelated or malformed lines', () => {
  const service = new DownloadService({ binary: 'yt-dlp' });
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
