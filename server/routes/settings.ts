import { Router } from 'express';
import type { SettingsService } from '../services/settings.service.ts';
import type { QueueService } from '../services/queue.service.ts';
import type { SubtitleService } from '../services/subtitle.service.ts';
import type { UpdateAppSettingsInput } from '../types/settings.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

export function createSettingsRouter(
  settingsService: SettingsService,
  queueService: QueueService,
  subtitleService: SubtitleService,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(ok(settingsService.getStatus()));
  });

  router.put('/', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new AppError('INVALID_PARAM', '设置请求体必须是 JSON 对象');
    }
    const allowedKeys = new Set(['downloadPath', 'maxConcurrent', 'maxRetries', 'namingTemplate', 'proxyUrl']);
    const unknownKeys = Object.keys(req.body as Record<string, unknown>)
      .filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      throw new AppError('INVALID_PARAM', `不支持的设置字段: ${unknownKeys.join(', ')}`);
    }

    const status = settingsService.update(req.body as UpdateAppSettingsInput);
    const settings = settingsService.getSettings();
    queueService.updateOptions(settings);
    subtitleService.updateOutputRoot(settings.downloadPath);
    res.json(ok(status));
  });

  return router;
}
