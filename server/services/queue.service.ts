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
 *              failed -> (retry) -> queued -> downloading
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
} from '../types/download.ts';
import { AppError } from '../types/errors.ts';

export interface QueueServiceOptions {
  /** 最大并发下载数 */
  maxConcurrent: number;
  /** 默认下载根目录 */
  downloadPath: string;
  /** 默认命名模板 */
  namingTemplate: string;
}

export class QueueService {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly downloadService: DownloadService;
  private readonly namingService: NamingService;
  private readonly options: QueueServiceOptions;
  private readonly db: DbContext | null;
  private activeCount = 0;

  constructor(
    downloadService: DownloadService,
    namingService: NamingService,
    options: QueueServiceOptions,
    db: DbContext | null = null,
  ) {
    this.downloadService = downloadService;
    this.namingService = namingService;
    this.options = options;
    this.db = db;
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

        this.tasks.set(task.id, task);
        restored++;

        // queued 状态的任务会被自动拾取执行
        if (task.status === 'queued') {
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
  enqueue(inputs: CreateDownloadTaskInput[]): string[] {
    const taskIds: string[] = [];
    const now = new Date().toISOString();
    const date = now.slice(0, 10);

    for (const input of inputs) {
      const taskId = randomUUID();
      const container = input.container ?? 'mp4';

      // 计算输出路径
      const namingCtx: NamingContext = {
        course: input.playlistTitle,
        date,
        num: input.playlistIndex?.toString().padStart(2, '0'),
        title: input.title,
        ext: container,
      };
      const relativePath = this.namingService.apply(this.options.namingTemplate, namingCtx);
      const outputPath = path.resolve(this.options.downloadPath, relativePath);

      // 确保目录存在
      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });

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
        createdAt: now,
      };

      this.tasks.set(taskId, task);
      this.persistTask(task);
      taskIds.push(taskId);
    }

    // 尝试启动排队任务
    this.tryStartNext();

    return taskIds;
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
      waiting: tasks.filter((t) => t.status === 'queued').length,
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
      throw new AppError('INVALID_URL', `任务不存在: ${id}`, undefined, 404);
    }
    if (task.status !== 'downloading' && task.status !== 'queued') {
      throw new AppError('INVALID_URL', `任务当前状态(${task.status})不可暂停`);
    }

    // 如果正在下载，终止子进程
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      this.controllers.delete(id);
      this.activeCount--;
    }

    task.status = 'paused';
    task.speed = '';
    task.eta = '';
    this.persistTask(task);

    // 暂停释放了执行槽位，尝试启动下一个
    this.tryStartNext();
  }

  /** 恢复任务：重新标记为 queued，yt-dlp --continue 会自动续传 */
  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('INVALID_URL', `任务不存在: ${id}`, undefined, 404);
    }
    if (task.status !== 'paused' && task.status !== 'failed') {
      throw new AppError('INVALID_URL', `任务当前状态(${task.status})不可恢复`);
    }

    task.status = 'queued';
    task.error = undefined;
    this.persistTask(task);

    this.tryStartNext();
  }

  /** 取消任务：终止子进程，删除部分文件，标记为 cancelled */
  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('INVALID_URL', `任务不存在: ${id}`, undefined, 404);
    }

    // 终止子进程
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      this.controllers.delete(id);
      this.activeCount--;
    }

    task.status = 'cancelled';
    task.speed = '';
    task.eta = '';
    this.persistTask(task);

    // 删除部分文件（静默失败：文件可能不存在）
    try {
      if (fs.existsSync(task.outputPath)) {
        fs.unlinkSync(task.outputPath);
      }
    } catch {
      // 忽略：文件删除失败不阻断流程
    }

    this.tryStartNext();
  }

  /** 从列表中移除任务（仅允许非下载中状态）。同时从数据库删除 */
  remove(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError('INVALID_URL', `任务不存在: ${id}`, undefined, 404);
    }
    if (task.status === 'downloading') {
      throw new AppError('INVALID_URL', '下载中的任务不可直接移除，请先取消');
    }

    this.tasks.delete(id);
    this.deleteTaskFromDb(id);
  }

  // ------------------------------------------
  // 内部：调度与执行
  // ------------------------------------------

  /** 尝试启动队列中等待的任务（受并发数限制） */
  private tryStartNext(): void {
    while (this.activeCount < this.options.maxConcurrent) {
      // 找到最早入队的 queued 任务
      const nextTask = this.findNextQueued();
      if (!nextTask) break;

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
    this.activeCount++;
    task.status = 'downloading';
    task.progress = 0;
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
      this.persistTask(task);
      console.log(`[queue] 任务完成: ${task.title}`);
    } catch (err) {
      if (controller.signal.aborted) {
        // 被 abort（暂停或取消），状态已由 pause()/cancel() 设置
        // 此处无需再覆盖
      } else if (err instanceof AppError) {
        task.status = 'failed';
        task.error = err.message;
        this.persistTask(task);
        console.error(`[queue] 任务失败: ${task.title} - ${err.message}`);
      } else {
        task.status = 'failed';
        task.error = '未知错误';
        this.persistTask(task);
        console.error(`[queue] 任务异常: ${task.title}`, err);
      }
    } finally {
      this.controllers.delete(task.id);
      this.activeCount--;
      // 任务结束，尝试启动下一个
      this.tryStartNext();
    }
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
