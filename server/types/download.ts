/**
 * download.ts — 下载领域模型
 *
 * 覆盖：下载任务、进度信息、队列状态、创建请求。
 * 与 types/video.ts 中的 VideoInfo/VideoFormat 互补，共同构成完整数据模型。
 */

// ————————————————————————————————————————————
// 下载任务
// ————————————————————————————————————————————

/** 任务状态机：queued → downloading → completed / retrying / failed / cancelled */
import type { ErrorCode } from './errors.ts';

export type DownloadStatus =
  | 'queued'        // 已入队，等待分配执行槽位
  | 'downloading'   // 正在下载
  | 'retrying'      // 暂时失败，等待自动重试
  | 'completed'     // 下载成功
  | 'failed'        // 下载失败（可重试）
  | 'cancelled'     // 用户取消
  | 'paused';       // 用户暂停（保留部分文件，可恢复）

/** 单个下载任务（运行时态，存于内存队列） */
export interface DownloadTask {
  /** 任务唯一 ID（UUID） */
  id: string;
  /** YouTube 视频 ID */
  videoId: string;
  /** 视频标题（用于展示与文件命名） */
  title: string;
  /** 所属播放列表标题（用于按课程归档） */
  playlistTitle?: string;
  /** 在播放列表中的序号（从 1 开始） */
  playlistIndex?: number;
  /** yt-dlp format_id 或格式选择表达式（如 "bestvideo[height<=1080]+bestaudio"） */
  formatId: string;
  /** 输出容器：mp4 / webm / mp3 / m4a */
  container: string;
  /** 最终输出文件的绝对路径 */
  outputPath: string;
  /** 字幕语言列表（如 ["zh-Hans","en"]），空数组表示不下载字幕 */
  subtitleLangs: string[];
  /** 字幕模式：embed(嵌入) / separate(外挂SRT) / none */
  subtitleMode: 'embed' | 'separate' | 'none';
  /** 是否在无手动字幕时使用自动生成字幕 */
  autoSubtitle: boolean;

  // —— 运行时状态 ——
  status: DownloadStatus;
  /** 进度百分比 0-100 */
  progress: number;
  /** 下载速度（人类可读，如 "2.3MiB/s"） */
  speed: string;
  /** 剩余时间（人类可读，如 "00:41"） */
  eta: string;
  /** 已下载字节数 */
  downloadedBytes: number;
  /** 总字节数（yt-dlp 不总是提供） */
  totalBytes: number;
  /** 创建任务时已知的文件估算大小；未知时为 0 */
  estimatedBytes: number;
  /** 已执行的自动重试次数 */
  retryCount: number;
  /** 此任务允许的最大自动重试次数 */
  maxRetries: number;
  /** 下一次自动重试时间 ISO 8601（仅 retrying 状态存在） */
  nextRetryAt?: string;
  /** 错误信息（status=failed 时填充） */
  error?: string;
  /** 稳定错误码，供界面显示可执行的恢复建议 */
  errorCode?: ErrorCode;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 完成时间 ISO 8601 */
  completedAt?: string;
}

// ————————————————————————————————————————————
// 进度信息（yt-dlp --newline 输出解析结果）
// ————————————————————————————————————————————

export interface ProgressInfo {
  percent: number;
  totalSize: number;
  totalSizeUnit: string;
  speed: number;
  speedUnit: string;
  eta: string;
}

// ————————————————————————————————————————————
// API 请求/响应
// ————————————————————————————————————————————

/** POST /api/download 请求体 */
export interface CreateDownloadRequest {
  /** 单个或多个下载任务 */
  tasks: CreateDownloadTaskInput[];
  /** 冲突处理：默认拒绝整批；rename 会为冲突文件自动添加序号 */
  conflictPolicy?: DownloadConflictPolicy;
}

export type DownloadConflictPolicy = 'reject' | 'rename';

export type DownloadConflictReason = 'existing_task' | 'file_exists' | 'batch_duplicate';

export interface DownloadConflict {
  inputIndex: number;
  title: string;
  outputPath: string;
  reason: DownloadConflictReason;
  existingTaskId?: string;
}

export interface RenamedDownload {
  inputIndex: number;
  title: string;
  outputPath: string;
}

/** 单个下载任务输入 */
export interface CreateDownloadTaskInput {
  videoId: string;
  title: string;
  playlistTitle?: string;
  playlistIndex?: number;
  /** 格式选择表达式，留空则使用服务端默认策略 */
  formatId?: string;
  /** 目标容器，默认 mp4 */
  container?: string;
  /** 字幕语言 */
  subtitleLangs?: string[];
  /** 字幕模式，默认 none */
  subtitleMode?: 'embed' | 'separate' | 'none';
  /** 自动字幕兜底，默认 false */
  autoSubtitle?: boolean;
  /** 所选格式的估算字节数，用于下载前磁盘空间检查 */
  estimatedBytes?: number;
}

/** POST /api/download 响应 */
export interface CreateDownloadResponse {
  taskIds: string[];
  /** reject 模式发生冲突时整批不创建，并在这里返回冲突详情 */
  conflicts: DownloadConflict[];
  /** rename 模式中被安全改名的任务 */
  renamed: RenamedDownload[];
}

/** GET /api/queue 响应 */
export interface QueueStatus {
  tasks: DownloadTask[];
  active: number;
  waiting: number;
  completed: number;
  failed: number;
}

// ————————————————————————————————————————————
// 命名模板上下文
// ————————————————————————————————————————————

export interface NamingContext {
  /** 课程名（播放列表标题） */
  course?: string;
  /** 下载日期 yyyy-MM-dd */
  date: string;
  /** 集数序号（已补齐到两位） */
  num?: string;
  /** 视频标题 */
  title: string;
  /** 画质标签（如 1080p） */
  quality?: string;
  /** 文件扩展名（不含点） */
  ext: string;
}
