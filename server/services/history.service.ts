/**
 * services/history.service.ts - 下载历史查询服务
 *
 * 职责：提供历史记录的分页查询、删除、清空。
 * 不负责任务状态同步（那是 QueueService 的职责）。
 *
 * 设计决策：
 * - 分页用 LIMIT/OFFSET，个人工具数据量小（千级），无需游标分页
 * - completed_at DESC 优先展示最近完成的任务
 * - 当 dbContext 为 null（数据库初始化失败）时，所有方法返回空结果
 */

import type { DbContext } from '../db/database.ts';
import { rowToTask } from '../db/task-serializer.ts';
import type { DownloadTask } from '../types/download.ts';

const HISTORY_STATUSES = new Set<DownloadTask['status']>(['completed', 'failed', 'cancelled']);

export interface HistoryPage {
  tasks: DownloadTask[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class HistoryService {
  private readonly ctx: DbContext | null;

  constructor(ctx: DbContext | null) {
    this.ctx = ctx;
  }

  /** 分页查询历史记录（已完成/失败/取消） */
  getHistory(page = 1, pageSize = 50): HistoryPage {
    if (!this.ctx) {
      return { tasks: [], total: 0, page: 1, pageSize, totalPages: 1 };
    }

    const safePage = Math.max(1, page);
    const safeSize = Math.max(1, Math.min(200, pageSize));
    const offset = (safePage - 1) * safeSize;

    const countRow = this.ctx.stmts.getHistoryCount.get() as { count: number };
    const total = countRow?.count ?? 0;

    const rows = this.ctx.stmts.getHistory.all(safeSize, offset) as unknown[];
    const tasks = rows.map((r) => rowToTask(r as never));

    return {
      tasks,
      total,
      page: safePage,
      pageSize: safeSize,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    };
  }

  /** 按 ID 查询单条终态任务，供桌面端安全定位下载结果。 */
  getHistoryItem(id: string): DownloadTask | undefined {
    if (!this.ctx) return undefined;
    const row = this.ctx.stmts.getTaskById.get(id) as unknown;
    if (!row) return undefined;
    const task = rowToTask(row as never);
    return HISTORY_STATUSES.has(task.status) ? task : undefined;
  }

  /** 删除单条历史记录 */
  deleteHistory(id: string): void {
    if (!this.ctx) return;
    this.ctx.stmts.deleteTask.run(id);
  }

  /** 清空所有历史记录（不影响活跃任务） */
  clearHistory(): number {
    if (!this.ctx) return 0;
    const result = this.ctx.stmts.clearHistory.run();
    return Number(result.changes);
  }
}
