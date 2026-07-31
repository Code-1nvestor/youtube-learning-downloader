import type { DownloadStatus, DownloadTask } from '../api';

export type QueueTaskState = Pick<DownloadTask, 'id' | 'title' | 'status'>;
export type QueueStatusSnapshot = ReadonlyMap<string, DownloadStatus>;

const RUNNING_STATUSES = new Set<DownloadStatus>(['queued', 'downloading', 'retrying']);
const ATTENTION_STATUSES = new Set<DownloadStatus>([
  'queued',
  'downloading',
  'retrying',
  'paused',
]);

export function hasRunningQueueTasks(tasks: QueueTaskState[]): boolean {
  return tasks.some((task) => RUNNING_STATUSES.has(task.status));
}

export function countQueueAttentionTasks(tasks: QueueTaskState[]): number {
  return tasks.filter((task) => ATTENTION_STATUSES.has(task.status)).length;
}

export function createQueueStatusSnapshot(tasks: QueueTaskState[]): Map<string, DownloadStatus> {
  return new Map(tasks.map((task) => [task.id, task.status]));
}

/**
 * 首次同步只建立基线，不把旧历史误报为新完成；后续只报告新出现或刚进入终态的任务。
 */
export function describeQueueTransitions(
  previous: QueueStatusSnapshot | null,
  tasks: QueueTaskState[],
): string | null {
  if (previous === null) return null;

  const completed: QueueTaskState[] = [];
  const failed: QueueTaskState[] = [];

  for (const task of tasks) {
    const oldStatus = previous.get(task.id);
    if (oldStatus === task.status) continue;
    if (task.status === 'completed') completed.push(task);
    if (task.status === 'failed') failed.push(task);
  }

  if (completed.length === 1 && failed.length === 0) {
    return `下载完成：“${shortTitle(completed[0].title)}”`;
  }
  if (failed.length === 1 && completed.length === 0) {
    return `下载失败：“${shortTitle(failed[0].title)}”，请查看下载队列`;
  }
  if (completed.length === 0 && failed.length === 0) return null;

  const parts: string[] = [];
  if (completed.length > 0) parts.push(`${completed.length} 个任务下载完成`);
  if (failed.length > 0) parts.push(`${failed.length} 个任务下载失败`);
  return `${parts.join('，')}${failed.length > 0 ? '，请查看下载队列' : ''}`;
}

function shortTitle(title: string): string {
  const normalized = title.trim() || '未命名任务';
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}
