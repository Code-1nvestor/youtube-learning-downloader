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
  const processName = browserProcessName(browser);
  if (!processName) return undefined;
  try {
    const result = await runner('powershell.exe', buildBrowserProcessSnapshotArgs(processName), {
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    });
    if (result.exitCode !== 0) return undefined;
    return parseBrowserProcessSnapshot(result.stdout);
  } catch {
    return undefined;
  }
}

export function buildBrowserProcessSnapshotArgs(processName: string): string[] {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$items = @(Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | ForEach-Object {`,
    '  $hasExited = $false',
    '  try { $hasExited = $_.HasExited } catch {}',
    '  $commandLine = $null',
    '  try { $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop).CommandLine } catch {}',
    '  [PSCustomObject]@{ processId = $_.Id; hasExited = $hasExited; commandLine = $commandLine }',
    '})',
    'ConvertTo-Json -Compress -InputObject $items',
  ].join('; ');
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
}

export function parseBrowserProcessSnapshot(output: string): boolean | undefined {
  const trimmed = output.trim();
  if (!trimmed) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  for (const item of parsed) {
    if (!item || typeof item !== 'object') return undefined;
    const processInfo = item as { hasExited?: unknown; commandLine?: unknown };
    if (processInfo.hasExited === true) continue;
    if (
      typeof processInfo.commandLine === 'string'
      && /(?:^|\s)"?--type=crashpad-handler"?(?:\s|$)/i.test(processInfo.commandLine)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function browserProcessName(browser: BrowserCookieName): string | undefined {
  switch (browser) {
    case 'chrome': return 'chrome';
    case 'edge': return 'msedge';
    case 'firefox': return 'firefox';
    case 'brave': return 'brave';
    default: return undefined;
  }
}
