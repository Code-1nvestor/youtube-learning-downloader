/**
 * cookie.service.ts - Cookie 管理服务
 *
 * 职责：管理 yt-dlp 使用的 Cookie 配置，提供统一的参数注入接口。
 *
 * 存储策略：
 * - file 模式：将上传内容写入服务端 cookie 文件（项目根 .cookies/cookies.txt）
 * - browser 模式：不写文件，直接让 yt-dlp 读浏览器
 *
 * 线程安全：单实例服务，配置变更通过 setter 更新，读取通过 getter。
 * 当前实现足够（个人单用户场景），未来若多并发写入需要加锁。
 *
 * 安全：
 * - cookie 文件存放在 .gitignore 已忽略的目录
 * - API 响应不暴露文件完整路径
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BrowserCookieName,
  CookieStatus,
  CookieSourceType,
  CookieArg,
  CookieValidity,
} from '../types/auth.ts';
import { AppError } from '../types/errors.ts';
import { writeSensitiveTextFileSync } from '../core/sensitive-file.ts';

export interface CookieServiceOptions {
  exportBrowserCookies?: (browser: BrowserCookieName, outputPath: string) => Promise<void>;
  detectBrowserRunning?: (browser: BrowserCookieName) => Promise<boolean | undefined>;
  now?: () => Date;
}

export class CookieService {
  /** 服务端 Cookie 文件存储目录（相对项目根） */
  private static readonly COOKIE_DIR = '.cookies';
  private static readonly COOKIE_FILE = 'cookies.txt';
  private static readonly SNAPSHOT_FILE = 'chrome-snapshot.txt';
  private static readonly POSSIBLY_EXPIRED_MS = 7 * 24 * 60 * 60 * 1000;

  private source: CookieSourceType = 'none';
  private browser?: BrowserCookieName;
  private cookieFilePath?: string;
  private updatedAt?: string;
  private importedAt?: string;
  private lastVerifiedAt?: string;
  private validity: CookieValidity = 'not_imported';
  private readonly cookieDir: string;
  private readonly configFilePath: string;

  constructor(private readonly projectRoot: string, private readonly options: CookieServiceOptions = {}) {
    this.cookieDir = path.resolve(this.projectRoot, CookieService.COOKIE_DIR);
    this.configFilePath = path.resolve(this.cookieDir, 'config.json');
    this.restore();
  }

  // ------------------------------------------
  // 状态查询
  // ------------------------------------------

  getStatus(): CookieStatus {
    const status: CookieStatus = {
      configured: this.source !== 'none',
      source: this.source,
      validity: this.currentValidity(),
    };
    if (this.browser) status.browser = this.browser;
    if (this.cookieFilePath) {
      status.fileName = path.basename(this.cookieFilePath);
    }
    if (this.updatedAt) status.updatedAt = this.updatedAt;
    if (this.importedAt) status.importedAt = this.importedAt;
    if (this.lastVerifiedAt) status.lastVerifiedAt = this.lastVerifiedAt;
    return status;
  }

  async getStatusWithBrowserState(): Promise<CookieStatus> {
    const status = this.getStatus();
    const running = await this.options.detectBrowserRunning?.('chrome');
    if (running !== undefined) status.browserRunning = running;
    return status;
  }

  /**
   * 获取 yt-dlp 命令的 Cookie 参数。
   * 返回 undefined 表示未配置 Cookie，调用方不追加任何参数。
   */
  getArg(): CookieArg | undefined {
    if (this.source === 'file' && this.cookieFilePath) {
      return { flag: '--cookies', value: this.cookieFilePath };
    }
    if (this.source === 'browser' && this.browser) {
      return { flag: '--cookies-from-browser', value: this.browser };
    }
    if (this.source === 'snapshot' && this.cookieFilePath) {
      return { flag: '--cookies', value: this.cookieFilePath };
    }
    return undefined;
  }

  // ------------------------------------------
  // 配置变更
  // ------------------------------------------

  /**
   * 从上传的 Netscape cookie 文本配置 Cookie。
   * 写入服务端 .cookies/cookies.txt，并验证基本格式。
   *
   * @throws {AppError} INVALID_PARAM -- 内容格式不合法
   */
  setFromFile(content: string): void {
    this.validateNetscapeFormat(content);

    fs.mkdirSync(this.cookieDir, { recursive: true });

    const filePath = path.resolve(this.cookieDir, CookieService.COOKIE_FILE);
    const protection = writeSensitiveTextFileSync(filePath, content);
    if (!protection.protected) {
      console.warn('[cookie] Cookie 已保存，但当前系统未能完整应用仅当前账号可读权限');
    }

    this.source = 'file';
    this.browser = undefined;
    this.cookieFilePath = filePath;
    this.updatedAt = new Date().toISOString();
    this.importedAt = undefined;
    this.lastVerifiedAt = undefined;
    this.validity = 'not_imported';
    this.persistMetadata();
  }

  /**
   * 配置为从浏览器自动读取 Cookie。
   *
   * @throws {AppError} INVALID_PARAM -- 指定浏览器在当前系统不可用
   */
  setFromBrowser(browser: BrowserCookieName): void {
    // macOS 才有 Safari，其余系统指定 Safari 视为错误
    if (browser === 'safari' && !process.platform.startsWith('darwin')) {
      throw new AppError(
        'INVALID_PARAM',
        'Safari Cookie 仅在 macOS 上可用',
        { platform: process.platform },
      );
    }

    this.source = 'browser';
    this.browser = browser;
    this.cookieFilePath = undefined;
    this.updatedAt = new Date().toISOString();
    this.importedAt = undefined;
    this.lastVerifiedAt = undefined;
    this.validity = 'not_imported';
    this.persistMetadata();
  }

  async importBrowserSnapshot(browser: BrowserCookieName): Promise<CookieStatus> {
    this.validateBrowser(browser);
    if (!this.options.exportBrowserCookies) {
      throw new AppError('COOKIE_ERROR', '当前运行环境未配置浏览器 Cookie 快照导入能力');
    }
    if (await this.options.detectBrowserRunning?.(browser)) {
      throw new AppError('COOKIE_ERROR', `检测到 ${browserDisplayName(browser)} 正在运行，请完全关闭后再导入快照`);
    }

    fs.mkdirSync(this.cookieDir, { recursive: true });
    const targetPath = path.resolve(this.cookieDir, CookieService.SNAPSHOT_FILE);
    const tempPath = path.resolve(this.cookieDir, `.snapshot-${randomUUID()}.tmp`);
    const backupPath = path.resolve(this.cookieDir, `.snapshot-${randomUUID()}.rollback`);
    const previous = this.captureState();
    let movedOld = false;
    let installedNew = false;

    try {
      await this.options.exportBrowserCookies(browser, tempPath);
      const content = fs.readFileSync(tempPath, 'utf8');
      this.validateNetscapeFormat(content);
      const protection = writeSensitiveTextFileSync(tempPath, content);
      if (!protection.protected) {
        console.warn('[cookie] Cookie 快照已导入，但当前系统未能完整应用仅当前账号可读权限');
      }

      if (fs.existsSync(targetPath)) {
        fs.renameSync(targetPath, backupPath);
        movedOld = true;
      }
      fs.renameSync(tempPath, targetPath);
      installedNew = true;

      const now = (this.options.now?.() ?? new Date()).toISOString();
      this.source = 'snapshot';
      this.browser = browser;
      this.cookieFilePath = targetPath;
      this.updatedAt = now;
      this.importedAt = now;
      this.lastVerifiedAt = now;
      this.validity = 'valid';
      this.persistMetadata();

      if (movedOld) fs.rmSync(backupPath, { force: true });
      return await this.getStatusWithBrowserState();
    } catch (error) {
      this.restoreCapturedState(previous);
      if (installedNew) fs.rmSync(targetPath, { force: true });
      if (movedOld && fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
      throw error;
    } finally {
      fs.rmSync(tempPath, { force: true });
      fs.rmSync(backupPath, { force: true });
    }
  }

  recordVerification(success: boolean, cookieRejected = false): void {
    if (this.source !== 'snapshot') return;
    this.lastVerifiedAt = (this.options.now?.() ?? new Date()).toISOString();
    this.validity = success ? 'valid' : cookieRejected ? 'verification_failed' : 'possibly_expired';
    this.persistMetadata();
  }

  /** 清除 Cookie 配置（同时删除文件） */
  clear(): void {
    if (this.cookieFilePath) {
      try {
        fs.unlinkSync(this.cookieFilePath);
      } catch {
        // 文件已不存在，忽略
      }
    }
    this.source = 'none';
    this.browser = undefined;
    this.cookieFilePath = undefined;
    this.updatedAt = undefined;
    this.importedAt = undefined;
    this.lastVerifiedAt = undefined;
    this.validity = 'not_imported';
    for (const fileName of [CookieService.COOKIE_FILE, CookieService.SNAPSHOT_FILE]) {
      try {
        fs.rmSync(path.resolve(this.cookieDir, fileName), { force: true });
      } catch {
        // 仅清理应用自己管理的 Cookie 文件；错误由后续配置状态体现。
      }
    }
    try {
      fs.unlinkSync(this.configFilePath);
    } catch {
      // 配置文件已不存在，忽略。
    }
  }

  // ------------------------------------------
  // 内部
  // ------------------------------------------

  private persistMetadata(): void {
    fs.mkdirSync(this.cookieDir, { recursive: true });
    fs.writeFileSync(
      this.configFilePath,
      JSON.stringify({
        source: this.source,
        ...(this.browser ? { browser: this.browser } : {}),
        updatedAt: this.updatedAt,
        importedAt: this.importedAt,
        lastVerifiedAt: this.lastVerifiedAt,
        validity: this.validity,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  private restore(): void {
    if (!fs.existsSync(this.configFilePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8')) as {
        source?: CookieSourceType;
        browser?: BrowserCookieName;
        updatedAt?: string;
        importedAt?: string;
        lastVerifiedAt?: string;
        validity?: CookieValidity;
      };
      if (saved.source === 'file') {
        const filePath = path.resolve(this.cookieDir, CookieService.COOKIE_FILE);
        const content = fs.readFileSync(filePath, 'utf8');
        this.validateNetscapeFormat(content);
        this.source = 'file';
        this.cookieFilePath = filePath;
      } else if (saved.source === 'browser' && saved.browser) {
        if (saved.browser === 'safari' && !process.platform.startsWith('darwin')) return;
        this.source = 'browser';
        this.browser = saved.browser;
      } else if (saved.source === 'snapshot' && saved.browser) {
        const filePath = path.resolve(this.cookieDir, CookieService.SNAPSHOT_FILE);
        const content = fs.readFileSync(filePath, 'utf8');
        this.validateNetscapeFormat(content);
        this.source = 'snapshot';
        this.browser = saved.browser;
        this.cookieFilePath = filePath;
      }
      this.updatedAt = saved.updatedAt;
      this.importedAt = saved.importedAt;
      this.lastVerifiedAt = saved.lastVerifiedAt;
      this.validity = saved.validity ?? (saved.source === 'snapshot' ? 'possibly_expired' : 'not_imported');
    } catch (error) {
      console.warn('[cookie] 已保存的 Cookie 配置不可用，将忽略:', error);
    }
  }

  /**
   * 验证 Netscape cookie 文件格式。
   *
   * Netscape 格式：
   * - # Netscape HTTP Cookie File  （首行注释，可选但推荐）
   * - # ...
   * - domain  flag  path  secure  expiration  name  value  （tab 分隔）
   *
   * 只做基本校验：至少包含一行有效 cookie 数据（7 个 tab 分隔字段）。
   */
  private validateNetscapeFormat(content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new AppError('INVALID_PARAM', 'Cookie 文件内容为空');
    }

    const lines = trimmed.split('\n');
    let validCookieLine = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      // 跳过注释和空行
      if ((trimmedLine.startsWith('#') && !trimmedLine.startsWith('#HttpOnly_')) || trimmedLine.length === 0) continue;

      // 有效 cookie 行：7 个 tab 分隔的字段
      const fields = trimmedLine.replace(/^#HttpOnly_/, '').split('\t');
      if (fields.length >= 7) {
        validCookieLine = true;
        break;
      }
    }

    if (!validCookieLine) {
      throw new AppError(
        'INVALID_PARAM',
        'Cookie 文件格式不合法：需要 Netscape 格式（tab 分隔 7 字段）',
        {
          hint: '可使用浏览器扩展 "Get cookies.txt LOCALLY" 导出',
        },
      );
    }
  }

  private validateBrowser(browser: BrowserCookieName): void {
    if (!['chrome', 'edge', 'firefox', 'brave', 'safari'].includes(browser)) {
      throw new AppError('INVALID_PARAM', '不支持的浏览器 Cookie 来源');
    }
    if (browser === 'safari' && !process.platform.startsWith('darwin')) {
      throw new AppError('INVALID_PARAM', 'Safari Cookie 仅在 macOS 上可用');
    }
  }

  private currentValidity(): CookieValidity {
    if (this.source !== 'snapshot' || !this.importedAt) return 'not_imported';
    if (this.validity !== 'valid') return this.validity;
    const importedAt = Date.parse(this.importedAt);
    const now = (this.options.now?.() ?? new Date()).getTime();
    return Number.isFinite(importedAt) && now - importedAt > CookieService.POSSIBLY_EXPIRED_MS
      ? 'possibly_expired'
      : 'valid';
  }

  private captureState() {
    return {
      source: this.source,
      browser: this.browser,
      cookieFilePath: this.cookieFilePath,
      updatedAt: this.updatedAt,
      importedAt: this.importedAt,
      lastVerifiedAt: this.lastVerifiedAt,
      validity: this.validity,
    };
  }

  private restoreCapturedState(state: ReturnType<CookieService['captureState']>): void {
    this.source = state.source;
    this.browser = state.browser;
    this.cookieFilePath = state.cookieFilePath;
    this.updatedAt = state.updatedAt;
    this.importedAt = state.importedAt;
    this.lastVerifiedAt = state.lastVerifiedAt;
    this.validity = state.validity;
  }
}

function browserDisplayName(browser: BrowserCookieName): string {
  return browser === 'chrome' ? 'Chrome' : browser[0]?.toUpperCase() + browser.slice(1);
}
