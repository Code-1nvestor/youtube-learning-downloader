import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildChromeExportArgs,
  buildChromeLoginArgs,
  createYouTubeAuthController,
  findChromeExecutable,
  isYouTubeDomain,
  parseDevToolsActivePort,
  serializeYouTubeCookies,
} = require('../desktop/youtube-auth.cjs') as {
  buildChromeExportArgs: (profileDir: string) => string[];
  buildChromeLoginArgs: (profileDir: string) => string[];
  createYouTubeAuthController: (options: Record<string, unknown>) => {
    start: () => Promise<{ started: boolean; reused: boolean }>;
    exportCookies: () => Promise<string>;
    close: () => Promise<void>;
    isRunning: () => boolean;
  };
  findChromeExecutable: (options: { env: NodeJS.ProcessEnv; existsSync: (file: string) => boolean }) => string | undefined;
  isYouTubeDomain: (domain: string) => boolean;
  parseDevToolsActivePort: (content: string) => string;
  serializeYouTubeCookies: (cookies: unknown[]) => string;
};

test('keeps the visible login browser free of debugging flags', () => {
  const loginArgs = buildChromeLoginArgs('C:\\AppData\\youtube-auth-profile');
  assert.ok(loginArgs.includes('--user-data-dir=C:\\AppData\\youtube-auth-profile'));
  assert.ok(loginArgs.includes('https://www.youtube.com/'));
  assert.ok(!loginArgs.some((arg) => arg.startsWith('--remote-debugging')));
  assert.ok(!loginArgs.some((arg) => arg.startsWith('--headless')));

  const exportArgs = buildChromeExportArgs('C:\\AppData\\youtube-auth-profile');
  assert.ok(exportArgs.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(exportArgs.includes('--remote-debugging-port=0'));
  assert.ok(exportArgs.includes('--headless=new'));
  assert.ok(!exportArgs.includes('https://www.youtube.com/'));
});

test('exports only after the ordinary login window closes', async () => {
  const launches: { args: string[]; options: { windowsHide: boolean } }[] = [];
  const children: Array<{ exitCode: number | null; once: () => void; kill: () => void }> = [];
  const commands: string[] = [];
  const controller = createYouTubeAuthController({
    profileDir: 'C:\\AppData\\youtube-auth-profile',
    chromeExecutable: 'C:\\Chrome\\chrome.exe',
    fsImpl: {
      mkdirSync: () => {},
      rmSync: () => {},
    },
    spawnProcess: (_executable: string, args: string[], options: { windowsHide: boolean }) => {
      launches.push({ args, options });
      const child = { exitCode: null, once: () => {}, kill: () => { child.exitCode = 0; } };
      children.push(child);
      return child;
    },
    waitForDevToolsPort: async () => 'ws://127.0.0.1:49152/devtools/browser/test',
    cdpCommand: async (_url: string, method: string) => {
      commands.push(method);
      return method === 'Storage.getCookies'
        ? { cookies: [{ domain: '.youtube.com', path: '/', secure: true, expires: 2_000_000_000, name: 'SAPISID', value: 'secret' }] }
        : {};
    },
  });

  await controller.start();
  assert.equal(launches.length, 1);
  assert.equal(launches[0]?.options.windowsHide, false);
  assert.ok(!launches[0]?.args.some((arg) => arg.startsWith('--remote-debugging')));
  await assert.rejects(controller.exportCookies(), /请先关闭专用 Chrome/);

  const loginChild = children[0];
  assert.ok(loginChild);
  loginChild.exitCode = 0;
  const content = await controller.exportCookies();
  assert.match(content, /SAPISID\tsecret/);
  assert.equal(launches.length, 2);
  assert.equal(launches[1]?.options.windowsHide, true);
  assert.ok(launches[1]?.args.includes('--headless=new'));
  assert.deepEqual(commands, ['Storage.getCookies', 'Browser.close']);
  assert.equal(controller.isRunning(), false);
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
