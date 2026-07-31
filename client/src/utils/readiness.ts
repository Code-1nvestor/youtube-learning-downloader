import type { SettingsTarget } from '../store';

/** 将连接诊断错误映射到用户下一步应打开的设置区域。 */
export function connectivitySettingsTarget(code: string): SettingsTarget {
  switch (code) {
    case 'RATE_LIMITED':
      return 'cookie';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'network';
    case 'YT_DLP_OUTDATED':
      return 'update';
    case 'YT_DLP_MISSING':
    case 'FFMPEG_MISSING':
      return 'runtime';
    default:
      return 'diagnostics';
  }
}
