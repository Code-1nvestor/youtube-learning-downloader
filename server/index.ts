/**
 * index.ts - 服务入口（启动流程编排）
 *
 * 启动顺序：
 * 1. loadConfig          -- 加载配置
 * 2. initDatabase        -- 初始化 SQLite（Phase 5）
 * 3. 环境自检            -- yt-dlp 可用性（缺失只警告不退出：解析接口会返回
 *                           YT_DLP_MISSING 结构化错误，前端可引导用户安装）
 * 4. createApp + listen  -- 启动 HTTP 服务
 * 5. queueService.restoreFromDb() -- 恢复上次未完成的任务
 * 6. 注册优雅退出        -- SIGINT/SIGTERM 时关闭 DB、停止接收新连接、退出
 */

import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { YtDlpService } from './core/yt-dlp.service.ts';
import { CookieService } from './services/cookie.service.ts';
import { DownloadService } from './services/download.service.ts';
import { NamingService } from './services/naming.service.ts';
import { QueueService } from './services/queue.service.ts';
import { SubtitleService } from './services/subtitle.service.ts';
import { HistoryService } from './services/history.service.ts';
import { SettingsService } from './services/settings.service.ts';
import { initDatabase, type DbContext } from './db/database.ts';
import { isAppError } from './types/errors.ts';
import { runProcess, BinaryNotFoundError } from './core/process.ts';
import type { RuntimeToolStatus } from './types/runtime.ts';

async function checkFfmpeg(binary: string): Promise<RuntimeToolStatus> {
  try {
    const result = await runProcess(binary, ['-version'], {
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    });
    if (result.exitCode !== 0) {
      return { available: false, message: 'ffmpeg 返回了异常结果' };
    }
    const firstLine = result.stdout.split(/\r?\n/, 1)[0]?.trim();
    return {
      available: true,
      version: firstLine || '已安装',
    };
  } catch (error) {
    if (error instanceof BinaryNotFoundError) {
      return { available: false, message: '未找到 ffmpeg' };
    }
    return {
      available: false,
      message: error instanceof Error ? error.message : 'ffmpeg 检查失败',
    };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  // 初始化数据库（Phase 5 持久化）
  let dbContext: DbContext | null;
  try {
    dbContext = initDatabase(config.dbPath);
    console.log(`[startup] 数据库已初始化: ${config.dbPath}`);
  } catch (err) {
    console.error('[startup] 数据库初始化失败，将以纯内存模式运行:', err);
    dbContext = null;
  }

  // Cookie 管理服务（先初始化，供 yt-dlp 与 download 服务注入参数）
  const cookieService = new CookieService(config.appDataPath);

  const ytDlpService = new YtDlpService({
    binary: config.ytDlpBinary,
    timeoutMs: config.resolveTimeoutMs,
    getCookieArg: () => cookieService.getArg(),
  });

  // 环境自检：失败不阻断启动，让 API 层返回结构化错误引导用户
  let ytDlpStatus: RuntimeToolStatus;
  try {
    const version = await ytDlpService.checkAvailable();
    console.log(`[startup] yt-dlp 版本: ${version}`);
    ytDlpStatus = { available: true, version };
  } catch (err) {
    if (isAppError(err)) {
      console.warn(`[startup] 警告: ${err.message}`);
      console.warn('[startup] 服务将继续启动，/api/resolve 会返回 YT_DLP_MISSING 错误');
      ytDlpStatus = { available: false, message: err.message };
    } else {
      throw err;
    }
  }
  const ffmpegStatus = await checkFfmpeg(config.ffmpegBinary);
  if (ffmpegStatus.available) {
    console.log(`[startup] ffmpeg: ${ffmpegStatus.version}`);
  } else {
    console.warn(`[startup] 警告: ${ffmpegStatus.message}`);
  }

  // 初始化下载服务链
  const settingsService = new SettingsService(
    {
      maxConcurrent: config.maxConcurrent,
      downloadPath: config.downloadPath,
      namingTemplate: config.namingTemplate,
    },
    dbContext,
  );
  const appSettings = settingsService.getSettings();
  const downloadService = new DownloadService({
    binary: config.ytDlpBinary,
    ffmpegBinary: config.ffmpegBinary,
    getCookieArg: () => cookieService.getArg(),
  });
  const namingService = new NamingService();
  const dbForQueue = dbContext;
  const queueService = new QueueService(
    downloadService,
    namingService,
    {
      maxConcurrent: appSettings.maxConcurrent,
      downloadPath: appSettings.downloadPath,
      namingTemplate: appSettings.namingTemplate,
    },
    dbForQueue,
  );

  console.log(`[startup] 下载目录: ${appSettings.downloadPath}`);
  console.log(`[startup] 最大并发: ${appSettings.maxConcurrent}`);
  console.log(`[startup] 命名模板: ${appSettings.namingTemplate}`);
  console.log(`[startup] Cookie 状态: ${cookieService.getStatus().source}`);

  // 字幕服务（复用 ytDlpService 的解析能力 + cookie 配置）
  const subtitleService = new SubtitleService(ytDlpService, {
    binary: config.ytDlpBinary,
    outputRoot: appSettings.downloadPath,
    getCookieArg: () => cookieService.getArg(),
  });

  // 历史服务（Phase 5）
  const historyService = new HistoryService(dbForQueue);

  const app = createApp(
    config,
    ytDlpService,
    queueService,
    cookieService,
    subtitleService,
    historyService,
    settingsService,
    { ytDlp: ytDlpStatus, ffmpeg: ffmpegStatus },
  );

  // 个人桌面应用只提供本机服务，避免局域网设备直接调用下载和 Cookie 接口。
  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`[startup] 学习资料下载器后端已启动: http://localhost:${config.port}`);
    console.log(`[startup] 健康检查: http://localhost:${config.port}/api/health`);

    // 启动后恢复未完成的任务
    const result = queueService.restoreFromDb();
    if (result.restored > 0) {
      console.log(`[startup] 已恢复 ${result.restored} 个任务（${result.resumed} 个将自动继续下载）`);
    }
  });

  // 优雅退出：先 close 停止接收新连接，关闭 DB，再退出
  const shutdown = (signal: string): void => {
    console.log(`\n[shutdown] 收到 ${signal}，正在关闭...`);
    server.close(() => {
      console.log('[shutdown] 已停止接收新连接');
      // 关闭数据库
      if (dbForQueue) {
        dbForQueue.close();
        console.log('[shutdown] 数据库已关闭');
      }
      process.exit(0);
    });
    // 兜底：5 秒内未能优雅退出则强制退出
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal] 启动失败:', err);
  process.exit(1);
});
