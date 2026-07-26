/**
 * auth.ts - 认证与 Cookie 领域类型
 *
 * Cookie 用于让 yt-dlp 携带已登录态访问 YouTube，绕过机器人验证。
 * 来源有两种：
 * 1. Netscape cookie 文件（推荐）：从浏览器导出的 cookies.txt
 * 2. 浏览器自动读取：--cookies-from-browser <name>（让 yt-dlp 直读浏览器）
 *
 * 安全注意：
 * - Cookie 文件含敏感凭据，仅存储在服务端本地，永不通过 API 返回
 * - API 只暴露"是否已配置 / 来源类型 / 更新时间"，不暴露 Cookie 内容
 */

/** Cookie 配置来源类型 */
export type CookieSourceType = 'file' | 'browser' | 'none';

/** Cookie 配置状态（API 响应） */
export interface CookieStatus {
  /** 是否已配置有效 Cookie */
  configured: boolean;
  /** 来源类型 */
  source: CookieSourceType;
  /** 浏览器类型（source=browser 时有效） */
  browser?: 'chrome' | 'edge' | 'firefox' | 'brave' | 'safari';
  /** Cookie 文件路径（source=file 时有效，仅返回文件名不暴露完整路径） */
  fileName?: string;
  /** 上次更新时间 ISO 8601 */
  updatedAt?: string;
}

/** 设置 Cookie 来源：Netscape 文件上传 */
export interface SetCookieFileRequest {
  /** Cookie 文件内容（Netscape 格式文本） */
  content: string;
}

/** 设置 Cookie 来源：浏览器自动读取 */
export interface SetCookieBrowserRequest {
  browser: 'chrome' | 'edge' | 'firefox' | 'brave' | 'safari';
}

/** yt-dlp --cookies 参数的统一抽象（供服务层使用） */
export interface CookieArg {
  /** 参数名：--cookies 或 --cookies-from-browser */
  flag: '--cookies' | '--cookies-from-browser';
  /** 参数值：文件路径或浏览器名 */
  value: string;
}
