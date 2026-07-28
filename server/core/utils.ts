/**
 * core/utils.ts - 跨模块公共工具函数
 *
 * 设计目标：消除多处重复定义的 asyncHandler / tail 等工具函数，
 * 统一维护入口，减少 copy-paste 漂移风险。
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * async 路由包装器：把 Promise reject 交给 Express 错误中间件。
 * Express 4 不会自动捕获 async handler 的异常，必须手动 .catch(next)。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * 截取文本尾部（错误关键信息通常在最后几行），限制长度防爆日志。
 * @param text 原始文本
 * @param maxChars 最大字符数，默认 500
 */
export function tail(text: string, maxChars = 500): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? trimmed.slice(-maxChars) : trimmed;
}
