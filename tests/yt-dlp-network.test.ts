import assert from 'node:assert/strict';
import test from 'node:test';
import { getYtDlpNetworkArgs, injectYtDlpNetworkArgs } from '../server/core/yt-dlp-network.ts';

test('builds proxy and Cookie arguments as separate process arguments', () => {
  assert.deepEqual(
    getYtDlpNetworkArgs(
      () => ' http://127.0.0.1:7890 ',
      () => ({ flag: '--cookies-from-browser', value: 'edge' }),
    ),
    ['--proxy', 'http://127.0.0.1:7890', '--cookies-from-browser', 'edge'],
  );
});

test('injects network arguments immediately before the target URL', () => {
  assert.deepEqual(
    injectYtDlpNetworkArgs(
      ['--dump-json', '--no-playlist', 'https://example.test/video'],
      () => 'socks5h://127.0.0.1:1080',
    ),
    ['--dump-json', '--no-playlist', '--proxy', 'socks5h://127.0.0.1:1080', 'https://example.test/video'],
  );
  assert.deepEqual(injectYtDlpNetworkArgs(['https://example.test/video']), ['https://example.test/video']);
});
