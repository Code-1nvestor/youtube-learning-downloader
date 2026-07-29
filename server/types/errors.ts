/**
 * errors.ts — 全局错误分类体系
 *
 * 设计目标：
 * 1. 所有"可预期的业务错误"都必须以 AppError 抛出，携带稳定的 code。
 * 2. 前端/调用方只需根据 code 做分支处理，message 仅用于展示，不做逻辑判断。
 * 3. 错误码在前后端之间共享（此处为唯一定义源，前端可拷贝或生成）。
 *
 * 扩展指南（AI 同事注意）：
 * - 新增错误场景时，先在此追加错误码，再在出错位置 throw new AppError(...)。
 * - 不要直接 throw new Error(...) —— 那会被错误中间件归类为 UNKNOWN（500）。
 */

/** 错误码枚举（与 docs/development-plan.md 第三节保持一致） */
export const ERROR_CODES = {
  // —— 输入类（4xx）——
  INVALID_URL: 'INVALID_URL', // URL 无法识别为视频/播放列表/频道
  MISSING_PARAM: 'MISSING_PARAM', // 缺少必需参数

  // —— YouTube 上游类（4xx/5xx）——
  VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE', // 视频被删除/设为私有/地区限制
  PLAYLIST_UNAVAILABLE: 'PLAYLIST_UNAVAILABLE', // 播放列表不存在或无权限
  RATE_LIMITED: 'RATE_LIMITED', // 触发 YouTube 风控（HTTP 429）
  NETWORK_ERROR: 'NETWORK_ERROR', // 网络不可达（无代理/断网/DNS 失败）

  // —— 环境类（5xx，服务启动时检测）——
  YT_DLP_MISSING: 'YT_DLP_MISSING', // 找不到 yt-dlp 可执行文件
  YT_DLP_OUTDATED: 'YT_DLP_OUTDATED', // yt-dlp 版本过旧
  FFMPEG_MISSING: 'FFMPEG_MISSING', // 找不到 ffmpeg（Phase 3 下载时检测）

  // —— 下载类（Phase 3+ 使用，先定义占位）——
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  QUEUE_FULL: 'QUEUE_FULL',
  DISK_FULL: 'DISK_FULL',
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',

  // —— 兜底 ——
  TIMEOUT: 'TIMEOUT', // 子进程执行超时
  UNKNOWN: 'UNKNOWN', // 未预期错误（bug 或第三方异常）
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 错误码 → 默认 HTTP 状态码映射（错误中间件使用） */
const DEFAULT_STATUS: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  MISSING_PARAM: 400,
  VIDEO_UNAVAILABLE: 404,
  PLAYLIST_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  NETWORK_ERROR: 502,
  YT_DLP_MISSING: 500,
  YT_DLP_OUTDATED: 500,
  FFMPEG_MISSING: 500,
  DOWNLOAD_FAILED: 500,
  QUEUE_FULL: 503,
  DISK_FULL: 507,
  PATH_NOT_ALLOWED: 400,
  TIMEOUT: 504,
  UNKNOWN: 500,
};

/**
 * 应用内统一错误类型。
 *
 * @example
 * throw new AppError('VIDEO_UNAVAILABLE', '视频不可用或已被设为私有');
 */
export class AppError extends Error {
  /** 稳定错误码，调用方据此分支处理 */
  readonly code: ErrorCode;
  /** HTTP 状态码（由错误码推导，可覆盖） */
  readonly statusCode: number;
  /** 附加调试信息（如 yt-dlp stderr 片段），不会泄漏到生产日志以外的地方 */
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode ?? DEFAULT_STATUS[code];
    this.details = details;
  }
}

/** 类型守卫：区分业务错误与未预期异常 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
