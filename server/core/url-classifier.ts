/**
 * url-classifier.ts — 查询输入分类器
 *
 * 参考 Tyrrrz/YoutubeDownloader 的 QueryResolver 设计：
 * 按"播放列表 → 视频 → 频道 → 搜索"的优先级链判定输入类型。
 *
 * 判定规则（顺序敏感，勿随意调换）：
 * 1. 以 "?" 开头          → 强制关键词搜索（原项目同款约定）
 * 2. 含 list= 参数        → 播放列表（即使是 watch?v=xx&list=yy 形式，
 *                           也按播放列表处理，与原项目行为一致）
 * 3. watch?v= / youtu.be / /shorts/ → 单视频
 * 4. /@handle /channel/UC.. /c/.. /user/.. → 频道
 * 5. 其余非 URL 文本      → 关键词搜索
 *
 * 注意：分类器只做"路由分发"，不做严格 URL 校验 ——
 * URL 是否真实有效由 yt-dlp 上游判定，错误统一走 AppError。
 */

import type { QueryKind } from '../types/video.ts';
import { AppError } from '../types/errors.ts';

export interface ClassifiedQuery {
  kind: QueryKind;
  /** 归一化后的查询（trim 后；搜索词去掉前导 "?"） */
  normalized: string;
}

const VIDEO_PATTERNS = [
  /[?&]v=[\w-]{6,}/, // youtube.com/watch?v=xxxx
  /(?:^|\/\/)(?:www\.)?youtu\.be\/[\w-]{6,}/, // youtu.be/xxxx
  /\/shorts\/[\w-]{6,}/, // youtube.com/shorts/xxxx
];

const CHANNEL_PATTERNS = [
  /youtube\.com\/@[\w.-]+/, // 新版 handle
  /youtube\.com\/channel\/UC[\w-]+/, // 频道 ID
  /youtube\.com\/c\/[\w.-]+/, // 旧版自定义 URL
  /youtube\.com\/user\/[\w.-]+/, // 旧版用户名
];

/** 判断是否为播放列表 URL（含 list= 参数，排除系统特殊列表外的常规情况） */
function looksLikePlaylist(input: string): boolean {
  return /[?&]list=[\w-]+/.test(input);
}

/**
 * 分类用户输入。
 *
 * @throws {AppError} INVALID_URL —— 输入为空时
 */
export function classifyQuery(rawInput: string): ClassifiedQuery {
  const input = rawInput.trim();

  if (input.length === 0) {
    throw new AppError('INVALID_URL', '输入为空，请粘贴 YouTube 链接或输入关键词');
  }

  // 规则 1：前导 ? 强制搜索
  if (input.startsWith('?')) {
    const keyword = input.slice(1).trim();
    if (keyword.length === 0) {
      throw new AppError('INVALID_URL', '"?" 后需要跟搜索关键词');
    }
    return { kind: 'search', normalized: keyword };
  }

  // 规则 2：播放列表优先（与原项目 QueryResolver 一致）
  if (looksLikePlaylist(input)) {
    return { kind: 'playlist', normalized: input };
  }

  // 规则 3：单视频
  if (VIDEO_PATTERNS.some((p) => p.test(input))) {
    return { kind: 'video', normalized: input };
  }

  // 规则 4：频道
  if (CHANNEL_PATTERNS.some((p) => p.test(input))) {
    return { kind: 'channel', normalized: input };
  }

  // 规则 5：其余视为搜索关键词
  return { kind: 'search', normalized: input };
}
