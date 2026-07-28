/**
 * routes/queue.ts — 队列管理路由
 *
 * GET    /api/queue                查询队列状态（全部任务 + 统计）
 * POST   /api/queue/:taskId/pause   暂停任务
 * POST   /api/queue/:taskId/resume  恢复任务
 * POST   /api/queue/:taskId/cancel  取消任务
 * DELETE /api/queue/:taskId         从列表移除任务
 *
 * 所有写操作成功后返回更新后的队列状态，减少前端额外轮询。
 */

import { Router } from 'express';
import type { QueueService } from '../services/queue.service.ts';
import { ok } from '../types/result.ts';

export function createQueueRouter(queueService: QueueService): Router {
  const router = Router();

  // —— 查询队列状态 ——
  router.get('/', (_req, res) => {
    res.json(ok(queueService.getQueueStatus()));
  });

  // —— 暂停任务 ——
  router.post('/:taskId/pause', (req, res) => {
    queueService.pause(req.params.taskId);
    res.json(ok(queueService.getQueueStatus()));
  });

  // —— 恢复任务 ——
  router.post('/:taskId/resume', (req, res) => {
    queueService.resume(req.params.taskId);
    res.json(ok(queueService.getQueueStatus()));
  });

  // —— 取消任务 ——
  router.post('/:taskId/cancel', (req, res) => {
    queueService.cancel(req.params.taskId);
    res.json(ok(queueService.getQueueStatus()));
  });

  // —— 移除任务 ——
  router.delete('/:taskId', (req, res) => {
    queueService.remove(req.params.taskId);
    res.json(ok(queueService.getQueueStatus()));
  });

  return router;
}
