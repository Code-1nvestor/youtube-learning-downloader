import type { CookieArg } from '../types/auth.ts';

/**
 * 构建所有 yt-dlp 调用共用的网络参数。
 * 每次执行时动态读取设置，因此修改代理或 Cookie 后无需重启应用。
 */
export function getYtDlpNetworkArgs(
  getProxyUrl?: () => string | undefined,
  getCookieArg?: () => CookieArg | undefined,
): string[] {
  const args: string[] = [];
  const proxyUrl = getProxyUrl?.()?.trim();
  if (proxyUrl) args.push('--proxy', proxyUrl);

  const cookieArg = getCookieArg?.();
  if (cookieArg) args.push(cookieArg.flag, cookieArg.value);
  return args;
}

/** 把网络参数插到最后一个 URL 参数之前。 */
export function injectYtDlpNetworkArgs(
  args: string[],
  getProxyUrl?: () => string | undefined,
  getCookieArg?: () => CookieArg | undefined,
): string[] {
  const networkArgs = getYtDlpNetworkArgs(getProxyUrl, getCookieArg);
  if (networkArgs.length === 0) return args;
  if (args.length === 0) return networkArgs;
  return [...args.slice(0, -1), ...networkArgs, args[args.length - 1]!];
}
