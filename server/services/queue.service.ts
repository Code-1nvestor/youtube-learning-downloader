/**
 * queue.service.ts - 下载任务队列管理
 *
 * 职责：管理下载任务的全生命周期（入队 -> 执行 -> 完成/失败/暂停/取消），
 * 控制并发数，维护内存中的任务状态，并同步持久化到 SQLite。
 *
 * 设计决策：
 * - 内存 + SQLite 双写：内存 Map 是运行时权威态，SQLite 是持久化镜像。
 *   所有状态变更先更新内存，再同步到 DB（即使 DB 写失败也不阻断主流程）。
 * - 并发控制：简单的"活跃计数 + 队列扫描"，不依赖外部库（BullMQ 等）。
 *   个人使用场景下并发数 ≤ 3，无需分布式队列。
 * - 暂停/恢复：暂停 = 终止子进程 + 保留部分文件；恢复 = 重新入队
 *   （yt-dlp --continue 会自动续传）。这是跨平台最可靠的方案 --
 *   Windows 不支持 SIGSTOP，无法真正"挂起"进程。
 * - 重启恢复：服务启动时从 DB 加载未完成任务，
 *   downloading 状态降级为 paused（进程已死，文件保留可续传），
 *   queued 状态保持原样自动继续执行。
 *
 * 状态流转：
 *   queued -> downloading -> completed
 *                ↓
 *             paused -> (resume) -> queued -> downloading
 *                ↓
 *             cancelled
 *                ↓
 *           retrying -> queued -> downloading
 *              failed -> (manual retry) -> queued -> downloading
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { DownloadService } from './download.service.ts';
import type { NamingService } from './naming.service.ts';
import type { DbContext } from '../db/database.ts';
import { taskToRow, rowToTask } from '../db/task-serializer.ts';
import type {
  DownloadTask,
  CreateDownloadTaskInput,
  QueueStatus,
  ProgressInfo,
  NamingContext,
  CreateDownloadResponse,
  DownloadConflict,
  DownloadConflictPolicy,
  DownloadConflictReason,
  RenamedDownload,
} from '../types/download.ts';
import { AppError } from '../types/errors.ts';
import { DEFAULT_GENTLE_SETTINGS } from '../types/settings.ts';

export interface QueueServiceOptions {
  /** 最大并发下载数 */
  maxConcurrent: number;
  /** 默认下载根目录 */
  downloadPath: string;
  /** 默认命名模板 */
  namingTemplate: string;
  /** 新任务的最大自动重试次数 */
  maxRetries: number;
  gentleMode?: boolean;
  gentleRateLimitMbps?: number;
  gentleCooldownSeconds?: number;
  gentleBatchLimit?: number;
}

const RETRYABLE_ERROR_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT']);
const PROTECTIVE_ERROR_CODES = new Set(['RATE_LIMITED', 'COOKIE_ERROR']);
const DUPLICATE_BLOCKING_STATUSES = new Set<DownloadTask['status']>([
  'queued',
  'downloading',
  'retrying',
  'paused',
  'failed',
]);

interface PlannedDownload {
  input: CreateDownloadTaskInput;
  outputPath: string;
}

interface OccupiedOutput {
  reason: DownloadConflictReason;
  existingTaskId?: string;
}

export function getRetryDelayMs(retryCount: number): number {
  return Math.min(2_000 * (2 ** Math.max(retryCount - 1, 0)), 30_000);
}

export class QueueService {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly downloadService: DownloadService;
  private readonly namingService: NamingService;
  private options: QueueServiceOptions;
  private readonly db: DbContext | null;
  private activeCount = 0;
  private readonly retryDelayCalculator: (retryCount: number) => number;
  private gentleCooldownDeadline = 0;
  private gentleCooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;

  constructor(
    downloadService: DownloadService,
    namingService: NamingService,
    options: QueueServiceOptions,
    db: DbContext | null = null,
    retryDelayCalculator: (retryCount: number) => number = getRetryDelayMs,
  ) {
    this.downloadService = downloadService;
    this.namingService = namingService;
    this.options = {
      ...options,
      downloadPath: path.resolve(options.downloadPath),
    };
    this.db = db;
    this.retryDelayCalculator = retryDelayCalculator;
  }

  /** 后续新任务使用新设置；已运行任务不被强制中断。 */
  updateOptions(options: QueueServiceOptions): void {
    const previousGentleMode = this.options.gentleMode === true;
    this.options = {
      ...this.options,
      ...options,
      downloadPath: path.resolve(options.downloadPath),
    };
    if (previousGentleMode && !this.options.gentleMode) {
      this.clearGentleCooldown();
    }
    this.tryStartNext();
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.clearGentleCooldown();
    for (const id of this.retryTimers.keys()) this.clearRetryTimer(id);
  }

  dispose(): void {
    this.shutdown();
  }

  // ------------------------------------------
  // 持久化辅助
  // ------------------------------------------

  /** 将任务状态同步到数据库（静默失败，不阻断主流程） */
  private persistTask(task: DownloadTask): void {
    if (!this.db) return;
    try {
      this.db.stmts.upsertTask.run(taskToRow(task));
    } catch (err) {
      console.error(`[queue] 持久化失败 ${task.id}:`, err);
    }
  }

  /** 从数据库删除任务记录（静默失败） */
  private deleteTaskFromDb(id: string): void {
    if (!this.db) return;
    try {
      this.db.stmts.deleteTask.run(id);
    } catch (err) {
      console.error(`[queue] 删除DB记录失败 ${id}:`, err);
    }
  }

  // ------------------------------------------
  // 启动恢复
  // ------------------------------------------

  /**
   * 从数据库恢复未完成的任务到内存队列。
   * - downloading -> paused（进程已死，用户需手动恢复或它会被自动调度）
   * - queued 保持不变（会被 tryStartNext 自动拾取）
   * - retrying 恢复剩余等待时间后自动重试
   * - paused 保持不变
   *
   * 应在服务启动、路由注册前调用。
   */
  restoreFromDb(): { restored: number; resumed: number } {
    if (!this.db) return { restored: 0, resumed: 0 };

    let restored = 0;
    let resumed = 0;

    try {
      const rows = this.db.stmts.getActiveTasks.all() as unknown[];
      for (const row of rows) {
        const task = rowToTask(row as never);

        // downloading 状态在重启后不可恢复（进程已死），降级为 paused
        if (task.status === 'downloading') {
          task.status = 'paused';
          task.speed = '';
          task.eta = '';
          this.persistTask(task);
        }

        if (task.status === 'retrying') {
          const retryAt = task.nextRetryAt ? Date.parse(task.nextRetryAt) : Date.now();
          this.armRetryTimer(task, Math.max(retryAt - Date.now(), 0));
        }

        this.tasks.set(task.id, task);
        restored++;

        // queued 状态的任务会被自动拾取执行
        if (task.status === 'queued' || task.status === 'retrying') {
          resumed++;
        }
      }

      if (restored > 0) {
        console.log(`[queue] 从数据库恢复 ${restored} 个任务（其中 ${resumed} 个将自动继续）`);
        // 触发调度，让恢复的 queued 任务开始执行
        this.tryStartNext();
      }
    } catch (err) {
      console.error('[queue] 恢复任务失败:', err);
    }

    return { restored, resumed };
  }

  // ------------------------------------------
  // 任务创建
  // ------------------------------------------

  /**
   * 批量创建下载任务并入队。
   * @returns 创建的任务 ID 列表
   */
  enqueue(
    inputs: CreateDownloadTaskInput[],
    conflictPolicy: DownloadConflictPolicy = 'reject',
  ): CreateDownloadResponse {
    if (this.options.gentleMode && inputs.length > this.gentleBatchLimit()) {
      throw new AppError(
        'INVALID_PARAM',
        `温和下载模式一次最多添加 ${this.gentleBatchLimit()} 个任务，请分批提交。单个任务不受此限制`,
      );
    }
    const taskIds: string[] = [];
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const { plans, conflicts, renamed } = this.planDownloads(inputs, conflictPolicy, date);

    // reject 模式保证批量请求的原子性：有任意冲突时，一个任务也不创建。
    if (conflicts.length > 0) {
      return { taskIds, conflicts, renamed: [] };
    }

    // 先创建所有父目录，避免中途失败后留下半批任务。
    for (const plan of plans) {
      fs.mkdirSync(path.dirname(plan.outputPath), { recursive: true });
    }

    for (const { input, outputPath } of plans) {
      const taskId = randomUUID();
      const container = input.container ?? 'mp4';

      const task: DownloadTask = {
        id: taskId,
        videoId: input.videoId,
        title: input.title,
        ...(input.playlistTitle ? { playlistTitle: input.playlistTitle } : {}),
        ...(input.playlistIndex ? { playlistIndex: input.playlistIndex } : {}),
        formatId: input.formatId ?? this.defaultFormatSelector(container),
        container,
        outputPath,
        subtitleLangs: input.subtitleLangs ?? [],
        subtitleMode: input.subtitleMode ?? 'none',
        autoSubtitle: input.autoSubtitle ?? false,
        status: 'queued',
        progress: 0,
        speed: '',
        eta: '',
        downloadedBytes: 0,
        totalBytes: 0,
        estimatedBytes: Number.isFinite(input.estimatedBytes) && (input.estimatedBytes ?? 0) > 0
          ? Math.min(Math.floor(input.estimatedBytes!), Number.MAX_SAFE_INTEGER)
          : 0,
        retryCount: 0,
        maxRetries: this.options.maxRetries,
        createdAt: now,
      };

      this.tasks.set(taskId, task);
      this.persistTask(task);
      taskIds.push(taskId);
    }

    // 尝试启动排队任务
    this.tryStartNext();

    return { taskIds, conflicts: [], renamed };
  }

  private planDownloads(
    inputs: CreateDownloadTaskInput[],
    conflictPolicy: DownloadConflictPolicy,
    date: string,
  ): { plans: PlannedDownload[]; conflicts: DownloadConflict[]; renamed: RenamedDownload[] } {
    const occupied = new Map<string, OccupiedOutput>();
    const plans: PlannedDownload[] = [];
    const conflicts: DownloadConflict[] = [];
    const renamed: RenamedDownload[] = [];

    for (const task of this.tasks.values()) {
      if (!DUPLICATE_BLOCKING_STATUSES.has(task.status)) continue;
      occupied.set(normalizeOutputPath(task.outputPath), {
        reason: 'existing_task',
        existingTaskId: task.id,
      });
    }

    inputs.forEach((input, inputIndex) => {
      const baseOutputPath = this.buildOutputPath(input, date);
      const baseKey = normalizeOutputPath(baseOutputPath);
      const occupiedOutput = occupied.get(baseKey);
      const conflict = fs.existsSync(baseOutputPath)
        ? { reason: 'file_exists' as const }
        : occupiedOutput;

      if (conflict && conflictPolicy === 'reject') {
        conflicts.push({
          inputIndex,
          title: input.title,
          outputPath: baseOutputPath,
          reason: conflict.reason,
          ...(conflict.existingTaskId ? { existingTaskId: conflict.existingTaskId } : {}),
        });
        // 后续同名输入仍应被标记为批内重复。
        occupied.set(baseKey, { reason: 'batch_duplicate' });
        return;
      }

      const outputPath = conflict
        ? findAvailableOutputPath(baseOutputPath, occupied)
        : baseOutputPath;
      if (outputPath !== baseOutputPath) {
        renamed.push({ inputIndex, title: input.title, outputPath });
      }
      occupied.set(normalizeOutputPath(outputPath), { reason: 'batch_duplicate' });
      plans.push({ input, outputPath });
    });

    return { plans, conflicts, renamed };
  }

  private buildOutputPath(input: CreateDownloadTaskInput, date: string): string {
    const container = input.container ?? 'mp4';
    const namingCtx: NamingContext = {
      course: input.playlistTitle,
      date,
      num: input.playlistIndex?.toString().padStart(2, '0'),
      title: input.title,
      ext: container,
    };
    const relativePath = this.namingService.apply(this.options.namingTemplate, namingCtx);
    const outputPath = path.resolve(this.options.downloadPath, relativePath);
    const relativeToRoot = path.relative(this.options.downloadPath, outputPath);
    if (
      relativeToRoot === '..' ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new AppError('PATH_NOT_ALLOWED', '命名规则生成的路径超出下载目录');
    }
    return outputPath;
  }

  // ------------------------------------------
  // 查询
  // ------------------------------------------

  getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  getQueueStatus(): QueueStatus {
    const tasks = this.getAllTasks();
    return {
      tasks,
      active: tasks.filter((t) => t.status === 'downloading').length,
      waiting: tasks.filter((t) => t.status === 'queued' || t.status === 'retrying').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
    };
  }

  // ------------------------------------------
  // 生命周期控制
  // ------------------------------------------

  /** 暂停任务：终止子进程，保留部分文件，标记为 paused */
  pause(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `任务不存在: ${id}`);
    }
    if (task.status !== 'downloading' && task.status !== 'queued' && task.status !== 'retrying') {
      throw new AppError('INVALID_STATE', `任务当前状态(${task.status})不可暂停`);
    }

    // 如果正在下载，终止子进程
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
    }
    this.clearRetryTimer(id);

    task.status = 'paused';
    task.speed = '';
    task.eta = '';
    task.nextRetryAt = undefined;
    this.persistTask(task);

    // 暂停释放了执行槽位，尝试启动下一个
    this.tryStartNext();
  }

  /** 恢复任务：重新标记为 queued，yt-dlp --continue 会自动续传 */
  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `任务不存在: ${id}`);
    }
    if (task.status !== 'paused' && task.status !== 'failed') {
      throw new AppError('INVALID_STATE', `任务当前状态(${task.status})不可恢复`);
    }
    if (this.controllers.has(id)) {
      throw new AppError('INVALID_STATE', '任务进程仍在暂停中，请稍后再恢复');
    }

    task.status = 'queued';
    task.error = undefined;
    task.errorCode = undefined;
    task.retryCount = 0;
    task.maxRetries = this.options.maxRetries;
    task.nextRetryAt = undefined;
    this.persistTask(task);

    this.tryStartNext();
  }

  /** 从持久化历史恢复一个失败任务，重启应用后仍可一键重试。 */
  retryFailedTask(task: DownloadTask): QueueStatus {
    if (task.status !== 'failed') {
      throw new AppError('INVALID_STATE', '只有失败任务可以重新下载');
    }

    const current = this.tasks.get(task.id) ?? { ...task };
    if (current.status !== 'failed') {
      throw new AppError('INVALID_STATE', `任务当前状态(${current.status})不可重新下载`);
    }
    this.tasks.set(current.id, current);
    this.resume(current.id);
    return this.getQueueStatus();
  }

  /** 取消任务：终止子进程，删除部分文件，标记为 cancelled */
  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `任务不存在: ${id}`);
    }
    if (!['downloading', 'queued', 'retrying', 'paused'].includes(task.status)) {
      throw new AppError('INVALID_STATE', `任务当前状态(${task.status})不可取消`);
    }

    // 终止子进程
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
    }
    this.clearRetryTimer(id);

    task.status = 'cancelled';
    task.speed = '';
    task.eta = '';
    task.nextRetryAt = undefined;
    this.persistTask(task);

    // 正在下载时必须等子进程完全退出再删分片，避免 Windows 文件句柄竞态。
    if (!controller) this.downloadService.discardTaskArtifacts?.(task);

    this.tryStartNext();
  }

  /** 从列表中移除任务（仅允许非下载中状态）。同时从数据库删除 */
  remove(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `任务不存在: ${id}`);
    }
    if (task.status === 'downloading') {
      throw new AppError('INVALID_STATE', '下载中的任务不可直接移除，请先取消');
    }
    if (this.controllers.has(id)) {
      throw new AppError('INVALID_STATE', '任务进程仍在停止，请稍后再移除');
    }

    this.clearRetryTimer(id);
    this.downloadService.cleanupTaskTempArtifacts?.(task);
    this.tasks.delete(id);
    this.deleteTaskFromDb(id);
    this.tryStartNext();
  }

  /** 清空历史时同步移除内存中的终态任务，防止界面出现幽灵记录。 */
  forgetTerminalTasks(): number {
    const terminalTasks = this.getAllTasks().filter(
      (task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled',
    );
    const stoppingTask = terminalTasks.find((task) => this.controllers.has(task.id));
    if (stoppingTask) {
      throw new AppError('INVALID_STATE', `任务“${stoppingTask.title}”仍在停止，请稍后再清空历史`);
    }

    for (const task of terminalTasks) {
      this.clearRetryTimer(task.id);
      this.downloadService.cleanupTaskTempArtifacts?.(task);
      this.tasks.delete(task.id);
    }
    return terminalTasks.length;
  }

  // ------------------------------------------
  // 内部：调度与执行
  // ------------------------------------------

  /** 尝试启动队列中等待的任务（受并发数限制） */
  private tryStartNext(): void {
    if (this.shuttingDown) return;
    const firstQueued = this.findNextQueued();
    if (!firstQueued) {
      this.clearGentleCooldownTimer();
      return;
    }
    if (this.options.gentleMode) {
      const remaining = this.gentleCooldownDeadline - Date.now();
      if (remaining > 0) {
        this.armGentleCooldownTimer(remaining);
        return;
      }
      this.gentleCooldownDeadline = 0;
      this.clearGentleCooldownTimer();
    }

    while (this.activeCount < this.effectiveMaxConcurrent()) {
      // 找到最早入队的 queued 任务
      const nextTask = this.findNextQueued();
      if (!nextTask) break;

      // 提前递增计数：executeTask 是 async 的，若在协程内才 ++，
      // 同步 while 循环看不到变化，可能突破并发上限。
      this.activeCount++;

      // 异步启动（不 await：tryStartNext 本身是同步的）
      void this.executeTask(nextTask);
    }
  }

  private findNextQueued(): DownloadTask | undefined {
    let earliest: DownloadTask | undefined;
    for (const task of this.tasks.values()) {
      if (task.status !== 'queued') continue;
      if (!earliest || task.createdAt < earliest.createdAt) {
        earliest = task;
      }
    }
    return earliest;
  }

  /** 执行单个下载任务（异步，不阻塞调度器） */
  private async executeTask(task: DownloadTask): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    // activeCount 已在 tryStartNext() 中递增，此处不再 ++
    task.status = 'downloading';
    task.progress = 0;
    task.error = undefined;
    task.errorCode = undefined;
    task.nextRetryAt = undefined;
    this.persistTask(task);

    // 进度持久化节流：避免每次进度回调都写 DB（高频写影响性能）
    let lastPersistAt = Date.now();
    const PERSIST_INTERVAL_MS = 2000;

    try {
      await this.downloadService.download(task, controller.signal, {
        onProgress: (info: ProgressInfo) => {
          task.progress = info.percent;
          task.speed = `${info.speed}${info.speedUnit}`;
          task.eta = info.eta;
          task.downloadedBytes = info.totalSize > 0
            ? Math.round((info.percent / 100) * info.totalSize)
            : 0;
          task.totalBytes = info.totalSize;

          // 节流持久化进度
          const now = Date.now();
          if (now - lastPersistAt > PERSIST_INTERVAL_MS) {
            lastPersistAt = now;
            this.persistTask(task);
          }
        },
        onWarning: (line: string) => {
          // 非致命警告，仅记录到服务端日志
          console.warn(`[download:${task.id}] ${line}`);
        },
      });

      task.status = 'completed';
      task.progress = 100;
      task.speed = '';
      task.eta = '';
      task.completedAt = new Date().toISOString();
      task.nextRetryAt = undefined;
      this.persistTask(task);
      console.log(`[queue] 任务完成: ${task.title}`);
    } catch (err) {
      if (controller.signal.aborted) {
        // 被 abort（暂停或取消），状态已由 pause()/cancel() 设置
        if (this.tasks.get(task.id)?.status === 'cancelled') {
          this.downloadService.discardTaskArtifacts?.(task);
        }
      } else if (err instanceof AppError) {
        if (this.options.gentleMode && PROTECTIVE_ERROR_CODES.has(err.code)) {
          task.status = 'failed';
          task.error = err.message;
          task.errorCode = err.code;
          task.nextRetryAt = undefined;
          this.persistTask(task);
          this.pauseTasksAfterProtection(err);
          console.error(`[queue] 触发保护性错误，已暂停后续任务: ${task.title} - ${err.message}`);
        } else if (RETRYABLE_ERROR_CODES.has(err.code) && task.retryCount < task.maxRetries) {
          this.scheduleRetry(task, err);
        } else {
          task.status = 'failed';
          task.error = err.message;
          task.errorCode = err.code;
          task.nextRetryAt = undefined;
          this.persistTask(task);
          console.error(`[queue] 任务失败: ${task.title} - ${err.message}`);
        }
      } else {
        task.status = 'failed';
        task.error = '未知错误';
        task.errorCode = 'UNKNOWN';
        this.persistTask(task);
        console.error(`[queue] 任务异常: ${task.title}`, err);
      }
    } finally {
      this.controllers.delete(task.id);
      // 统一在执行流程结束时释放并发槽位，避免 pause()/cancel() 重复扣减。
      this.activeCount--;
      if (this.options.gentleMode && !controller.signal.aborted) {
        this.gentleCooldownDeadline = Date.now() + this.gentleCooldownSeconds() * 1_000;
      }
      // 任务结束，尝试启动下一个
      this.tryStartNext();
    }
  }

  private scheduleRetry(task: DownloadTask, error: AppError): void {
    task.retryCount += 1;
    const delayMs = this.retryDelayCalculator(task.retryCount);
    task.status = 'retrying';
    task.speed = '';
    task.eta = '';
    task.error = error.message;
    task.errorCode = error.code;
    task.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    this.persistTask(task);
    this.armRetryTimer(task, delayMs);
    const delayLabel = delayMs < 1_000 ? '少于 1 秒' : `${Math.ceil(delayMs / 1000)} 秒`;
    console.warn(
      `[queue] 任务暂时失败，将在 ${delayLabel}后自动重试 ` +
      `(${task.retryCount}/${task.maxRetries}): ${task.title} - ${error.message}`,
    );
  }

  private armRetryTimer(task: DownloadTask, delayMs: number): void {
    this.clearRetryTimer(task.id);
    const timer = setTimeout(() => {
      this.retryTimers.delete(task.id);
      const current = this.tasks.get(task.id);
      if (!current || current.status !== 'retrying') return;
      current.status = 'queued';
      current.nextRetryAt = undefined;
      this.persistTask(current);
      this.tryStartNext();
    }, Math.max(delayMs, 0));
    timer.unref?.();
    this.retryTimers.set(task.id, timer);
  }

  private clearRetryTimer(id: string): void {
    const timer = this.retryTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  private pauseTasksAfterProtection(error: AppError): void {
    for (const current of this.tasks.values()) {
      if (current.status !== 'queued' && current.status !== 'retrying') continue;
      this.clearRetryTimer(current.id);
      current.status = 'paused';
      current.speed = '';
      current.eta = '';
      current.nextRetryAt = undefined;
      current.errorCode = error.code;
      current.error = `${error.message}；后续任务已暂停，请处理后逐个恢复。`;
      this.persistTask(current);
    }
  }

  private effectiveMaxConcurrent(): number {
    return this.options.gentleMode ? 1 : this.options.maxConcurrent;
  }

  private gentleBatchLimit(): number {
    return this.options.gentleBatchLimit ?? DEFAULT_GENTLE_SETTINGS.gentleBatchLimit;
  }

  private gentleCooldownSeconds(): number {
    return this.options.gentleCooldownSeconds ?? DEFAULT_GENTLE_SETTINGS.gentleCooldownSeconds;
  }

  private armGentleCooldownTimer(delayMs: number): void {
    if (this.gentleCooldownTimer) return;
    const timer = setTimeout(() => {
      this.gentleCooldownTimer = undefined;
      this.tryStartNext();
    }, Math.max(delayMs, 0));
    timer.unref?.();
    this.gentleCooldownTimer = timer;
  }

  private clearGentleCooldownTimer(): void {
    if (!this.gentleCooldownTimer) return;
    clearTimeout(this.gentleCooldownTimer);
    this.gentleCooldownTimer = undefined;
  }

  private clearGentleCooldown(): void {
    this.gentleCooldownDeadline = 0;
    this.clearGentleCooldownTimer();
  }

  // ------------------------------------------
  // 工具
  // ------------------------------------------

  /** 根据容器类型生成默认的 yt-dlp 格式选择器 */
  private defaultFormatSelector(container: string): string {
    switch (container) {
      case 'mp3':
      case 'm4a':
        return 'bestaudio/best';
      case 'webm':
        return 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]';
      case 'mp4':
      default:
        return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
  }
}

function normalizeOutputPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function findAvailableOutputPath(
  baseOutputPath: string,
  occupied: ReadonlyMap<string, OccupiedOutput>,
): string {
  const parsed = path.parse(baseOutputPath);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
    if (!fs.existsSync(candidate) && !occupied.has(normalizeOutputPath(candidate))) {
      return candidate;
    }
  }
  throw new AppError('DOWNLOAD_CONFLICT', '无法为重复下载生成可用文件名');
}
