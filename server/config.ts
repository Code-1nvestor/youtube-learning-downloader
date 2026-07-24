/**
 * config.ts — 应用配置加载
 *
 * 零依赖方案：利用 Node 20.12+ 内置的 process.loadEnvFile 读取 .env，
 * 无需引入 dotenv。所有配置项集中在此，带类型与默认值。
 *
 * 扩展指南：新增配置时，在 AppConfig 接口与 loadConfig 中各加一行，
 * 并在 .env.example 中补充说明。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  /** HTTP 服务端口 */
  port: number;
  /** yt-dlp 可执行文件名或绝对路径 */
  ytDlpBinary: string;
  /** 单次解析超时（毫秒） */
  resolveTimeoutMs: number;
  /** 是否在 API 错误响应中附带 details（开发环境开启便于调试） */
  isDev: boolean;
}

const DEFAULTS: AppConfig = {
  port: 3000,
  ytDlpBinary: 'yt-dlp',
  resolveTimeoutMs: 60_000,
  isDev: process.env.NODE_ENV !== 'production',
};

/** 尝试加载项目根目录的 .env（不存在则静默跳过） */
function tryLoadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[config] .env 解析失败，使用默认值: ${(err as Error).message}`);
  }
}

export function loadConfig(): AppConfig {
  tryLoadEnvFile();

  return {
    port: parseIntWithFallback(process.env.PORT, DEFAULTS.port),
    ytDlpBinary: process.env.YT_DLP_BINARY ?? DEFAULTS.ytDlpBinary,
    resolveTimeoutMs: parseIntWithFallback(
      process.env.RESOLVE_TIMEOUT_MS,
      DEFAULTS.resolveTimeoutMs,
    ),
    isDev: DEFAULTS.isDev,
  };
}

function parseIntWithFallback(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
