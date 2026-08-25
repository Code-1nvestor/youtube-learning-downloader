import assert from 'node:assert/strict';
import test from 'node:test';
import type { YtDlpService } from '../server/core/yt-dlp.service.ts';
import { ConnectivityService } from '../server/services/connectivity.service.ts';
import type { CookieService } from '../server/services/cookie.service.ts';
import type { SettingsService } from '../server/services/settings.service.ts';
import { AppError } from '../server/types/errors.ts';
import type { CookieStatus } from '../server/types/auth.ts';

function createService(
  resolve: YtDlpService['resolve'],
  proxyUrl = '',
  cookieStatus: CookieStatus = { configured: false, source: 'none', validity: 'not_imported' },
) {
  const ytDlp = { resolve } as YtDlpService;
  const settings = { getSettings: () => ({ proxyUrl }) } as unknown as SettingsService;
  const cookie = {
    getStatus: () => cookieStatus,
    recordVerification: () => {},
  } as unknown as CookieService;
  return new ConnectivityService(ytDlp, settings, cookie);
}

test('reports a successful YouTube parse without downloading media', async () => {
  let received = '';
  let receivedAuthentication = '';
  const service = createService(async (url, authentication) => {
    received = url;
    receivedAuthentication = authentication ?? '';
    return { kind: 'video', title: 'yt-dlp test video', videos: [] };
  }, 'http://127.0.0.1:7890', {
    configured: true,
    source: 'browser',
    browser: 'edge',
    validity: 'not_imported',
  });

  const status = await service.testYouTube();
  assert.match(received, /youtube\.com\/watch/);
  assert.equal(receivedAuthentication, 'cookie');
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

test('explains how to refresh a configured Cookie that still fails verification', async () => {
  const failingResolve = async () => {
    throw new AppError('RATE_LIMITED', 'fixture RATE_LIMITED');
  };

  const browserStatus = await createService(failingResolve, '', {
    configured: true,
    source: 'browser',
    browser: 'edge',
    validity: 'not_imported',
  }).testYouTube();
  assert.match(browserStatus.recommendation ?? '', /关闭.*浏览器/);
  assert.equal(browserStatus.cookieConfigured, true);

  const fileStatus = await createService(failingResolve, '', {
    configured: true,
    source: 'file',
    fileName: 'cookies.txt',
    validity: 'not_imported',
  }).testYouTube();
  assert.match(fileStatus.recommendation ?? '', /重新登录.*导出最新 Cookie/);
  assert.equal(fileStatus.cookieConfigured, true);
});

test('keeps Cookie extraction failures actionable in connectivity diagnostics', async () => {
  const service = createService(async () => {
    throw new AppError('COOKIE_ERROR', '无法复制浏览器 Cookie 数据库');
  }, '', {
    configured: true,
    source: 'browser',
    browser: 'edge',
    validity: 'not_imported',
  });

  const status = await service.testYouTube();
  assert.equal(status.code, 'COOKIE_ERROR');
  assert.match(status.recommendation ?? '', /关闭.*浏览器|Firefox/);
});

test('routes snapshot rejection to the one-time Chrome refresh action', async () => {
  const service = createService(async () => {
    throw new AppError('RATE_LIMITED', 'verification required');
  }, '', {
    configured: true,
    source: 'snapshot',
    browser: 'chrome',
    validity: 'verification_failed',
  });
  const result = await service.testYouTube();
  assert.equal(result.ok, false);
  assert.match(result.recommendation ?? '', /关闭 Chrome.*刷新快照/);
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
