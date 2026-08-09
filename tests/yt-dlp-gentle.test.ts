import assert from 'node:assert/strict';
import test from 'node:test';
import { YtDlpService } from '../server/core/yt-dlp.service.ts';

const settings = {
  gentleMode: true,
  gentleRateLimitMbps: 2,
  gentleCooldownSeconds: 30,
  gentleBatchLimit: 20,
};

test('adds sleep requests to resolve commands only when gentle mode is enabled', () => {
  const gentle = new YtDlpService({ getGentleSettings: () => settings });
  assert.deepEqual(
    gentle.buildResolveArgs(['--dump-json', 'https://example.test/video']),
    ['--sleep-requests', '1', '--dump-json', 'https://example.test/video'],
  );

  const normal = new YtDlpService({ getGentleSettings: () => ({ ...settings, gentleMode: false }) });
  assert.deepEqual(
    normal.buildResolveArgs(['--dump-json', 'https://example.test/video']),
    ['--dump-json', 'https://example.test/video'],
  );
});
