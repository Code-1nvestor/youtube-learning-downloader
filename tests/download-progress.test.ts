import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDownloadProgress } from '../server/services/download-progress.ts';

const VIDEO_JSON = JSON.stringify({
  percent: ' 42.3%',
  speed: ' 2.34MiB/s',
  eta: ' 00:41',
  downloaded_bytes: 52_000_000,
  total_bytes: 123_456_789,
  info_dict: { vcodec: 'avc1.640028', acodec: 'none', format_id: '137' },
});

test('parses the same progress line from stdout and stderr', () => {
  const stdout = parseDownloadProgress(`[download] ${VIDEO_JSON}`);
  const stderr = parseDownloadProgress(`[download] ${VIDEO_JSON}`);

  assert.deepEqual(stdout, stderr);
  assert.equal(stdout?.stage, 'downloading-video');
  assert.equal(stdout?.percent, 42.3);
  assert.equal(stdout?.downloadedBytes, 52_000_000);
  assert.equal(stdout?.totalBytes, 123_456_789);
  assert.equal(stdout?.speed, '2.34MiB/s');
  assert.equal(stdout?.eta, '00:41');
});

test('keeps unknown JSON values undefined and never substitutes a fake zero percent', () => {
  const parsed = parseDownloadProgress(JSON.stringify({
    percent: 'NA',
    speed: 'Unknown',
    eta: 'N/A',
    downloaded_bytes: 'NA',
    total_bytes: 'Unknown',
    info_dict: { vcodec: 'none', acodec: 'mp4a.40.2', format_id: '140' },
  }));

  assert.equal(parsed?.stage, 'downloading-audio');
  assert.equal(parsed?.percent, undefined);
  assert.equal(parsed?.downloadedBytes, undefined);
  assert.equal(parsed?.totalBytes, undefined);
  assert.equal(parsed?.speed, undefined);
  assert.equal(parsed?.eta, undefined);
});

test('accepts bare yt-dlp NA placeholders in numeric template fields', () => {
  const parsed = parseDownloadProgress(
    '{"percent":"NA","speed":"Unknown","eta":"NA","downloaded_bytes":NA,"total_bytes":NA}',
  );

  assert.ok(parsed);
  assert.equal(parsed.percent, undefined);
  assert.equal(parsed.downloadedBytes, undefined);
  assert.equal(parsed.totalBytes, undefined);
});

test('does not expose a numeric percent when only the total size is unknown', () => {
  const parsed = parseDownloadProgress(JSON.stringify({
    percent: '42.3%',
    downloaded_bytes: 1234,
    total_bytes: 'Unknown',
  }));

  assert.equal(parsed?.percent, undefined);
  assert.equal(parsed?.downloadedBytes, 1234);
  assert.equal(parsed?.totalBytes, undefined);
});

test('returns null for malformed JSON, metadata JSON, and unrelated warnings', () => {
  assert.equal(parseDownloadProgress('[download] {not-json}'), null);
  assert.equal(parseDownloadProgress('[download] {"percent":42%}'), null);
  assert.equal(parseDownloadProgress('{"id":"video-id","title":"lesson"}'), null);
  assert.equal(parseDownloadProgress('WARNING: throttling request'), null);
});

test('recognizes video and audio streams from info_dict codecs and format id', () => {
  const video = parseDownloadProgress(JSON.stringify({
    percent: '10%',
    downloaded_bytes: 10,
    total_bytes: 100,
    info_dict: { vcodec: 'vp9', acodec: 'none', format_id: '248' },
  }));
  const audio = parseDownloadProgress(JSON.stringify({
    percent: '10%',
    downloaded_bytes: 10,
    total_bytes: 100,
    info_dict: { vcodec: 'none', acodec: 'opus', format_id: '251' },
  }));

  assert.equal(video?.stage, 'downloading-video');
  assert.equal(audio?.stage, 'downloading-audio');
});

test('recognizes preparing, merging, post-processing, and explicit completion text', () => {
  assert.equal(parseDownloadProgress('[download] Destination: lesson.f137.mp4')?.stage, 'preparing');
  assert.equal(parseDownloadProgress('[Merger] Merging formats into "lesson.mp4"')?.stage, 'merging');
  assert.equal(parseDownloadProgress('[ExtractAudio] Destination: lesson.mp3')?.stage, 'post-processing');
  assert.equal(parseDownloadProgress('[VideoConvertor] Destination: lesson.mp4')?.stage, 'post-processing');
  assert.equal(
    parseDownloadProgress('[download] lesson.mp4 has already been downloaded')?.stage,
    'completed',
  );
});

test('recognizes conventional text progress without treating warnings as progress', () => {
  const parsed = parseDownloadProgress('[download]  42.3% of 123.4MiB at 2.34MiB/s ETA 00:41');

  assert.equal(parsed?.stage, 'downloading-video');
  assert.equal(parsed?.percent, 42.3);
  assert.equal(parsed?.totalBytes, 123.4 * 1024 * 1024);
  assert.equal(parsed?.downloadedBytes, Math.round((42.3 / 100) * 123.4 * 1024 * 1024));
  assert.equal(parsed?.speed, '2.34MiB/s');
  assert.equal(parsed?.eta, '00:41');
  assert.equal(parseDownloadProgress('[download] Downloading webpage'), null);
});
