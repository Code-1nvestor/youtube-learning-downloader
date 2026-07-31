/**
 * app.ts - Express 应用装配
 *
 * 中间件顺序（重要，勿随意调换）：
 * 1. express.json()        -- 请求体解析
 * 2. 业务路由              -- /api/health, /api/resolve, ...
 * 3. notFoundHandler       -- 未匹配路由的 404
 * 4. errorHandler          -- 统一错误出口（必须在最后注册）
 *
 * 新增路由的方式：在 createApp 中 app.use('/api/xxx', createXxxRouter(service))
 */

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.ts';
import type { YtDlpService } from './core/yt-dlp.service.ts';
import type { QueueService } from './services/queue.service.ts';
import type { CookieService } from './services/cookie.service.ts';
import type { SubtitleService } from './services/subtitle.service.ts';
import type { HistoryService } from './services/history.service.ts';
import type { SettingsService } from './services/settings.service.ts';
import type { RuntimeStatus } from './types/runtime.ts';
import { createResolveRouter } from './routes/resolve.ts';
import { createDownloadRouter } from './routes/download.ts';
import { createQueueRouter } from './routes/queue.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createSubtitleRouter } from './routes/subtitle.ts';
import { createHistoryRouter } from './routes/history.ts';
import { createSettingsRouter } from './routes/settings.ts';
import { AppError, isAppError } from './types/errors.ts';
import { ok, fail } from './types/result.ts';

export function createApp(
  config: AppConfig,
  ytDlpService: YtDlpService,
  queueService: QueueService,
  cookieService: CookieService,
  subtitleService: SubtitleService,
  historyService: HistoryService,
  settingsService: SettingsService,
  runtimeStatus: RuntimeStatus,
): Express {
  const app = express();

  // 上调到 2mb：Cookie 文件可能较大
  app.use(express.json({ limit: '2mb' }));

  // -- 健康检查（前端联调与部署探活使用）--
  app.get('/api/health', (_req, res) => {
    res.json(ok({ status: 'ok', uptime: process.uptime(), runtime: runtimeStatus }));
  });

  // -- 业务路由 --
  app.use('/api/resolve', createResolveRouter(ytDlpService));
  app.use('/api/download', createDownloadRouter(ytDlpService, queueService));
  app.use('/api/queue', createQueueRouter(queueService));
  app.use('/api/auth', createAuthRouter(cookieService));
  app.use('/api/subtitle', createSubtitleRouter(subtitleService));
  app.use('/api/history', createHistoryRouter(historyService));
  app.use('/api/settings', createSettingsRouter(settingsService, queueService, subtitleService));

  // In production the backend serves the Vite build, so the desktop app needs one local service.
  if (!config.isDev && fs.existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(config.webDistPath, 'index.html'));
    });
  }

  // -- 404 --
  app.use(notFoundHandler);

  // -- 统一错误出口 --
  app.use(errorHandler(config.isDev));

  return app;
}

function notFoundHandler(_req: Request, res: Response): void {
  res
    .status(404)
    .json(fail(new AppError('NOT_FOUND', '接口不存在')));
}

/**
 * 统一错误处理中间件：
 * - AppError -> 按 statusCode 返回结构化错误
 * - 其他异常 -> 500 UNKNOWN，不向前端泄漏堆栈
 */
function errorHandler(isDev: boolean) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (isAppError(err)) {
      res.status(err.statusCode).json(fail(err, isDev));
      return;
    }

    // 未预期异常：记录完整堆栈到服务端日志，前端只见 UNKNOWN
    console.error('[error] 未预期异常:', err);
    const unknown = new AppError('UNKNOWN', '服务器内部错误，请查看服务端日志');
    res.status(500).json(fail(unknown));
  };
}
