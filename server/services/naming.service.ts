/**
 * naming.service.ts — 文件命名模板引擎
 *
 * 将用户定义的模板（如 "{course}/{date}_{num}_{title}.{ext}"）结合视频元数据
 * 生成最终的文件相对路径。
 *
 * 模板变量（与 docs/development-plan.md 对齐）：
 *   {course}  → 播放列表标题（课程名）
 *   {date}    → 下载日期 yyyy-MM-dd
 *   {num}     → 集数序号（两位补齐，如 "03"）
 *   {title}   → 视频标题（已做文件名安全处理）
 *   {quality} → 画质标签（如 "1080p"）
 *   {ext}     → 文件扩展名（不含点）
 *
 * 安全处理：替换 Windows/Linux 非法文件名字符为下划线。
 */

import type { NamingContext } from '../types/download.ts';

/** 文件名非法字符（跨平台并集） */
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/** 最大文件名长度（留余量给扩展名和序号） */
const MAX_NAME_LENGTH = 180;

export class NamingService {
  /**
   * 应用模板生成文件相对路径。
   *
   * @param template 命名模板，如 "{course}/{date}_{num}_{title}.{ext}"
   * @param ctx 命名上下文（视频元数据）
   * @returns 安全的相对路径，如 "机器学习2026/2026-07-25_03_神经网络基础.mp4"
   */
  apply(template: string, ctx: NamingContext): string {
    const path = template
      .replace('{course}', ctx.course ? sanitize(ctx.course) : '未分类')
      .replace('{date}', ctx.date)
      .replace('{num}', ctx.num ?? '')
      .replace('{title}', sanitize(ctx.title))
      .replace('{quality}', ctx.quality ?? '')
      .replace('{ext}', sanitize(ctx.ext));

    // 清理连续下划线和首尾斜杠
    return path.replace(/_{2,}/g, '_').replace(/^[/\\]+|[/\\]+$/g, '');
  }
}

/** 文件名安全处理：替换非法字符、截断长度 */
function sanitize(text: string): string {
  return text
    .replace(ILLEGAL_CHARS, '_')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}
