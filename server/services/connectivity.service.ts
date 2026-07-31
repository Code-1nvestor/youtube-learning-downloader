import type { YtDlpService } from '../core/yt-dlp.service.ts';
import type { CookieService } from './cookie.service.ts';
import type { SettingsService } from './settings.service.ts';
import { AppError, isAppError, type ErrorCode } from '../types/errors.ts';
import type { ConnectivityStatus } from '../types/runtime.ts';
import type { CookieStatus } from '../types/auth.ts';

const OFFICIAL_TEST_VIDEO = 'https://www.youtube.com/watch?v=YE7VzlLtp-4';

export class ConnectivityService {
  private running = false;

  constructor(
    private readonly ytDlpService: YtDlpService,
    private readonly settingsService: SettingsService,
    private readonly cookieService: CookieService,
  ) {}

  async testYouTube(): Promise<ConnectivityStatus> {
    if (this.running) {
      throw new AppError('INVALID_PARAM', '连接测试正在进行，请稍候');
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const result = await this.ytDlpService.resolve(OFFICIAL_TEST_VIDEO);
      return this.makeStatus(true, 'OK', '连接成功，可以解析 YouTube', startedAt, {
        videoTitle: result.videos[0]?.title ?? result.title,
      });
    } catch (error) {
      if (!isAppError(error)) throw error;
      const cookieStatus = this.cookieService.getStatus();
      return this.makeStatus(false, error.code, error.message, startedAt, {
        recommendation: recommendationFor(error.code, cookieStatus),
      });
    } finally {
      this.running = false;
    }
  }

  private makeStatus(
    ok: boolean,
    code: ConnectivityStatus['code'],
    message: string,
    startedAt: number,
    extra: Pick<ConnectivityStatus, 'recommendation' | 'videoTitle'>,
  ): ConnectivityStatus {
    const settings = this.settingsService.getSettings();
    return {
      ok,
      code,
      message,
      testedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      proxyConfigured: settings.proxyUrl.length > 0,
      cookieConfigured: this.cookieService.getStatus().configured,
      ...(extra.recommendation ? { recommendation: extra.recommendation } : {}),
      ...(extra.videoTitle ? { videoTitle: extra.videoTitle } : {}),
    };
  }
}

function recommendationFor(code: ErrorCode, cookieStatus: CookieStatus): string {
  switch (code) {
    case 'RATE_LIMITED':
      if (cookieStatus.source === 'browser') {
        return `已选择 ${cookieStatus.browser ?? '浏览器'} Cookie，但 YouTube 仍要求验证；请完全关闭该浏览器后重试，仍失败时可改用最新导出的 Cookie 文件。`;
      }
      if (cookieStatus.source === 'file') {
        return '已导入 Cookie 文件，但 YouTube 仍要求验证；该文件可能已失效，请重新登录 YouTube 后导出最新 Cookie。';
      }
      return '网络已到达 YouTube，但对方要求验证身份；请配置 Cookie 后重试。';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return '请检查本机网络、防火墙或代理地址，然后重新测试。';
    case 'YT_DLP_MISSING':
    case 'YT_DLP_OUTDATED':
      return '请先在设置页检查或更新 yt-dlp。';
    default:
      return '请根据错误信息处理；持续失败时可打开日志目录。';
  }
}
