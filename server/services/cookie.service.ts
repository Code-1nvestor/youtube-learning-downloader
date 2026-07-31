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
import type {
  CookieStatus,
  CookieSourceType,
  CookieArg,
} from '../types/auth.ts';
import { AppError } from '../types/errors.ts';
import { writeSensitiveTextFileSync } from '../core/sensitive-file.ts';

export class CookieService {
  /** 服务端 Cookie 文件存储目录（相对项目根） */
  private static readonly COOKIE_DIR = '.cookies';
  private static readonly COOKIE_FILE = 'cookies.txt';

  private source: CookieSourceType = 'none';
  private browser?: 'chrome' | 'edge' | 'firefox' | 'brave' | 'safari';
  private cookieFilePath?: string;
  private updatedAt?: string;
  private readonly cookieDir: string;
  private readonly configFilePath: string;

  constructor(private readonly projectRoot: string) {
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
    };
    if (this.browser) status.browser = this.browser;
    if (this.cookieFilePath) {
      status.fileName = path.basename(this.cookieFilePath);
    }
    if (this.updatedAt) status.updatedAt = this.updatedAt;
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
    this.persistMetadata();
  }

  /**
   * 配置为从浏览器自动读取 Cookie。
   *
   * @throws {AppError} INVALID_PARAM -- 指定浏览器在当前系统不可用
   */
  setFromBrowser(browser: 'chrome' | 'edge' | 'firefox' | 'brave' | 'safari'): void {
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
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  private restore(): void {
    if (!fs.existsSync(this.configFilePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8')) as {
        source?: CookieSourceType;
        browser?: 'chrome' | 'edge' | 'firefox' | 'brave' | 'safari';
        updatedAt?: string;
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
      }
      this.updatedAt = saved.updatedAt;
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
      if (trimmedLine.startsWith('#') || trimmedLine.length === 0) continue;

      // 有效 cookie 行：7 个 tab 分隔的字段
      const fields = trimmedLine.split('\t');
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
}
