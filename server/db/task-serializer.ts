/**
 * db/task-serializer.ts - DownloadTask <-> SQLite 行 转换
 *
 * SQLite 没有数组类型，subtitle_langs 以 JSON 字符串存储。
 * 布尔值 auto_subtitle 以 INTEGER(0/1) 存储。
 */

import type { DownloadTask, DownloadStatus } from '../types/download.ts';

/** SQLite 参数值类型（与 node:sqlite 的 SQLInputValue 对齐） */
export type SqlValue = null | number | string | bigint | Uint8Array;

/** SQLite 行类型（node:sqlite 返回的对象） */
export interface TaskRow {
  id: string;
  video_id: string;
  title: string;
  playlist_title: string | null;
  playlist_index: number | null;
  format_id: string;
  container: string;
  output_path: string;
  subtitle_langs: string;
  subtitle_mode: string;
  auto_subtitle: number;
  status: string;
  progress: number;
  speed: string;
  eta: string;
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

/** 将 DownloadTask 转换为预编译语句的命名参数对象 */
export function taskToRow(task: DownloadTask): Record<string, SqlValue> {
  return {
    $id: task.id,
    $video_id: task.videoId,
    $title: task.title,
    $playlist_title: task.playlistTitle ?? null,
    $playlist_index: task.playlistIndex ?? null,
    $format_id: task.formatId,
    $container: task.container,
    $output_path: task.outputPath,
    $subtitle_langs: JSON.stringify(task.subtitleLangs),
    $subtitle_mode: task.subtitleMode,
    $auto_subtitle: task.autoSubtitle ? 1 : 0,
    $status: task.status,
    $progress: task.progress,
    $speed: task.speed,
    $eta: task.eta,
    $downloaded_bytes: task.downloadedBytes,
    $total_bytes: task.totalBytes,
    $error: task.error ?? null,
    $created_at: task.createdAt,
    $completed_at: task.completedAt ?? null,
    $updated_at: new Date().toISOString(),
  };
}

/** 将 SQLite 行转换回 DownloadTask */
export function rowToTask(row: TaskRow): DownloadTask {
  return {
    id: row.id,
    videoId: row.video_id,
    title: row.title,
    ...(row.playlist_title ? { playlistTitle: row.playlist_title } : {}),
    ...(row.playlist_index != null ? { playlistIndex: row.playlist_index } : {}),
    formatId: row.format_id,
    container: row.container,
    outputPath: row.output_path,
    subtitleLangs: safeParseJson(row.subtitle_langs, []),
    subtitleMode: row.subtitle_mode as 'embed' | 'separate' | 'none',
    autoSubtitle: row.auto_subtitle === 1,
    status: row.status as DownloadStatus,
    progress: row.progress,
    speed: row.speed,
    eta: row.eta,
    downloadedBytes: row.downloaded_bytes,
    totalBytes: row.total_bytes,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function safeParseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
