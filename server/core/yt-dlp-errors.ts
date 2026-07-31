/**
 * core/yt-dlp-errors.ts - yt-dlp stderr -> AppError 统一翻译
 *
 * yt-dlp.service.ts 和 download.service.ts 都需要把 yt-dlp 的
 * stderr 文本翻译成结构化 AppError。此模块集中维护映射规则，
 * YouTube 侧文案变化时只需改这一处。
 *
 * 维护说明：模式串来自 yt-dlp 实际输出，YouTube 侧文案变化时需同步更新。
 */

import { AppError } from '../types/errors.ts';
import { tail } from './utils.ts';

/**
 * 将 yt-dlp stderr 翻译为对应的 AppError。
 *
 * @param stderr yt-dlp 进程的 stderr 输出
 * @param context 错误上下文描述（如 "解析视频失败"），用于兜底错误消息
 * @returns 匹配到的 AppError 实例
 */
export function translateYtDlpError(stderr: string, context: string): AppError {
  const text = stderr.toLowerCase();

  if (text.includes('video unavailable') || text.includes('private video')) {
    return new AppError('VIDEO_UNAVAILABLE', '视频不可用（已删除/私有/地区限制）', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('the playlist does not exist') || (text.includes('playlist') && text.includes('unavailable'))) {
    return new AppError('PLAYLIST_UNAVAILABLE', '播放列表不存在或无访问权限', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('http error 429') || text.includes('too many requests')) {
    return new AppError('RATE_LIMITED', '请求过于频繁，触发了 YouTube 风控，请稍后重试或配置 Cookie', {
      stderr: tail(stderr),
    });
  }
  // YouTube 机器人验证：需要浏览器 Cookie 证明非机器人
  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return new AppError('RATE_LIMITED', 'YouTube 要求进行人机验证，请在设置页面配置浏览器 Cookie 后重试', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('no space left')) {
    return new AppError('DISK_FULL', '磁盘空间不足', {
      stderr: tail(stderr),
    });
  }
  if (
    text.includes('name or service not known') ||
    text.includes('temporary failure in name resolution') ||
    text.includes('timed out') ||
    text.includes('unable to download')
  ) {
    return new AppError('NETWORK_ERROR', '网络连接失败（请检查代理设置）', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('subtitles') && text.includes('not available')) {
    return new AppError('NOT_FOUND', '该视频没有指定语言的字幕', {
      stderr: tail(stderr),
    });
  }

  // 兜底：保留 stderr 尾部便于排查
  return new AppError('UNKNOWN', `${context}: yt-dlp 返回了未识别的错误`, {
    stderr: tail(stderr),
  });
}

/**
 * 下载场景的错误翻译（与通用翻译的区别：下载失败时有专门的 DOWNLOAD_FAILED 兜底）。
 *
 * @param stderr yt-dlp 进程的 stderr 输出
 * @param title 视频标题，用于错误消息
 * @returns 匹配到的 AppError 实例
 */
export function translateDownloadError(stderr: string, title: string): AppError {
  const text = stderr.toLowerCase();

  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return new AppError('RATE_LIMITED', 'YouTube 要求人机验证，请配置 Cookie 后重试', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('video unavailable') || text.includes('private video')) {
    return new AppError('VIDEO_UNAVAILABLE', `视频不可用: ${title}`, {
      stderr: tail(stderr),
    });
  }
  if (text.includes('http error 429') || text.includes('too many requests')) {
    return new AppError('RATE_LIMITED', '请求频率过高，请稍后重试', {
      stderr: tail(stderr),
    });
  }
  if (text.includes('no space left')) {
    return new AppError('DISK_FULL', '磁盘空间不足', {
      stderr: tail(stderr),
    });
  }

  return new AppError('DOWNLOAD_FAILED', `下载失败: ${title}`, {
    stderr: tail(stderr),
  });
}
