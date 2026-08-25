import assert from 'node:assert/strict';
import test from 'node:test';
import { YtDlpService } from '../server/core/yt-dlp.service.ts';
import type { ProcessResult } from '../server/core/process.ts';

const VIDEO_URL = 'https://www.youtube.com/watch?v=BaW_jenozKc';

function result(stdout: string, stderr = '', exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 1 };
}

function videoJson(formatId: string, height: number): string {
  return JSON.stringify({
    id: 'BaW_jenozKc',
    title: 'test',
    formats: [{
      format_id: formatId,
      ext: 'webm',
      width: 3840,
      height,
      vcodec: 'vp9',
      acodec: 'none',
    }],
  });
}

test('resolves public video anonymously and never injects configured Cookie', async () => {
  const calls: string[][] = [];
  const service = new YtDlpService({
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\youtube-auth.txt' }),
    runProcess: async (_command, args) => {
      calls.push(args);
      return result(videoJson('401', 2160));
    },
  });

  const resolved = await service.resolve(VIDEO_URL);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.includes('--cookies'), false);
  assert.equal(resolved.videos[0]?.authentication, 'anonymous');
  assert.equal(resolved.videos[0]?.accessMode, 'direct');
  assert.equal(resolved.videos[0]?.formats[0]?.formatId, '401');
  assert.equal(resolved.videos[0]?.formats[0]?.resolution, '3840x2160');
});

test('uses anonymous mweb PO Token profile and reports the locked access mode', async () => {
  const calls: string[][] = [];
  const service = new YtDlpService({
    denoBinary: 'C:\\Tools\\deno.exe',
    getYoutubeRuntimeConfig: () => ({
      denoBinary: 'C:\\Tools\\deno.exe',
      poTokenProvider: {
        pluginPath: 'C:\\Components\\provider',
        baseUrl: 'http://127.0.0.1:4416',
        version: '1.3.2',
      },
    }),
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\youtube-auth.txt' }),
    runProcess: async (_command, args) => {
      calls.push(args);
      return result(videoJson('401', 2160));
    },
  });

  const resolved = await service.resolve(VIDEO_URL);
  const args = calls[0] ?? [];
  assert.equal(args.includes('--cookies'), false);
  assert.deepEqual(args.slice(args.indexOf('--plugin-dirs'), args.indexOf('--plugin-dirs') + 2), [
    '--plugin-dirs',
    'C:\\Components\\provider',
  ]);
  assert.ok(args.includes('youtube:player_client=mweb'));
  assert.ok(args.includes('youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416'));
  assert.equal(resolved.videos[0]?.accessMode, 'pot');
});

test('uses Cookie only after anonymous bot verification fails', async () => {
  const calls: string[][] = [];
  const service = new YtDlpService({
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\youtube-auth.txt' }),
    runProcess: async (_command, args) => {
      calls.push(args);
      if (calls.length === 1) {
        return result('', 'Sign in to confirm you are not a bot', 1);
      }
      return result(videoJson('96', 1080));
    },
  });

  const resolved = await service.resolve(VIDEO_URL);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.includes('--cookies'), false);
  assert.deepEqual(calls[1]?.slice(-3), [
    '--cookies',
    'C:\\Data\\youtube-auth.txt',
    VIDEO_URL,
  ]);
  assert.equal(resolved.videos[0]?.authentication, 'cookie');
  assert.equal(resolved.videos[0]?.formats[0]?.formatId, '96');
});

test('allows the Cookie connectivity check to explicitly verify configured credentials', async () => {
  const calls: string[][] = [];
  const service = new YtDlpService({
    getCookieArg: () => ({ flag: '--cookies', value: 'C:\\Data\\youtube-auth.txt' }),
    runProcess: async (_command, args) => {
      calls.push(args);
      return result(videoJson('96', 1080));
    },
  });

  const resolved = await service.resolve(VIDEO_URL, 'cookie');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.includes('--cookies'), true);
  assert.equal(resolved.videos[0]?.authentication, 'cookie');
});
