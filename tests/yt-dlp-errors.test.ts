import assert from 'node:assert/strict';
import test from 'node:test';
import { translateDownloadError, translateYtDlpError } from '../server/core/yt-dlp-errors.ts';

test('translates common yt-dlp resolve failures into stable application error codes', () => {
  assert.equal(translateYtDlpError('ERROR: Video unavailable', '解析失败').code, 'VIDEO_UNAVAILABLE');
  assert.equal(translateYtDlpError('HTTP Error 429: Too Many Requests', '解析失败').code, 'RATE_LIMITED');
  assert.equal(translateYtDlpError('No space left on device', '解析失败').code, 'DISK_FULL');
  assert.equal(translateYtDlpError('Temporary failure in name resolution', '解析失败').code, 'NETWORK_ERROR');
});

test('uses the download-specific fallback while retaining recognized failures', () => {
  assert.equal(translateDownloadError('ERROR: private video', '课程').code, 'VIDEO_UNAVAILABLE');
  assert.equal(translateDownloadError('Temporary failure in name resolution', '课程').code, 'NETWORK_ERROR');
  assert.equal(translateDownloadError('unexpected extractor failure', '课程').code, 'DOWNLOAD_FAILED');
});

test('classifies only explicit yt-dlp Cookie failures as COOKIE_ERROR', () => {
  const cookieFailures = [
    'ERROR: Could not copy Chrome cookie database. See issue 7271',
    'ERROR: Failed to decrypt with DPAPI. See issue 10927',
    'ERROR: could not find firefox cookies database in C:/Profiles',
    "ERROR: 'cookies.txt' does not look like a Netscape format cookies file",
  ];

  for (const stderr of cookieFailures) {
    const resolved = translateYtDlpError(stderr, '解析失败');
    assert.equal(resolved.code, 'COOKIE_ERROR');
    assert.equal(resolved.statusCode, 400);
    assert.equal(translateDownloadError(stderr, '课程').code, 'COOKIE_ERROR');
  }

  assert.equal(
    translateYtDlpError('Permission denied while writing output.mp4', '解析失败').code,
    'UNKNOWN',
  );
  assert.equal(
    translateYtDlpError('failed to decrypt media manifest', '解析失败').code,
    'UNKNOWN',
  );
  assert.equal(
    translateYtDlpError('unable to download webpage', '解析失败').code,
    'NETWORK_ERROR',
  );
});
