import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildChromeAuthArgs,
  findChromeExecutable,
  isYouTubeDomain,
  parseDevToolsActivePort,
  serializeYouTubeCookies,
} = require('../desktop/youtube-auth.cjs') as {
  buildChromeAuthArgs: (profileDir: string) => string[];
  findChromeExecutable: (options: { env: NodeJS.ProcessEnv; existsSync: (file: string) => boolean }) => string | undefined;
  isYouTubeDomain: (domain: string) => boolean;
  parseDevToolsActivePort: (content: string) => string;
  serializeYouTubeCookies: (cookies: unknown[]) => string;
};

test('launches Chrome with a dedicated profile and loopback-only debugging', () => {
  const args = buildChromeAuthArgs('C:\\AppData\\youtube-auth-profile');
  assert.ok(args.includes('--user-data-dir=C:\\AppData\\youtube-auth-profile'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(args.includes('https://www.youtube.com/'));
  assert.ok(!args.some((arg) => arg.includes('Default')));
});

test('finds Chrome without inspecting the daily browser profile', () => {
  const found = findChromeExecutable({
    env: { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    existsSync: (file) => file === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  assert.equal(found, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
});

test('parses only a valid loopback DevTools endpoint', () => {
  assert.equal(
    parseDevToolsActivePort('49152\n/devtools/browser/test-id\n'),
    'ws://127.0.0.1:49152/devtools/browser/test-id',
  );
  assert.throws(() => parseDevToolsActivePort('not-a-port\n/devtools/browser/test'), /端口信息无效/);
});

test('exports only YouTube cookies in Netscape format and requires a login cookie', () => {
  assert.equal(isYouTubeDomain('.youtube.com'), true);
  assert.equal(isYouTubeDomain('music.youtube.com'), true);
  assert.equal(isYouTubeDomain('.google.com'), false);

  const content = serializeYouTubeCookies([
    { domain: '.youtube.com', path: '/', secure: true, expires: 2_000_000_000, name: 'SAPISID', value: 'secret', httpOnly: true },
    { domain: '.youtube.com', path: '/', secure: true, expires: -1, name: 'PREF', value: 'language', httpOnly: false },
    { domain: '.google.com', path: '/', secure: true, expires: 2_000_000_000, name: 'SID', value: 'must-not-export', httpOnly: true },
  ]);
  assert.match(content, /#HttpOnly_\.youtube\.com\tTRUE\t\/\tTRUE\t2000000000\tSAPISID\tsecret/);
  assert.match(content, /\.youtube\.com\tTRUE\t\/\tTRUE\t0\tPREF\tlanguage/);
  assert.doesNotMatch(content, /google\.com|must-not-export/);
  assert.throws(
    () => serializeYouTubeCookies([{ domain: '.youtube.com', name: 'PREF', value: 'x' }]),
    /尚未检测到 YouTube 登录状态/,
  );
});
