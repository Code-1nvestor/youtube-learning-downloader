/**
 * routes/resolve.ts — URL 解析路由
 *
 * GET /api/resolve?url=<youtube_url_or_keyword>
 *
 * 成功: 200 { success: true, data: ResolveResult }
 * 失败: 4xx/5xx { success: false, error: { code, message } }
 *
 * 设计要点：
 * - 服务实例通过工厂函数注入（而非模块级单例），便于测试时替换 mock。
 * - 路由层只做"参数校验 + 调用服务 + 包装响应"，不含业务逻辑。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { YtDlpService } from '../core/yt-dlp.service.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

/** async 路由包装器：把 reject 的错误交给 Express 错误中间件（Express 4 不自动捕获） */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createResolveRouter(service: YtDlpService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const url = req.query.url;

      if (typeof url !== 'string' || url.trim().length === 0) {
        throw new AppError('MISSING_PARAM', '缺少必需参数: url（YouTube 链接或关键词）', {
          example: '/api/resolve?url=https://www.youtube.com/watch?v=xxxx',
        });
      }

      const result = await service.resolve(url);
      res.json(ok(result));
    }),
  );

  return router;
}
