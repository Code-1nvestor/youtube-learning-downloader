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
  assert.equal(translateDownloadError('unexpected extractor failure', '课程').code, 'DOWNLOAD_FAILED');
});
