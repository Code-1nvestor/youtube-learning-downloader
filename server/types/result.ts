/**
 * result.ts — 统一 API 响应契约
 *
 * 所有 HTTP 接口必须返回 ApiResponse<T> 形态：
 * - 成功: { success: true, data: T }
 * - 失败: { success: false, error: { code, message, details? } }
 *
 * 好处：前端可以写统一的 fetch 封装，先判 success 再取 data/error，
 * 不需要同时处理 HTTP 状态码和响应体两种错误通道。
 *
 * 注意：HTTP 状态码仍然会按 AppError.statusCode 返回（便于网关/监控），
 * 但业务逻辑只应依赖 body 中的 success 与 error.code。
 */

import type { AppError } from './errors.ts';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 构造成功响应 */
export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

/** 从 AppError 构造失败响应（details 仅在非生产环境附带） */
export function fail(err: AppError, includeDetails = false): ApiFailure {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      ...(includeDetails && err.details !== undefined ? { details: err.details } : {}),
    },
  };
}
