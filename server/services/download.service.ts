/**
 * download.service.ts — 下载执行服务
 *
 * 职责：构建 yt-dlp 下载命令、解析实时进度、执行下载流程。
 * 不管理队列调度（由 queue.service.ts 负责），只负责"单个任务的执行"。
 *
 * 关键 yt-dlp 参数说明：
 * - --newline              每行一个进度更新（默认用 \r 覆盖，无法逐行解析）
 * - --progress-template    自定义进度输出格式（JSON，比正则解析更可靠）
 * - --continue             断点续传（恢复已下载的部分文件）
 * - --no-overwrites        不覆盖已存在的完整文件
 * - --embed-subs           将字幕嵌入视频容器
 * - --write-subs           外挂字幕文件
 * - --write-auto-subs      自动生成字幕
 *
 * 进度解析策略：
 * 使用 --progress-template 输出 JSON 格式进度，比正则解析文本更稳定。
 * 格式: {"percent":42.3,"speed":2415919,"eta":41,"total_bytes":164000000,...}
 */

import { runProcessStreaming } from '../core/process.ts';
import { translateDownloadError } from '../core/yt-dlp-errors.ts';
import type { CookieArg } from '../types/auth.ts';
import type { DownloadTask, ProgressInfo } from '../types/download.ts';

export interface DownloadCallbacks {
  /** 进度更新（每行进度输出触发一次） */
  onProgress: (info: ProgressInfo) => void;
  /** yt-dlp stderr 警告行（非致命，用于日志） */
  onWarning?: (line: string) => void;
}

export interface DownloadServiceOptions {
  /** yt-dlp 可执行文件名或路径 */
  binary: string;
  /** Cookie 参数提供者（可选，运行时动态读取） */
  getCookieArg?: () => CookieArg | undefined;
}

export class DownloadService {
  private readonly binary: string;
  private readonly getCookieArg?: () => CookieArg | undefined;

  constructor(options: DownloadServiceOptions) {
    this.binary = options.binary;
    this.getCookieArg = options.getCookieArg;
  }

  /**
   * 执行单个下载任务。
   *
   * @param task 下载任务（已包含 outputPath、formatId 等全部信息）
   * @param signal AbortSignal，外部 abort 时终止下载
   * @param callbacks 进度回调
   * @throws {AppError} DOWNLOAD_FAILED / YT_DLP_MISSING / RATE_LIMITED 等
   */
  async download(
    task: DownloadTask,
    signal: AbortSignal,
    callbacks: DownloadCallbacks,
  ): Promise<void> {
    const args = this.buildDownloadArgs(task);

    const result = await runProcessStreaming(this.binary, args, {
      signal,
      onStdoutLine: (line) => {
        const progress = this.parseProgress(line);
        if (progress) callbacks.onProgress(progress);
      },
      onStderrLine: (line) => {
        // stderr 通常是警告或错误信息
        if (line.startsWith('ERROR:')) {
          // 致命错误：交给调用方处理（通过非零退出码触发）
          return;
        }
        callbacks.onWarning?.(line);
      },
    });

    if (result.exitCode !== 0) {
      // 翻译 yt-dlp 错误（复用 yt-dlp.service.ts 的错误模式）
      throw translateDownloadError(result.stderr, task.title);
    }
  }

  // ——————————————————————————————————————————
  // 命令构建
  // ——————————————————————————————————————————

  /**
   * 构建 yt-dlp 下载命令参数。
   * 独立为公开方法便于测试和审查。
   */
  buildDownloadArgs(task: DownloadTask): string[] {
    const args: string[] = [];

    // 格式选择
    args.push('-f', task.formatId);

    // 输出路径模板
    // yt-dlp 的 -o 直接接收最终路径（已由 naming.service 计算好）
    args.push('-o', task.outputPath);

    // 进度输出：JSON 格式，每行一个更新
    // 字段：downloaded_bytes, total_bytes, speed, eta, fragment_index...
    args.push('--newline');
    args.push('--progress-template', '{"percent":"%(progress._percent_str)s","speed":"%(progress._speed_str)s","eta":"%(progress._eta_str)s","downloaded_bytes":%(progress.downloaded_bytes)s,"total_bytes":%(progress._total_bytes)s}');

    // 断点续传 + 不覆盖
    args.push('--continue');
    args.push('--no-overwrites');

    // 字幕处理
    if (task.subtitleLangs.length > 0 && task.subtitleMode !== 'none') {
      const langs = task.subtitleLangs.join(',');
      args.push('--sub-langs', langs);
      args.push('--sub-format', 'srt');

      if (task.subtitleMode === 'embed') {
        args.push('--write-subs', '--embed-subs');
        if (task.autoSubtitle) {
          args.push('--write-auto-subs');
        }
      } else if (task.subtitleMode === 'separate') {
        args.push('--write-subs');
        if (task.autoSubtitle) {
          args.push('--write-auto-subs');
        }
        // 转换为 SRT 格式
        args.push('--convert-subs', 'srt');
      }
    }

    // 抑制非必要输出
    args.push('--no-warnings');
    args.push('--no-playlist');

    // 注入 Cookie 参数（在 URL 之前）
    const cookieArg = this.getCookieArg?.();
    if (cookieArg) {
      args.push(cookieArg.flag, cookieArg.value);
    }

    // 目标 URL
    args.push(`https://www.youtube.com/watch?v=${task.videoId}`);

    return args;
  }

  // ——————————————————————————————————————————
  // 进度解析
  // ——————————————————————————————————————————

  /**
   * 解析 yt-dlp --progress-template 输出的 JSON 进度行。
   *
   * 输出示例（单行 JSON）：
   * {"percent":" 42.3%","speed":" 2.34MiB/s","eta":" 00:41","downloaded_bytes":69000000,"total_bytes":164000000}
   *
   * 注意：percent/speed/eta 是 yt-dlp 格式化后的字符串（含前导空格），
   * 需要清洗。total_bytes 可能为 NaN（直播/未知大小）。
   */
  parseProgress(line: string): ProgressInfo | null {
    // 只处理 JSON 行（跳过 [download] 等前缀行）
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) return null;

    try {
      const raw = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;

      const percent = parseFloat(String(raw.percent ?? '0').trim().replace('%', ''));
      const speed = parseFloat(String(raw.speed ?? '0').trim().replace(/[^\d.]/g, '')) || 0;
      const speedUnit = String(raw.speed ?? '').trim().replace(/[\d.\s]+/g, '') || 'MiB/s';
      const eta = String(raw.eta ?? '00:00').trim();
      const totalSize = parseFloat(String(raw.total_bytes ?? '0').replace(/[^\d.]/g, '')) || 0;

      // total_bytes 可能为 NaN（未知大小），用 0 表示
      const totalBytesUnit = totalSize > 0 ? this.formatBytes(totalSize) : 'Unknown';

      return {
        percent: Number.isFinite(percent) ? percent : 0,
        totalSize,
        totalSizeUnit: totalBytesUnit,
        speed,
        speedUnit,
        eta,
      };
    } catch {
      // 非 JSON 行（如 [info] ...），跳过
      return null;
    }
  }

  /** 字节数 → 人类可读（如 164000000 → "156.4MiB"） */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GiB`;
  }
}
