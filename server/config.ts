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
  /** ffmpeg 可执行文件名或绝对路径（Phase 3 暂不强制检测） */
  ffmpegBinary: string;
  /** 单次解析超时（毫秒） */
  resolveTimeoutMs: number;
  /** 默认下载根目录 */
  downloadPath: string;
  /** 最大并发下载数 */
  maxConcurrent: number;
  /** 默认文件命名模板 */
  namingTemplate: string;
  /** SQLite 数据库文件路径 */
  dbPath: string;
  /** 是否在 API 错误响应中附带 details（开发环境开启便于调试） */
  isDev: boolean;
}

const DEFAULTS: AppConfig = {
  port: 3000,
  ytDlpBinary: 'yt-dlp',
  ffmpegBinary: 'ffmpeg',
  resolveTimeoutMs: 60_000,
  downloadPath: '',
  maxConcurrent: 2,
  namingTemplate: '{course}/{date}_{num}_{title}.{ext}',
  dbPath: '',
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

  // 下载目录默认值：项目根目录下的 downloads/
  const defaultDownloadPath = path.resolve(process.cwd(), 'downloads');
  // 数据库默认值：项目根目录下的 data/app.db
  const defaultDbPath = path.resolve(process.cwd(), 'data', 'app.db');

  return {
    port: parseIntWithFallback(process.env.PORT, DEFAULTS.port),
    ytDlpBinary: process.env.YT_DLP_BINARY ?? DEFAULTS.ytDlpBinary,
    ffmpegBinary: process.env.FFMPEG_BINARY ?? DEFAULTS.ffmpegBinary,
    resolveTimeoutMs: parseIntWithFallback(
      process.env.RESOLVE_TIMEOUT_MS,
      DEFAULTS.resolveTimeoutMs,
    ),
    downloadPath: process.env.DOWNLOAD_PATH ?? defaultDownloadPath,
    maxConcurrent: clamp(
      parseIntWithFallback(process.env.MAX_CONCURRENT, DEFAULTS.maxConcurrent),
      1,
      8,
    ),
    namingTemplate: process.env.NAMING_TEMPLATE ?? DEFAULTS.namingTemplate,
    dbPath: process.env.DB_PATH ?? defaultDbPath,
    isDev: DEFAULTS.isDev,
  };
}

function parseIntWithFallback(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 将数值限制在 [min, max] 区间内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
