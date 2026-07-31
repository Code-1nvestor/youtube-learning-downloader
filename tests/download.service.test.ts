import assert from 'node:assert/strict';
import test from 'node:test';
import { DownloadService } from '../server/services/download.service.ts';
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
  assert.ok(args.includes('--write-subs'));
  assert.ok(args.includes('--write-auto-subs'));
  assert.ok(args.includes('--convert-subs'));
  assert.deepEqual(args.slice(-3), [
    '--cookies',
    'C:\\Data\\cookies.txt',
    'https://www.youtube.com/watch?v=BaW_jenozKc',
  ]);
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
