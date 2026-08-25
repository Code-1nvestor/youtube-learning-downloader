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
const ALLOWED_CONTAINERS = new Set(['mp4', 'webm', 'mp3', 'm4a']);
const ALLOWED_SUBTITLE_MODES = new Set(['none', 'embed', 'separate']);
const AUDIO_CONTAINERS = new Set(['mp3', 'm4a']);
const ALLOWED_AUTHENTICATION = new Set(['anonymous', 'cookie', 'auto']);
const ALLOWED_ACCESS_MODES = new Set(['pot', 'direct']);

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

      if (body.conflictPolicy !== undefined && !['reject', 'rename'].includes(body.conflictPolicy)) {
        throw new AppError('INVALID_PARAM', 'conflictPolicy 仅支持 reject 或 rename');
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
        if (
          task.container !== undefined &&
          (typeof task.container !== 'string' || !ALLOWED_CONTAINERS.has(task.container))
        ) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].container 仅支持 mp4、webm、mp3 或 m4a`);
        }
        if (
          task.accessMode !== undefined &&
          (typeof task.accessMode !== 'string' || !ALLOWED_ACCESS_MODES.has(task.accessMode))
        ) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].accessMode 仅支持 pot 或 direct`);
        }
        if (
          task.subtitleMode !== undefined &&
          (typeof task.subtitleMode !== 'string' || !ALLOWED_SUBTITLE_MODES.has(task.subtitleMode))
        ) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].subtitleMode 仅支持 none、embed 或 separate`);
        }
        if (
          task.subtitleLangs !== undefined &&
          (!Array.isArray(task.subtitleLangs) || task.subtitleLangs.some((language) => typeof language !== 'string'))
        ) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].subtitleLangs 必须是语言代码数组`);
        }
        if (
          task.authentication !== undefined &&
          (typeof task.authentication !== 'string' || !ALLOWED_AUTHENTICATION.has(task.authentication))
        ) {
          throw new AppError('INVALID_PARAM', `tasks[${i}].authentication 仅支持 anonymous、cookie 或 auto`);
        }
        const container = task.container ?? 'mp4';
        if (AUDIO_CONTAINERS.has(container) && task.subtitleMode === 'embed') {
          throw new AppError(
            'INVALID_PARAM',
            `tasks[${i}] 纯音频 ${container.toUpperCase()} 不支持嵌入字幕，请改用 separate 外挂字幕`,
          );
        }
      }

      res.json(ok(queueService.enqueue(body.tasks, body.conflictPolicy ?? 'reject')));
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
        authentication: video.authentication,
        accessMode: video.accessMode,
      }));
    }),
  );

  return router;
}
