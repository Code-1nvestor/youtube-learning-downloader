interface ResolveResultIdentityInput {
  kind: string;
  title: string;
  videos: readonly { id: string }[];
}

/**
 * 为一次解析结果生成稳定身份。
 *
 * React 依赖该身份隔离单视频/批量下载表单状态。标题、结果类型、视频顺序或
 * 视频集合任一变化时都必须重建表单，避免新列表复用旧列表的勾选索引。
 */
export function resolveResultIdentity(result: ResolveResultIdentityInput): string {
  return JSON.stringify([
    result.kind,
    result.title,
    result.videos.map((video) => video.id),
  ]);
}
