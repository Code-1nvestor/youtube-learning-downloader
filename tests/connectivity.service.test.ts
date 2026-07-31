import assert from 'node:assert/strict';
import test from 'node:test';
import type { YtDlpService } from '../server/core/yt-dlp.service.ts';
import { ConnectivityService } from '../server/services/connectivity.service.ts';
import type { CookieService } from '../server/services/cookie.service.ts';
import type { SettingsService } from '../server/services/settings.service.ts';
import { AppError } from '../server/types/errors.ts';

function createService(resolve: YtDlpService['resolve'], proxyUrl = '', cookieConfigured = false) {
  const ytDlp = { resolve } as YtDlpService;
  const settings = { getSettings: () => ({ proxyUrl }) } as unknown as SettingsService;
  const cookie = { getStatus: () => ({ configured: cookieConfigured }) } as unknown as CookieService;
  return new ConnectivityService(ytDlp, settings, cookie);
}

test('reports a successful YouTube parse without downloading media', async () => {
  let received = '';
  const service = createService(async (url) => {
    received = url;
    return { kind: 'video', title: 'yt-dlp test video', videos: [] };
  }, 'http://127.0.0.1:7890', true);

  const status = await service.testYouTube();
  assert.match(received, /youtube\.com\/watch/);
  assert.equal(status.ok, true);
  assert.equal(status.code, 'OK');
  assert.equal(status.proxyConfigured, true);
  assert.equal(status.cookieConfigured, true);
  assert.equal(status.videoTitle, 'yt-dlp test video');
});

test('returns actionable RATE_LIMITED and network diagnostic results', async () => {
  for (const code of ['RATE_LIMITED', 'NETWORK_ERROR'] as const) {
    const service = createService(async () => {
      throw new AppError(code, `fixture ${code}`);
    });
    const status = await service.testYouTube();
    assert.equal(status.ok, false);
    assert.equal(status.code, code);
    assert.ok(status.recommendation);
  }
});

test('rejects overlapping connection tests', async () => {
  let release!: () => void;
  const service = createService(() => new Promise((resolve) => {
    release = () => resolve({ kind: 'video', title: 'done', videos: [] });
  }));
  const first = service.testYouTube();
  await assert.rejects(() => service.testYouTube(), (error: unknown) => (
    error instanceof AppError && error.code === 'INVALID_PARAM'
  ));
  release();
  await first;
});
