import { Router } from 'express';
import { asyncHandler } from '../core/utils.ts';
import type { QueueService } from '../services/queue.service.ts';
import type { ToolUpdateService } from '../services/tool-update.service.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

export function createRuntimeRouter(
  toolUpdateService: ToolUpdateService,
  queueService: QueueService,
): Router {
  const router = Router();

  router.get('/yt-dlp', (_req, res) => {
    res.json(ok(toolUpdateService.getStatus()));
  });

  router.post(
    '/yt-dlp/update',
    asyncHandler(async (_req, res) => {
      if (queueService.getQueueStatus().active > 0) {
        throw new AppError('INVALID_PARAM', '请先暂停正在下载的任务，再更新 yt-dlp');
      }
      res.json(ok(await toolUpdateService.updateYtDlp()));
    }),
  );

  return router;
}
