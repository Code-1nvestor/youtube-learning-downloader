/**
 * yt-dlp.service.ts — yt-dlp 封装核心服务（本模块的"心脏"）
 *
 * 职责边界：
 * ┌────────────────────────────────────────────────────────┐
 * │  输入: YouTube URL / 关键词                              │
 * │  输出: 清洗后的领域模型 (ResolveResult)                   │
 * │  不做: 下载、队列、持久化（Phase 3+ 模块的职责）           │
 * └────────────────────────────────────────────────────────┘
 *
 * 架构说明（供 AI 同事扩展时参考）：
 * 1. 本服务是唯一允许接触 yt-dlp 原始 JSON 的地方。
 *    yt-dlp 输出结构变动时，只改这里的 mapXxx 函数。
 * 2. 所有 yt-dlp 错误统一在 translateYtDlpError 翻译为 AppError。
 * 3. 新增能力（如 download()）时，遵循同样模式：
 *    buildXxxArgs() 构造参数 → runProcess 执行 → mapXxx 清洗 → 返回领域模型。
 *
 * 关键 yt-dlp 命令备忘：
 * - 视频详情:        yt-dlp --dump-json --no-playlist <url>
 * - 播放列表(快速):  yt-dlp --flat-playlist -J <url>   （只含骨架字段，秒级返回）
 * - 播放列表(完整):  yt-dlp -J <url>                    （逐视频详情，很慢，慎用）
 * - 搜索:            yt-dlp "ytsearch20:<keyword>" --flat-playlist -J
 */

import { runProcess, BinaryNotFoundError } from './process.ts';
import { classifyQuery } from './url-classifier.ts';
import { translateYtDlpError } from './yt-dlp-errors.ts';
import { injectYtDlpNetworkArgs } from './yt-dlp-network.ts';
import { AppError } from '../types/errors.ts';
import type { CookieArg } from '../types/auth.ts';
import type { GentleSettings } from '../types/settings.ts';
import type {
  ResolveResult,
  VideoInfo,
  VideoFormat,
  SubtitleInfo,
  Thumbnail,
} from '../types/video.ts';

// ————————————————————————————————————————————
// 配置
// ————————————————————————————————————————————

export interface YtDlpServiceOptions {
  /** yt-dlp 可执行文件名或路径（默认 "yt-dlp"，从 PATH 解析） */
  binary?: string;
  /** 单次解析超时（毫秒），大播放列表建议 ≥ 60s */
  timeoutMs?: number;
  /** Cookie 参数提供者（可选，运行时动态读取） */
  getCookieArg?: () => CookieArg | undefined;
  /** 代理地址提供者（可选，运行时动态读取） */
  getProxyUrl?: () => string | undefined;
  /** 温和模式配置提供者（解析请求时动态读取） */
  getGentleSettings?: () => GentleSettings;
}

const DEFAULT_OPTIONS: Required<Omit<YtDlpServiceOptions, 'getCookieArg' | 'getProxyUrl' | 'getGentleSettings'>> = {
  binary: 'yt-dlp',
  timeoutMs: 60_000,
};

// ————————————————————————————————————————————
// yt-dlp 原始 JSON 结构（只声明用到的字段，其余允许存在）
// 参考: yt-dlp README "OUTPUT TEMPLATE" 与 infojson 文档
// ————————————————————————————————————————————

interface RawFormat {
  format_id?: string;
  ext?: string;
  format_note?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string; // "none" 表示纯音频
  acodec?: string; // "none" 表示纯视频
  filesize?: number;
  filesize_approx?: number;
  resolution?: string;
}

interface RawSubtitleTrack {
  ext?: string;
  url?: string;
  name?: string;
}

interface RawEntry {
  id?: string;
  title?: string;
  duration?: number;
  upload_date?: string; // "20240131"
  channel?: string;
  uploader?: string;
  thumbnails?: Thumbnail[];
  thumbnail?: string;
  formats?: RawFormat[];
  subtitles?: Record<string, RawSubtitleTrack[]>;
  automatic_captions?: Record<string, RawSubtitleTrack[]>;
  playlist_index?: number;
  url?: string; // flat-playlist 下是视频页 URL
  _type?: string;
}

interface RawPlaylistJson {
  _type?: string; // "playlist"
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  entries?: RawEntry[];
}

// ————————————————————————————————————————————
// 服务实现
// ————————————————————————————————————————————

export class YtDlpService {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly getCookieArg?: () => CookieArg | undefined;
  private readonly getProxyUrl?: () => string | undefined;
  private readonly getGentleSettings?: () => GentleSettings;

  constructor(options: YtDlpServiceOptions = {}) {
    this.binary = options.binary ?? DEFAULT_OPTIONS.binary;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
    this.getCookieArg = options.getCookieArg;
    this.getProxyUrl = options.getProxyUrl;
    this.getGentleSettings = options.getGentleSettings;
  }

  /**
   * 环境自检：yt-dlp 是否可用。服务启动时调用一次即可。
   * @returns yt-dlp 版本号，如 "2024.05.27"
   * @throws {AppError} YT_DLP_MISSING
   */
  async checkAvailable(): Promise<string> {
    try {
      const result = await runProcess(this.binary, ['--version'], {
        timeoutMs: 10_000,
      });
      const version = result.stdout.trim();
      if (result.exitCode !== 0 || version.length === 0) {
        throw new AppError('YT_DLP_MISSING', 'yt-dlp 返回了异常结果', {
          stderr: result.stderr,
        });
      }
      return version;
    } catch (err) {
      if (err instanceof BinaryNotFoundError) {
        throw new AppError(
          'YT_DLP_MISSING',
          '未检测到 yt-dlp。请先安装: pip install -U yt-dlp（或参考 README）',
          { binary: this.binary },
        );
      }
      throw err;
    }
  }

  /**
   * 统一解析入口：自动识别 URL 类型并分发。
   * 对应后端路由 GET /api/resolve 的核心实现。
   */
  async resolve(query: string): Promise<ResolveResult> {
    const { kind, normalized } = classifyQuery(query);

    switch (kind) {
      case 'video':
        return this.resolveVideo(normalized);
      case 'playlist':
      case 'channel':
        // 频道与播放列表结构一致（都是视频集合），复用同一实现
        return this.resolvePlaylist(normalized, kind);
      case 'search':
        // 搜索 = yt-dlp 的 ytsearch 协议，复用播放列表解析
        return this.resolvePlaylist(`ytsearch20:${normalized}`, 'playlist', `搜索: ${normalized}`);
    }
  }

  /**
   * 解析单个视频（含完整格式与字幕信息）。
   *
   * 命令: yt-dlp --dump-json --no-playlist <url>
   * - --no-playlist: 防止 watch?v=xx&list=yy 链接误拉整个列表
   */
  private async resolveVideo(url: string): Promise<ResolveResult> {
    const args = ['--dump-json', '--no-playlist', '--no-warnings', url];
    const result = await this.exec(args, `解析视频失败`);

    const raw = this.parseJsonLine<RawEntry>(result.stdout);
    const video = this.mapToVideoInfo(raw);

    return { kind: 'video', title: video.title, videos: [video] };
  }

  /**
   * 解析播放列表/频道（flat 模式，只取骨架，秒级返回）。
   *
   * 命令: yt-dlp --flat-playlist -J <url>
   * 说明：flat 模式下 entries 不含 formats/subtitles —— 这是有意的性能取舍。
   * 用户在 UI 中选中具体视频后，再由 Phase 3 的下载流程按需取详情。
   */
  private async resolvePlaylist(
    url: string,
    kind: 'playlist' | 'channel',
    titleOverride?: string,
  ): Promise<ResolveResult> {
    const args = ['--flat-playlist', '-J', '--no-warnings', url];
    const result = await this.exec(args, `解析播放列表失败`);

    const raw = this.parseJsonLine<RawPlaylistJson>(result.stdout);
    const entries = raw.entries ?? [];

    const videos: VideoInfo[] = entries
      .filter((e): e is RawEntry & { id: string } => typeof e.id === 'string')
      .map((e, index) => this.mapFlatEntry(e, raw.title, index + 1));

    return {
      kind,
      title: titleOverride ?? raw.title ?? '未命名列表',
      ...(raw.channel ?? raw.uploader
        ? { channelTitle: raw.channel ?? raw.uploader }
        : {}),
      videoCount: videos.length,
      videos,
    };
  }

  // ——————————————————————————————————————————
  // 内部：进程执行 + 错误翻译
  // ——————————————————————————————————————————

  /** 执行 yt-dlp 并统一翻译错误（所有私有方法的唯一出口） */
  private async exec(args: string[], contextMessage: string) {
    try {
      const finalArgs = this.buildResolveArgs(args);
      const result = await runProcess(this.binary, finalArgs, {
        timeoutMs: this.timeoutMs,
      });

      if (result.exitCode !== 0) {
        throw translateYtDlpError(result.stderr, contextMessage);
      }
      return result;
    } catch (err) {
      if (err instanceof BinaryNotFoundError) {
        throw new AppError(
          'YT_DLP_MISSING',
          '未检测到 yt-dlp。请先安装: pip install -U yt-dlp',
          { binary: this.binary },
        );
      }
      throw err;
    }
  }

  /** 构建解析命令参数，供测试和诊断确认温和模式开关。 */
  buildResolveArgs(args: string[]): string[] {
    const finalArgs = injectYtDlpNetworkArgs([...args], this.getProxyUrl, this.getCookieArg);
    if (this.getGentleSettings?.()?.gentleMode) {
      finalArgs.unshift('--sleep-requests', '1');
    }
    return finalArgs;
  }

  // ——————————————————————————————————————————
  // 内部：原始 JSON → 领域模型 映射
  // ——————————————————————————————————————————

  /** 解析 JSON 输出（--dump-json / -J 均为单行 JSON） */
  private parseJsonLine<T>(stdout: string): T {
    const line = stdout.trim();
    if (line.length === 0) {
      throw new AppError('UNKNOWN', 'yt-dlp 返回了空输出');
    }
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new AppError('UNKNOWN', 'yt-dlp 输出 JSON 解析失败（可能版本不兼容）', {
        head: line.slice(0, 200),
      });
    }
  }

  /** 完整视频 JSON → VideoInfo（含格式/字幕） */
  private mapToVideoInfo(raw: RawEntry): VideoInfo {
    return {
      id: raw.id ?? '',
      title: raw.title ?? '未知标题',
      ...(raw.duration !== undefined ? { duration: raw.duration } : {}),
      thumbnails: raw.thumbnails ?? (raw.thumbnail ? [{ url: raw.thumbnail }] : []),
      ...(raw.upload_date ? { uploadDate: formatUploadDate(raw.upload_date) } : {}),
      ...(raw.channel ?? raw.uploader
        ? { channelTitle: raw.channel ?? raw.uploader }
        : {}),
      formats: this.mapFormats(raw.formats ?? []),
      subtitles: this.mapSubtitles(raw.subtitles, raw.automatic_captions),
    };
  }

  /** flat-playlist 骨架 entry → VideoInfo（不含格式/字幕，按需再取） */
  private mapFlatEntry(raw: RawEntry, playlistTitle: string | undefined, index: number): VideoInfo {
    return {
      id: raw.id!,
      title: raw.title ?? '未知标题',
      ...(raw.duration !== undefined ? { duration: raw.duration } : {}),
      thumbnails: raw.thumbnails ?? [],
      ...(raw.channel ?? raw.uploader
        ? { channelTitle: raw.channel ?? raw.uploader }
        : {}),
      ...(playlistTitle ? { playlistTitle } : {}),
      playlistIndex: raw.playlist_index ?? index,
      formats: [],
      subtitles: [],
    };
  }

  /**
   * 格式清洗：
   * - 剔除 storyboard（缩略图拼图，不是媒体流）
   * - 剔除无 format_id 的脏数据
   * - 按高度降序排列，纯音频排在末尾
   */
  private mapFormats(rawFormats: RawFormat[]): VideoFormat[] {
    return rawFormats
      .filter((f) => f.format_id && f.format_note !== 'storyboard' && f.ext)
      .map((f): VideoFormat => {
        const hasVideo = f.vcodec !== undefined && f.vcodec !== 'none';
        const hasAudio = f.acodec !== undefined && f.acodec !== 'none';
        return {
          formatId: f.format_id!,
          container: f.ext!,
          qualityLabel: buildQualityLabel(f, hasVideo),
          ...(f.resolution || (f.width && f.height)
            ? { resolution: f.resolution ?? `${f.width}x${f.height}` }
            : {}),
          ...(f.filesize ?? f.filesize_approx
            ? { filesize: f.filesize ?? f.filesize_approx }
            : {}),
          hasVideo,
          hasAudio,
          ...(f.vcodec && f.vcodec !== 'none'
            ? { codec: f.vcodec }
            : f.acodec && f.acodec !== 'none'
              ? { codec: f.acodec }
              : {}),
        };
      })
      .sort((a, b) => {
        // 视频格式按分辨率降序，音频格式沉底
        const ah = a.hasVideo ? parseInt(a.resolution?.split('x')[1] ?? '0', 10) : -1;
        const bh = b.hasVideo ? parseInt(b.resolution?.split('x')[1] ?? '0', 10) : -1;
        return bh - ah;
      });
  }

  /** 字幕清洗：手动字幕优先，自动生成字幕标记 isAutoGenerated */
  private mapSubtitles(
    manual?: Record<string, RawSubtitleTrack[]>,
    auto?: Record<string, RawSubtitleTrack[]>,
  ): SubtitleInfo[] {
    const result: SubtitleInfo[] = [];

    for (const [lang, tracks] of Object.entries(manual ?? {})) {
      result.push({
        language: lang,
        name: tracks[0]?.name ?? lang,
        isAutoGenerated: false,
      });
    }
    for (const [lang, tracks] of Object.entries(auto ?? {})) {
      // 手动字幕已存在的语言不再重复列自动字幕
      if (manual && lang in manual) continue;
      result.push({
        language: lang,
        name: tracks[0]?.name ?? lang,
        isAutoGenerated: true,
      });
    }
    return result;
  }
}

// ————————————————————————————————————————————
// 纯工具函数
// ————————————————————————————————————————————

/** "20240131" → "2024-01-31" */
function formatUploadDate(raw: string): string {
  if (raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

/** 生成画质标签：1080p60 / 720p / audio only */
function buildQualityLabel(f: RawFormat, hasVideo: boolean): string {
  if (!hasVideo) return 'audio only';
  const base = f.height ? `${f.height}p` : (f.format_note ?? 'unknown');
  return f.fps && f.fps > 30 ? `${base}${Math.round(f.fps)}` : base;
}
