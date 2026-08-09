import path from 'node:path';
import type { DbContext } from '../db/database.ts';
import { rowToTask, taskToRow, type TaskRow } from '../db/task-serializer.ts';
import type { DownloadStatus, DownloadTask, QueueStatus } from '../types/download.ts';
import { AppError } from '../types/errors.ts';
import type { AppSettings } from '../types/settings.ts';
import { DEFAULT_GENTLE_SETTINGS } from '../types/settings.ts';
import {
  DATA_BACKUP_FORMAT,
  DATA_BACKUP_VERSION,
  type DataBackupDocument,
  type DataBackupSummary,
  type DataRestoreResult,
} from '../types/backup.ts';

const DOWNLOAD_STATUSES = new Set<DownloadStatus>([
  'queued',
  'downloading',
  'retrying',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);
const RUNNING_STATUSES = new Set<DownloadStatus>(['queued', 'downloading', 'retrying']);
const RESUMABLE_STATUSES = new Set<DownloadStatus>(['queued', 'downloading', 'retrying', 'paused', 'failed']);
const CONTAINERS = new Set(['mp4', 'webm', 'mp3', 'm4a']);
const SUBTITLE_MODES = new Set(['none', 'embed', 'separate']);
const ALLOWED_TEMPLATE_TOKENS = new Set(['course', 'date', 'num', 'title', 'quality', 'ext']);
const MAX_BACKUP_TASKS = 50_000;

interface BackupServiceOptions {
  db: DbContext | null;
  getSettings: () => AppSettings;
  getQueueStatus: () => QueueStatus;
  appVersion: string;
}

export class BackupService {
  private readonly db: DbContext | null;
  private readonly getSettings: () => AppSettings;
  private readonly getQueueStatus: () => QueueStatus;
  private readonly appVersion: string;

  constructor(options: BackupServiceOptions) {
    this.db = options.db;
    this.getSettings = options.getSettings;
    this.getQueueStatus = options.getQueueStatus;
    this.appVersion = options.appVersion;
  }

  createBackup(): DataBackupDocument {
    const db = this.requireDatabase();
    const rows = db.db.prepare(
      'SELECT * FROM download_tasks ORDER BY created_at ASC',
    ).all() as unknown as TaskRow[];

    return {
      format: DATA_BACKUP_FORMAT,
      version: DATA_BACKUP_VERSION,
      appVersion: this.appVersion,
      exportedAt: new Date().toISOString(),
      cookieIncluded: false,
      data: {
        settings: { ...this.getSettings() },
        tasks: rows.map(rowToTask),
      },
    };
  }

  inspectBackup(input: unknown): DataBackupSummary {
    const backup = validateBackupDocument(input);
    return summarizeBackup(backup, this.getSettings().downloadPath);
  }

  restoreBackup(input: unknown): DataRestoreResult {
    const db = this.requireDatabase();
    const current = this.getQueueStatus();
    const runningCount = current.tasks.filter((task) => RUNNING_STATUSES.has(task.status)).length;
    if (runningCount > 0) {
      throw new AppError(
        'INVALID_STATE',
        `还有 ${runningCount} 个下载任务正在运行或等待，请先暂停或取消后再恢复备份`,
      );
    }

    const backup = validateBackupDocument(input);
    const restoreRoot = this.getSettings().downloadPath;
    const restoredTasks = backup.data.tasks.map((task) => sanitizeRestoredTask(task, restoreRoot));
    const updatedAt = new Date().toISOString();

    try {
      db.db.exec('BEGIN IMMEDIATE');
      db.db.exec('DELETE FROM download_tasks; DELETE FROM app_settings;');
      for (const [key, value] of Object.entries(backup.data.settings)) {
        db.stmts.upsertSetting.run(key, JSON.stringify(value), updatedAt);
      }
      for (const task of restoredTasks) {
        db.stmts.upsertTask.run(taskToRow(task));
      }
      db.db.exec('COMMIT');
    } catch (error) {
      try {
        db.db.exec('ROLLBACK');
      } catch {
        // BEGIN 失败时没有可回滚事务。
      }
      throw new AppError('UNKNOWN', '备份恢复失败，原有数据已保留', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ...summarizeBackup(backup, restoreRoot),
      restored: true,
      restartRequired: true,
    };
  }

  private requireDatabase(): DbContext {
    if (!this.db) {
      throw new AppError('INVALID_STATE', '数据库当前不可用，无法备份或恢复数据');
    }
    return this.db;
  }
}

export function validateBackupDocument(input: unknown): DataBackupDocument {
  const root = requireRecord(input, '备份文件内容');
  if (root.format !== DATA_BACKUP_FORMAT) {
    throw new AppError('INVALID_PARAM', '这不是学习资料下载器的数据备份文件');
  }
  if (root.version !== DATA_BACKUP_VERSION) {
    throw new AppError('INVALID_PARAM', `暂不支持备份格式版本 ${String(root.version)}`);
  }
  if (root.cookieIncluded !== false) {
    throw new AppError('INVALID_PARAM', '备份文件包含不受支持的敏感 Cookie 数据');
  }

  const appVersion = requireString(root.appVersion, 'appVersion', 64);
  const exportedAt = requireIsoDate(root.exportedAt, 'exportedAt');
  const data = requireRecord(root.data, 'data');
  const settings = validateBackupSettings(data.settings);
  if (!Array.isArray(data.tasks)) {
    throw new AppError('INVALID_PARAM', '备份文件缺少任务列表');
  }
  if (data.tasks.length > MAX_BACKUP_TASKS) {
    throw new AppError('INVALID_PARAM', `备份任务数量超过 ${MAX_BACKUP_TASKS} 个安全上限`);
  }
  const tasks = data.tasks.map((task, index) => validateBackupTask(task, index));
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new AppError('INVALID_PARAM', '备份文件包含重复的任务 ID');
  }

  return {
    format: DATA_BACKUP_FORMAT,
    version: DATA_BACKUP_VERSION,
    appVersion,
    exportedAt,
    cookieIncluded: false,
    data: { settings, tasks },
  };
}

function validateBackupSettings(input: unknown): AppSettings {
  const settings = requireRecord(input, 'data.settings');
  const keys = Object.keys(settings);
  const allowed = new Set([
    'downloadPath',
    'maxConcurrent',
    'maxRetries',
    'namingTemplate',
    'proxyUrl',
    'gentleMode',
    'gentleRateLimitMbps',
    'gentleCooldownSeconds',
    'gentleBatchLimit',
  ]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new AppError('INVALID_PARAM', '备份设置包含不支持的字段');
  }

  const downloadPath = requireString(settings.downloadPath, 'downloadPath', 32_767);
  if (!path.isAbsolute(downloadPath)) {
    throw new AppError('INVALID_PARAM', '备份中的下载目录不是绝对路径');
  }
  const maxConcurrent = requireInteger(settings.maxConcurrent, 'maxConcurrent', 1, 8);
  const maxRetries = requireInteger(settings.maxRetries, 'maxRetries', 0, 5);
  const namingTemplate = requireString(settings.namingTemplate, 'namingTemplate', 240).trim();
  if (path.win32.isAbsolute(namingTemplate) || path.posix.isAbsolute(namingTemplate)) {
    throw new AppError('INVALID_PARAM', '备份中的命名规则必须是相对路径');
  }
  if (namingTemplate.split(/[\\/]+/).some((segment) => segment === '..')) {
    throw new AppError('INVALID_PARAM', '备份中的命名规则不能包含上级目录“..”');
  }
  const tokens = [...namingTemplate.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  if (tokens.some((token) => !token || !ALLOWED_TEMPLATE_TOKENS.has(token))) {
    throw new AppError('INVALID_PARAM', '备份中的命名规则包含不支持的变量');
  }
  if (!namingTemplate.includes('{title}') || !namingTemplate.includes('{ext}')) {
    throw new AppError('INVALID_PARAM', '备份中的命名规则缺少 {title} 或 {ext}');
  }
  const proxyUrl = typeof settings.proxyUrl === 'string' ? settings.proxyUrl.trim() : '';
  if (proxyUrl.length > 2_048) {
    throw new AppError('INVALID_PARAM', '备份中的代理地址过长');
  }
  if (proxyUrl) validateBackupProxyUrl(proxyUrl);

  const gentleMode = settings.gentleMode === undefined
    ? DEFAULT_GENTLE_SETTINGS.gentleMode
    : requireBoolean(settings.gentleMode, 'gentleMode');
  const gentleRateLimitMbps = settings.gentleRateLimitMbps === undefined
    ? DEFAULT_GENTLE_SETTINGS.gentleRateLimitMbps
    : requireInteger(settings.gentleRateLimitMbps, 'gentleRateLimitMbps', 1, 10);
  const gentleCooldownSeconds = settings.gentleCooldownSeconds === undefined
    ? DEFAULT_GENTLE_SETTINGS.gentleCooldownSeconds
    : requireInteger(settings.gentleCooldownSeconds, 'gentleCooldownSeconds', 10, 300);
  const gentleBatchLimit = settings.gentleBatchLimit === undefined
    ? DEFAULT_GENTLE_SETTINGS.gentleBatchLimit
    : requireInteger(settings.gentleBatchLimit, 'gentleBatchLimit', 1, 50);

  return {
    downloadPath: path.resolve(downloadPath),
    maxConcurrent,
    maxRetries,
    namingTemplate,
    proxyUrl,
    gentleMode,
    gentleRateLimitMbps,
    gentleCooldownSeconds,
    gentleBatchLimit,
  };
}

function validateBackupTask(input: unknown, index: number): DownloadTask {
  const task = requireRecord(input, `tasks[${index}]`);
  const status = requireString(task.status, `tasks[${index}].status`, 32) as DownloadStatus;
  if (!DOWNLOAD_STATUSES.has(status)) {
    throw new AppError('INVALID_PARAM', `tasks[${index}].status 不受支持`);
  }
  const container = requireString(task.container, `tasks[${index}].container`, 16);
  if (!CONTAINERS.has(container)) {
    throw new AppError('INVALID_PARAM', `tasks[${index}].container 不受支持`);
  }
  const subtitleMode = requireString(task.subtitleMode, `tasks[${index}].subtitleMode`, 16);
  if (!SUBTITLE_MODES.has(subtitleMode)) {
    throw new AppError('INVALID_PARAM', `tasks[${index}].subtitleMode 不受支持`);
  }
  if (!Array.isArray(task.subtitleLangs) || task.subtitleLangs.length > 50) {
    throw new AppError('INVALID_PARAM', `tasks[${index}].subtitleLangs 格式不正确`);
  }
  const subtitleLangs = task.subtitleLangs.map((language, languageIndex) => (
    requireString(language, `tasks[${index}].subtitleLangs[${languageIndex}]`, 64)
  ));
  if (typeof task.autoSubtitle !== 'boolean') {
    throw new AppError('INVALID_PARAM', `tasks[${index}].autoSubtitle 格式不正确`);
  }

  const rawOutputPath = requireString(task.outputPath, `tasks[${index}].outputPath`, 32_767);
  if (!path.isAbsolute(rawOutputPath)) {
    throw new AppError('PATH_NOT_ALLOWED', `tasks[${index}] 的输出路径不是绝对路径`);
  }
  const outputPath = path.resolve(rawOutputPath);
  if (path.extname(outputPath).toLowerCase() !== `.${container}`) {
    throw new AppError('PATH_NOT_ALLOWED', `tasks[${index}] 的输出扩展名与容器不一致`);
  }

  const id = requireString(task.id, `tasks[${index}].id`, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new AppError('PATH_NOT_ALLOWED', `tasks[${index}].id 不能安全用于任务目录`);
  }

  const result: DownloadTask = {
    id,
    videoId: requireString(task.videoId, `tasks[${index}].videoId`, 128),
    title: requireString(task.title, `tasks[${index}].title`, 1_000),
    formatId: requireString(task.formatId, `tasks[${index}].formatId`, 2_048),
    container,
    outputPath,
    subtitleLangs,
    subtitleMode: subtitleMode as DownloadTask['subtitleMode'],
    autoSubtitle: task.autoSubtitle,
    status,
    progress: requireNumber(task.progress, `tasks[${index}].progress`, 0, 100),
    speed: optionalString(task.speed, `tasks[${index}].speed`, 256) ?? '',
    eta: optionalString(task.eta, `tasks[${index}].eta`, 256) ?? '',
    downloadedBytes: requireInteger(task.downloadedBytes, `tasks[${index}].downloadedBytes`, 0, Number.MAX_SAFE_INTEGER),
    totalBytes: requireInteger(task.totalBytes, `tasks[${index}].totalBytes`, 0, Number.MAX_SAFE_INTEGER),
    estimatedBytes: requireInteger(task.estimatedBytes, `tasks[${index}].estimatedBytes`, 0, Number.MAX_SAFE_INTEGER),
    retryCount: requireInteger(task.retryCount, `tasks[${index}].retryCount`, 0, 100),
    maxRetries: requireInteger(task.maxRetries, `tasks[${index}].maxRetries`, 0, 100),
    createdAt: requireIsoDate(task.createdAt, `tasks[${index}].createdAt`),
  };

  const playlistTitle = optionalString(task.playlistTitle, `tasks[${index}].playlistTitle`, 1_000);
  if (playlistTitle) result.playlistTitle = playlistTitle;
  if (task.playlistIndex !== undefined) {
    result.playlistIndex = requireInteger(task.playlistIndex, `tasks[${index}].playlistIndex`, 1, 1_000_000);
  }
  const nextRetryAt = optionalIsoDate(task.nextRetryAt, `tasks[${index}].nextRetryAt`);
  if (nextRetryAt) result.nextRetryAt = nextRetryAt;
  const error = optionalString(task.error, `tasks[${index}].error`, 8_192);
  if (error) result.error = error;
  const errorCode = optionalString(task.errorCode, `tasks[${index}].errorCode`, 64);
  if (errorCode) result.errorCode = errorCode as DownloadTask['errorCode'];
  const completedAt = optionalIsoDate(task.completedAt, `tasks[${index}].completedAt`);
  if (completedAt) result.completedAt = completedAt;
  return result;
}

function sanitizeRestoredTask(task: DownloadTask, restoreRoot: string): DownloadTask {
  const restored: DownloadTask = RUNNING_STATUSES.has(task.status)
    ? { ...task, status: 'paused', speed: '', eta: '' }
    : { ...task };
  if (RUNNING_STATUSES.has(task.status)) delete restored.nextRetryAt;
  if (RESUMABLE_STATUSES.has(restored.status) && !isPathInside(restoreRoot, restored.outputPath)) {
    restored.outputPath = buildSafeRestoredOutputPath(restoreRoot, restored);
  }
  return restored;
}

function summarizeBackup(backup: DataBackupDocument, restoreRoot: string): DataBackupSummary {
  const count = (status: DownloadStatus) => backup.data.tasks.filter((task) => task.status === status).length;
  return {
    appVersion: backup.appVersion,
    exportedAt: backup.exportedAt,
    taskCount: backup.data.tasks.length,
    completedCount: count('completed'),
    failedCount: count('failed'),
    cancelledCount: count('cancelled'),
    pausedCount: count('paused'),
    willPauseCount: backup.data.tasks.filter((task) => RUNNING_STATUSES.has(task.status)).length,
    relocatedTaskCount: backup.data.tasks.filter((task) => (
      RESUMABLE_STATUSES.has(task.status) && !isPathInside(restoreRoot, task.outputPath)
    )).length,
    cookieIncluded: false,
  };
}

function buildSafeRestoredOutputPath(restoreRoot: string, task: DownloadTask): string {
  const originalStem = path.parse(path.basename(task.outputPath)).name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim()
    .slice(0, 120) || '恢复任务';
  const safeId = task.id.slice(0, 12);
  return path.join(path.resolve(restoreRoot), '已恢复任务', `${originalStem}-${safeId}.${task.container}`);
}

function validateBackupProxyUrl(proxyUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new AppError('INVALID_PARAM', '备份中的代理地址格式不正确');
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    throw new AppError('INVALID_PARAM', '备份中的代理协议不受支持');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new AppError('INVALID_PARAM', '备份中的代理地址包含无效主机或登录凭据');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new AppError('INVALID_PARAM', '备份中的代理地址不能包含路径、查询参数或锚点');
  }
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_PARAM', `${field} 必须是对象`);
  }
  return input as Record<string, unknown>;
}

function requireString(input: unknown, field: string, maxLength: number): string {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > maxLength) {
    throw new AppError('INVALID_PARAM', `${field} 必须是非空文本且不超过 ${maxLength} 个字符`);
  }
  return input;
}

function optionalString(input: unknown, field: string, maxLength: number): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  return requireString(input, field, maxLength);
}

function requireNumber(input: unknown, field: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
    throw new AppError('INVALID_PARAM', `${field} 必须是 ${min} 到 ${max} 之间的数字`);
  }
  return input;
}

function requireInteger(input: unknown, field: string, min: number, max: number): number {
  const value = requireNumber(input, field, min, max);
  if (!Number.isSafeInteger(value)) {
    throw new AppError('INVALID_PARAM', `${field} 必须是安全整数`);
  }
  return value;
}

function requireBoolean(input: unknown, field: string): boolean {
  if (typeof input !== 'boolean') {
    throw new AppError('INVALID_PARAM', `${field} 必须是布尔值`);
  }
  return input;
}

function requireIsoDate(input: unknown, field: string): string {
  const value = requireString(input, field, 64);
  if (!Number.isFinite(Date.parse(value))) {
    throw new AppError('INVALID_PARAM', `${field} 不是有效日期`);
  }
  return value;
}

function optionalIsoDate(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  return requireIsoDate(input, field);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}
