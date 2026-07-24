/**
 * app.ts — Express 应用装配
 *
 * 中间件顺序（重要，勿随意调换）：
 * 1. express.json()        —— 请求体解析
 * 2. 业务路由              —— /api/health, /api/resolve, ...
 * 3. notFoundHandler       —— 未匹配路由的 404
 * 4. errorHandler          —— 统一错误出口（必须在最后注册）
 *
 * 新增路由的方式：在 createApp 中 app.use('/api/xxx', createXxxRouter(service))
 */

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { AppConfig } from './config.ts';
import type { YtDlpService } from './core/yt-dlp.service.ts';
import type { QueueService } from './services/queue.service.ts';
import { createResolveRouter } from './routes/resolve.ts';
import { createDownloadRouter } from './routes/download.ts';
import { createQueueRouter } from './routes/queue.ts';
import { AppError, isAppError } from './types/errors.ts';
import { ok, fail } from './types/result.ts';

export function createApp(
  config: AppConfig,
  ytDlpService: YtDlpService,
  queueService: QueueService,
): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // —— 健康检查（前端联调与部署探活使用）——
  app.get('/api/health', (_req, res) => {
    res.json(ok({ status: 'ok', uptime: process.uptime() }));
  });

  // —— 业务路由 ——
  app.use('/api/resolve', createResolveRouter(ytDlpService));
  app.use('/api/download', createDownloadRouter(ytDlpService, queueService));
  app.use('/api/queue', createQueueRouter(queueService));
  // Phase 4+ 扩展位: app.use('/api/subtitle', ...)

  // —— 404 ——
  app.use(notFoundHandler);

  // —— 统一错误出口 ——
  app.use(errorHandler(config.isDev));

  return app;
}

function notFoundHandler(_req: Request, res: Response): void {
  res
    .status(404)
    .json(fail(new AppError('INVALID_URL', '接口不存在', undefined, 404)));
}

/**
 * 统一错误处理中间件：
 * - AppError → 按 statusCode 返回结构化错误
 * - 其他异常 → 500 UNKNOWN，不向前端泄漏堆栈
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
