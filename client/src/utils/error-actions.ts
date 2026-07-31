export interface ErrorGuidance {
  guidance: string;
  settingsLabel?: string;
  settingsTarget?: 'download' | 'runtime' | 'update' | 'diagnostics' | 'cookie';
}

export function getErrorGuidance(code: string): ErrorGuidance {
  const actions: Record<string, ErrorGuidance> = {
    RATE_LIMITED: { guidance: 'YouTube 需要确认是本人访问。配置浏览器 Cookie 后再重试。', settingsLabel: '去配置 Cookie', settingsTarget: 'cookie' },
    YT_DLP_MISSING: { guidance: '下载核心不可用，请在设置页查看运行环境。', settingsLabel: '检查运行环境', settingsTarget: 'runtime' },
    YT_DLP_OUTDATED: { guidance: '下载核心版本过旧，请先更新 yt-dlp。', settingsLabel: '去更新', settingsTarget: 'update' },
    FFMPEG_MISSING: { guidance: '缺少音视频合并工具，请在设置页查看运行环境。', settingsLabel: '检查运行环境', settingsTarget: 'runtime' },
    DISK_FULL: { guidance: '请清理磁盘空间，或在设置页更换下载目录。', settingsLabel: '更换下载目录', settingsTarget: 'download' },
    PATH_NOT_ALLOWED: { guidance: '当前下载目录或命名规则不可用，请修改下载设置。', settingsLabel: '修改下载设置', settingsTarget: 'download' },
    UNKNOWN: { guidance: '可在设置页打开日志目录，帮助定位原因。', settingsLabel: '打开诊断设置', settingsTarget: 'diagnostics' },
    DOWNLOAD_FAILED: { guidance: '可在设置页打开日志目录，帮助定位原因。', settingsLabel: '查看诊断', settingsTarget: 'diagnostics' },
  };
  if (actions[code]) return actions[code];
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    return { guidance: '请检查网络、代理或防火墙，然后重试。' };
  }
  return { guidance: '请稍后重试；持续失败时可在设置页查看日志。' };
}
