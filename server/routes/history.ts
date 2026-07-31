/**
 * routes/history.ts - 下载历史路由
 *
 * GET    /api/history           分页查询历史记录（completed/failed/cancelled）
 * GET    /api/history/:id       查询单条终态任务（桌面文件操作使用）
 * POST   /api/history/:id/retry 重新下载失败任务
 * DELETE /api/history/:id       删除单条历史记录
 * DELETE /api/history           清空所有历史记录
 *
 * 查询参数：
 * - page: 页码（从 1 开始，默认 1）
 * - pageSize: 每页条数（默认 50，最大 200）
 */

import { Router, type Request, type Response } from 'express';
import type { HistoryService } from '../services/history.service.ts';
import type { QueueService } from '../services/queue.service.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

export function createHistoryRouter(historyService: HistoryService, queueService: QueueService): Router {
  const router = Router();

  // -- 分页查询历史 --
  router.get('/', (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const result = historyService.getHistory(page, pageSize);
    res.json(ok(result));
  });

  // -- 查询单条终态任务：桌面主进程只凭任务 ID 获取可信输出路径 --
  router.get('/:id', (req, res) => {
    const id = req.params.id;
    if (!id) {
      throw new AppError('MISSING_PARAM', '缺少历史记录 ID');
    }
    const task = historyService.getHistoryItem(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `历史记录不存在: ${id}`);
    }
    res.json(ok(task));
  });

  // -- 失败任务重新下载：历史记录来自本机数据库，不接受客户端覆盖路径或格式。 --
  router.post('/:id/retry', (req, res) => {
    const id = req.params.id;
    if (!id) {
      throw new AppError('MISSING_PARAM', '缺少历史记录 ID');
    }
    const task = historyService.getHistoryItem(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `历史记录不存在: ${id}`);
    }
    res.json(ok(queueService.retryFailedTask(task)));
  });

  // -- 清空所有历史（必须在 /:id 之前注册，否则会被 :id 匹配）--
  router.delete('/', (_req, res) => {
    const total = historyService.getHistory(1, 1).total;
    queueService.forgetTerminalTasks();
    const deleted = historyService.clearHistory();
    res.json(ok({ deleted: Math.max(total, deleted) }));
  });

  // -- 删除单条历史 --
  router.delete('/:id', (req, res) => {
    const id = req.params.id;
    if (!id) {
      throw new AppError('MISSING_PARAM', '缺少历史记录 ID');
    }
    const queueTask = queueService.getTask(id);
    if (queueTask) {
      if (!['completed', 'failed', 'cancelled'].includes(queueTask.status)) {
        throw new AppError(
          'INVALID_STATE',
          `任务当前状态(${queueTask.status})不属于历史记录，不能删除`,
        );
      }
      queueService.remove(id);
      res.json(ok({ deleted: true, id }));
      return;
    }

    if (!historyService.getHistoryItem(id)) {
      throw new AppError('NOT_FOUND', `历史记录不存在: ${id}`);
    }
    historyService.deleteHistory(id);
    res.json(ok({ deleted: true, id }));
  });

  return router;
}

function parsePage(v: unknown): number {
  if (v === undefined || v === null || Array.isArray(v)) return 1;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parsePageSize(v: unknown): number {
  if (v === undefined || v === null || Array.isArray(v)) return 50;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}
