/**
 * index.ts — 服务入口（启动流程编排）
 *
 * 启动顺序：
 * 1. loadConfig          —— 加载配置
 * 2. 环境自检            —— yt-dlp 可用性（缺失只警告不退出：解析接口会返回
 *                           YT_DLP_MISSING 结构化错误，前端可引导用户安装）
 * 3. createApp + listen  —— 启动 HTTP 服务
 * 4. 注册优雅退出        —— SIGINT/SIGTERM 时先停止接收新连接，再退出
 */

import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { YtDlpService } from './core/yt-dlp.service.ts';
import { CookieService } from './services/cookie.service.ts';
import { DownloadService } from './services/download.service.ts';
import { NamingService } from './services/naming.service.ts';
import { QueueService } from './services/queue.service.ts';
import { SubtitleService } from './services/subtitle.service.ts';
import { isAppError } from './types/errors.ts';

async function main(): Promise<void> {
  const config = loadConfig();

  // Cookie 管理服务（先初始化，供 yt-dlp 与 download 服务注入参数）
  const cookieService = new CookieService(process.cwd());

  const ytDlpService = new YtDlpService({
    binary: config.ytDlpBinary,
    timeoutMs: config.resolveTimeoutMs,
    getCookieArg: () => cookieService.getArg(),
  });

  // 环境自检：失败不阻断启动，让 API 层返回结构化错误引导用户
  try {
    const version = await ytDlpService.checkAvailable();
    console.log(`[startup] yt-dlp 版本: ${version}`);
  } catch (err) {
    if (isAppError(err)) {
      console.warn(`[startup] 警告: ${err.message}`);
      console.warn('[startup] 服务将继续启动，/api/resolve 会返回 YT_DLP_MISSING 错误');
    } else {
      throw err;
    }
  }

  // 初始化下载服务链
  const downloadService = new DownloadService({
    binary: config.ytDlpBinary,
    getCookieArg: () => cookieService.getArg(),
  });
  const namingService = new NamingService();
  const queueService = new QueueService(downloadService, namingService, {
    maxConcurrent: config.maxConcurrent,
    downloadPath: config.downloadPath,
    namingTemplate: config.namingTemplate,
  });

  console.log(`[startup] 下载目录: ${config.downloadPath}`);
  console.log(`[startup] 最大并发: ${config.maxConcurrent}`);
  console.log(`[startup] 命名模板: ${config.namingTemplate}`);
  console.log(`[startup] Cookie 状态: ${cookieService.getStatus().source}`);

  // 字幕服务（复用 ytDlpService 的解析能力 + cookie 配置）
  const subtitleService = new SubtitleService(ytDlpService, {
    binary: config.ytDlpBinary,
    getCookieArg: () => cookieService.getArg(),
  });

  const app = createApp(config, ytDlpService, queueService, cookieService, subtitleService);

  const server = app.listen(config.port, () => {
    console.log(`[startup] 学习资料下载器后端已启动: http://localhost:${config.port}`);
    console.log(`[startup] 健康检查: http://localhost:${config.port}/api/health`);
  });

  // 优雅退出：先 close 停止接收新连接，等待存量请求结束
  const shutdown = (signal: string): void => {
    console.log(`\n[shutdown] 收到 ${signal}，正在关闭...`);
    server.close(() => {
      console.log('[shutdown] 已停止接收新连接，退出');
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
