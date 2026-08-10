import type { ProcessResult } from '../core/process.ts';
import { runProcess } from '../core/process.ts';
import { getYtDlpRuntimeArgs } from '../core/yt-dlp-runtime.ts';
import { translateCookieError } from '../core/yt-dlp-errors.ts';
import { AppError } from '../types/errors.ts';
import type { BrowserCookieName } from '../types/auth.ts';

export const OFFICIAL_COOKIE_TEST_VIDEO = 'https://www.youtube.com/watch?v=YE7VzlLtp-4';

type ProcessRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number },
) => Promise<ProcessResult>;

export interface BrowserCookieSnapshotExportOptions {
  binary: string;
  browser: BrowserCookieName;
  outputPath: string;
  denoBinary?: string;
  proxyUrl?: string;
  run?: ProcessRunner;
}

export function buildBrowserCookieSnapshotArgs(
  browser: BrowserCookieName,
  outputPath: string,
  denoBinary?: string,
  proxyUrl?: string,
): string[] {
  const args = [
    '--cookies-from-browser', browser,
    '--cookies', outputPath,
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    ...getYtDlpRuntimeArgs(denoBinary),
  ];
  if (proxyUrl?.trim()) args.push('--proxy', proxyUrl.trim());
  args.push(OFFICIAL_COOKIE_TEST_VIDEO);
  return args;
}

export async function exportBrowserCookieSnapshot(
  options: BrowserCookieSnapshotExportOptions,
): Promise<void> {
  const runner = options.run ?? runProcess;
  const args = buildBrowserCookieSnapshotArgs(
    options.browser,
    options.outputPath,
    options.denoBinary,
    options.proxyUrl,
  );
  const result = await runner(options.binary, args, {
    timeoutMs: 120_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  if (result.exitCode === 0) return;

  const translated = translateCookieError(result.stderr);
  if (translated) throw translated;
  throw new AppError(
    'COOKIE_ERROR',
    'Chrome Cookie 快照导入失败；请完全关闭 Chrome 后重试',
  );
}

export async function detectBrowserRunning(
  browser: BrowserCookieName,
  runner: ProcessRunner = runProcess,
): Promise<boolean | undefined> {
  if (process.platform !== 'win32') return undefined;
  const executable = browserExecutable(browser);
  if (!executable) return undefined;
  try {
    const result = await runner('tasklist.exe', ['/FI', `IMAGENAME eq ${executable}`, '/FO', 'CSV', '/NH'], {
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    });
    return result.exitCode === 0 && result.stdout.toLowerCase().includes(`"${executable.toLowerCase()}"`);
  } catch {
    return undefined;
  }
}

function browserExecutable(browser: BrowserCookieName): string | undefined {
  switch (browser) {
    case 'chrome': return 'chrome.exe';
    case 'edge': return 'msedge.exe';
    case 'firefox': return 'firefox.exe';
    case 'brave': return 'brave.exe';
    default: return undefined;
  }
}
