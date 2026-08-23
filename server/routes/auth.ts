/**
 * routes/auth.ts - Cookie 配置路由
 *
 * GET    /api/auth/cookie              查询当前 Cookie 配置状态
 * POST   /api/auth/cookie/file         从 Netscape 文件内容配置
 * POST   /api/auth/cookie/browser      从浏览器自动读取配置
 * DELETE /api/auth/cookie              清除配置
 *
 * 安全说明：
 * - 所有响应只暴露状态元信息，不返回 Cookie 内容
 * - file 模式接收文件内容字符串（前端可走 multipart 或 base64）
 */

import { Router } from 'express';
import type { CookieService } from '../services/cookie.service.ts';
import { asyncHandler } from '../core/utils.ts';
import type {
  ImportCookieSnapshotRequest,
  SetCookieFileRequest,
  SetCookieBrowserRequest,
} from '../types/auth.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

export function createAuthRouter(cookieService: CookieService, desktopApiToken = ''): Router {
  const router = Router();

  // -- 查询状态 --
  router.get('/cookie', asyncHandler(async (_req, res) => {
    res.json(ok(await cookieService.getStatusWithBrowserState()));
  }));

  // -- 从文件配置 --
  router.post(
    '/cookie/file',
    asyncHandler(async (req, res) => {
      const body = req.body as SetCookieFileRequest;
      if (!body?.content || typeof body.content !== 'string') {
        throw new AppError('MISSING_PARAM', '请求体需包含 content 字段（Cookie 文件内容）');
      }
      cookieService.setFromFile(body.content);
      res.json(ok(cookieService.getStatus()));
    }),
  );

  // 仅桌面主进程可写入专用登录 Cookie，Cookie 内容不会进入渲染进程。
  router.post(
    '/cookie/managed',
    asyncHandler(async (req, res) => {
      if (!desktopApiToken || req.get('x-desktop-token') !== desktopApiToken) {
        throw new AppError('PATH_NOT_ALLOWED', '仅桌面应用可以保存专用登录状态', undefined, 403);
      }
      const body = req.body as SetCookieFileRequest;
      if (!body?.content || typeof body.content !== 'string') {
        throw new AppError('MISSING_PARAM', '请求体需包含 content 字段（Cookie 文件内容）');
      }
      cookieService.setFromManagedBrowser(body.content);
      res.json(ok(cookieService.getStatus()));
    }),
  );

  router.post(
    '/cookie/snapshot',
    asyncHandler(async (req, res) => {
      const body = req.body as ImportCookieSnapshotRequest;
      if (body?.browser !== 'chrome') {
        throw new AppError('INVALID_PARAM', '当前快照导入仅支持 Chrome');
      }
      res.json(ok(await cookieService.importBrowserSnapshot(body.browser)));
    }),
  );

  // -- 从浏览器配置 --
  router.post(
    '/cookie/browser',
    asyncHandler(async (req, res) => {
      const body = req.body as SetCookieBrowserRequest;
      const allowed = ['chrome', 'edge', 'firefox', 'brave', 'safari'];
      if (!body?.browser || !allowed.includes(body.browser)) {
        throw new AppError('MISSING_PARAM', `browser 必须是: ${allowed.join(', ')}`);
      }
      cookieService.setFromBrowser(body.browser);
      res.json(ok(cookieService.getStatus()));
    }),
  );

  // -- 清除配置 --
  router.delete('/cookie', (_req, res) => {
    cookieService.clear();
    res.json(ok(cookieService.getStatus()));
  });

  return router;
}
