import fs from 'node:fs';
import path from 'node:path';
import type { DbContext } from '../db/database.ts';
import { AppError } from '../types/errors.ts';
import type {
  AppSettings,
  AppSettingsStatus,
  UpdateAppSettingsInput,
} from '../types/settings.ts';

const SETTING_KEYS = ['downloadPath', 'maxConcurrent', 'maxRetries', 'namingTemplate', 'proxyUrl'] as const;
const ALLOWED_TEMPLATE_TOKENS = new Set([
  'course',
  'date',
  'num',
  'title',
  'quality',
  'ext',
]);

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SettingsService {
  private settings: AppSettings;
  private readonly db: DbContext | null;

  constructor(defaults: AppSettings, db: DbContext | null = null) {
    this.db = db;
    const validatedDefaults = this.validate({ ...defaults });
    const persisted = this.loadPersisted(validatedDefaults);
    try {
      this.ensureDownloadPath(persisted.downloadPath);
      this.settings = persisted;
    } catch (error) {
      console.warn(
        `[settings] 已保存的下载目录不可用，回退到默认目录: ${validatedDefaults.downloadPath}; 原因: ${formatError(error)}`,
      );
      this.ensureDownloadPath(validatedDefaults.downloadPath);
      this.settings = { ...persisted, downloadPath: validatedDefaults.downloadPath };
    }
  }

  getStatus(): AppSettingsStatus {
    return { ...this.settings, persistent: this.db !== null };
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  update(input: UpdateAppSettingsInput): AppSettingsStatus {
    const next = this.validate({ ...this.settings, ...input });
    this.ensureDownloadPath(next.downloadPath);

    if (this.db) {
      try {
        this.db.db.exec('BEGIN IMMEDIATE');
        const updatedAt = new Date().toISOString();
        for (const key of SETTING_KEYS) {
          this.db.stmts.upsertSetting.run(key, JSON.stringify(next[key]), updatedAt);
        }
        this.db.db.exec('COMMIT');
      } catch (error) {
        try {
          this.db.db.exec('ROLLBACK');
        } catch {
          // 如果 BEGIN 本身失败，则没有事务可回滚。
        }
        throw new AppError('UNKNOWN', '设置保存失败，请查看后端日志', {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.settings = next;
    return this.getStatus();
  }

  private loadPersisted(defaults: AppSettings): AppSettings {
    if (!this.db) return defaults;

    let current = defaults;
    try {
      const rows = this.db.stmts.getSettings.all() as Array<{ key: string; value: string }>;
      for (const row of rows) {
        if (!SETTING_KEYS.includes(row.key as (typeof SETTING_KEYS)[number])) continue;
        try {
          const value = JSON.parse(row.value) as unknown;
          current = this.validate({ ...current, [row.key]: value });
        } catch (error) {
          console.warn(
            `[settings] 忽略无效的持久化设置 ${row.key}: ${formatError(error)}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `[settings] 读取持久化设置失败，将使用默认值: ${formatError(error)}`,
      );
      return defaults;
    }
    return current;
  }

  private validate(settings: AppSettings): AppSettings {
    const downloadPath = this.validateDownloadPath(settings.downloadPath);
    const maxConcurrent = this.validateMaxConcurrent(settings.maxConcurrent);
    const maxRetries = this.validateMaxRetries(settings.maxRetries);
    const namingTemplate = this.validateNamingTemplate(settings.namingTemplate);
    const proxyUrl = this.validateProxyUrl(settings.proxyUrl);
    return { downloadPath, maxConcurrent, maxRetries, namingTemplate, proxyUrl };
  }

  private validateDownloadPath(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AppError('INVALID_PARAM', '下载目录不能为空');
    }
    const trimmed = value.trim();
    if (!path.isAbsolute(trimmed)) {
      throw new AppError('PATH_NOT_ALLOWED', '下载目录必须是绝对路径');
    }
    return path.resolve(trimmed);
  }

  private validateMaxConcurrent(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 8) {
      throw new AppError('INVALID_PARAM', '并发下载数必须是 1 到 8 之间的整数');
    }
    return value;
  }

  private validateMaxRetries(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new AppError('INVALID_PARAM', '自动重试次数必须是 0 到 5 之间的整数');
    }
    return value;
  }

  private validateNamingTemplate(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 240) {
      throw new AppError('INVALID_PARAM', '命名规则不能为空，且不能超过 240 个字符');
    }
    const template = value.trim();
    if (path.win32.isAbsolute(template) || path.posix.isAbsolute(template)) {
      throw new AppError('PATH_NOT_ALLOWED', '命名规则必须是下载目录内的相对路径');
    }
    if (template.split(/[\\/]+/).some((segment) => segment === '..')) {
      throw new AppError('PATH_NOT_ALLOWED', '命名规则不能包含上级目录“..”');
    }
    const tokens = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    if (tokens.some((token) => !token || !ALLOWED_TEMPLATE_TOKENS.has(token))) {
      throw new AppError('INVALID_PARAM', '命名规则包含不支持的变量');
    }
    if (!template.includes('{title}') || !template.includes('{ext}')) {
      throw new AppError('INVALID_PARAM', '命名规则必须包含 {title} 和 {ext}');
    }
    return template;
  }

  private validateProxyUrl(value: unknown): string {
    if (typeof value !== 'string') {
      throw new AppError('INVALID_PARAM', '代理地址必须是文本');
    }
    const proxyUrl = value.trim();
    if (proxyUrl.length === 0) return '';
    if (proxyUrl.length > 2048) {
      throw new AppError('INVALID_PARAM', '代理地址不能超过 2048 个字符');
    }

    let parsed: URL;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      throw new AppError('INVALID_PARAM', '代理地址格式不正确');
    }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
      throw new AppError('INVALID_PARAM', '代理协议仅支持 http、https、socks5 或 socks5h');
    }
    if (!parsed.hostname) {
      throw new AppError('INVALID_PARAM', '代理地址必须包含主机名');
    }
    if (parsed.username || parsed.password) {
      throw new AppError('INVALID_PARAM', '为避免明文泄露，代理地址不能包含账号或密码');
    }
    if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
      throw new AppError('INVALID_PARAM', '代理地址不能包含路径、查询参数或锚点');
    }
    return proxyUrl;
  }

  private ensureDownloadPath(downloadPath: string): void {
    try {
      fs.mkdirSync(downloadPath, { recursive: true });
      fs.accessSync(downloadPath, fs.constants.W_OK);
    } catch (error) {
      throw new AppError('PATH_NOT_ALLOWED', '下载目录无法创建或没有写入权限', {
        downloadPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
