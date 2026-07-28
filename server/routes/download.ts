/**
 * routes/download.ts — 下载相关路由
 *
 * POST /api/download          创建下载任务（支持批量）
 * GET  /api/download/formats  查询视频可用格式列表
 *
 * 设计要点：
 * - 创建任务时只做参数校验，实际下载由 QueueService 异步调度
 * - formats 接口复用 YtDlpService.resolve（--dump-json 已包含格式信息）
 */

import { Router } from 'express';
import type { YtDlpService } from '../core/yt-dlp.service.ts';
import type { QueueService } from '../services/queue.service.ts';
import { asyncHandler } from '../core/utils.ts';
import type { CreateDownloadRequest } from '../types/download.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

/** YouTube videoId 格式：11 位 [\w-] 字符 */
const VIDEO_ID_RE = /^[\w-]{11}$/;

export function createDownloadRouter(
  ytDlpService: YtDlpService,
  queueService: QueueService,
): Router {
  const router = Router();

  // —— 创建下载任务 ——
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body as CreateDownloadRequest;

      if (!body?.tasks || !Array.isArray(body.tasks) || body.tasks.length === 0) {
        throw new AppError('MISSING_PARAM', '请求体需包含 tasks 数组', {
          example: { tasks: [{ videoId: 'xxxx', title: '视频标题' }] },
        });
      }

      // 校验每个任务的基本字段
      for (const [i, task] of body.tasks.entries()) {
        if (!task.videoId || typeof task.videoId !== 'string') {
          throw new AppError('MISSING_PARAM', `tasks[${i}].videoId 为空或非字符串`);
        }
        if (!VIDEO_ID_RE.test(task.videoId)) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].videoId 格式非法（需 11 位 [\\w-] 字符）`, {
            received: task.videoId,
          });
        }
        if (!task.title || typeof task.title !== 'string') {
          throw new AppError('MISSING_PARAM', `tasks[${i}].title 为空或非字符串`);
        }
      }

      const taskIds = queueService.enqueue(body.tasks);
      res.json(ok({ taskIds }));
    }),
  );

  // —— 查询视频可用格式 ——
  router.get(
    '/formats',
    asyncHandler(async (req, res) => {
      const url = req.query.url;
      if (typeof url !== 'string' || url.trim().length === 0) {
        throw new AppError('MISSING_PARAM', '缺少必需参数: url');
      }

      // 复用解析服务获取格式列表
      const result = await ytDlpService.resolve(url);
      const video = result.videos[0];
      if (!video) {
        throw new AppError('VIDEO_UNAVAILABLE', '未找到视频信息');
      }

      res.json(ok({
        videoId: video.id,
        title: video.title,
        formats: video.formats,
        subtitles: video.subtitles,
      }));
    }),
  );

  return router;
}
