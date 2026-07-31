/**
 * History.tsx - 下载历史页
 *
 * 功能：
 * - 分页展示已完成/失败/取消的下载任务
 * - 支持删除单条记录、清空全部历史
 * - 显示任务标题、状态、完成时间、输出路径
 *
 * 与 Queue 页的区别：
 * - Queue 展示活跃任务（queued/downloading/paused），有轮询
 * - History 展示终态任务（completed/failed/cancelled），无轮询，按需加载
 */

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError, type DownloadTask, type HistoryPage } from '../api';
import { useStore } from '../store';
import { getErrorGuidance } from '../utils/error-actions';
import { DownloadFileActions } from '../components/DownloadFileActions';

const PAGE_SIZE = 20;

export function History() {
  const { notify } = useStore();
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await api.getHistory(p, PAGE_SIZE);
      setData(result);
      setPage(result.page);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '加载历史失败';
      notify(msg);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load(1);
  }, [load]);

  const handleDelete = async (task: DownloadTask) => {
    if (!confirm(`确定删除历史记录"${task.title}"吗？`)) return;
    try {
      await api.deleteHistory(task.id);
      notify('已删除');
      // 重新加载当前页
      load(page);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '删除失败';
      notify(msg);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('确定清空所有历史记录吗？此操作不可恢复。')) return;
    try {
      const result = await api.clearHistory();
      notify(`已清空 ${result.deleted} 条记录`);
      load(1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '清空失败';
      notify(msg);
    }
  };

  // 加载中
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  // 空状态
  if (data && data.tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <p className="text-sm">暂无下载历史</p>
        <p className="text-xs mt-1">完成的下载任务会在这里显示</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      {data && data.tasks.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            共 {data.total} 条记录
          </span>
          <button
            onClick={handleClearAll}
            className="text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-950/40 dark:hover:bg-red-950/40 px-2 py-1 rounded transition-colors"
          >
            清空全部
          </button>
        </div>
      )}

      {/* 历史列表 */}
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {data.tasks.map((task) => (
              <HistoryItem key={task.id} task={task} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {/* 分页 */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
          >
            上一页
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {page} / {data.totalPages}
          </span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= data.totalPages || loading}
            className="px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({
  task,
  onDelete,
}: {
  task: DownloadTask;
  onDelete: (task: DownloadTask) => void;
}) {
  const openSettings = useStore((state) => state.openSettings);
  const statusColor: Record<string, string> = {
    completed: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40',
    failed: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 dark:bg-red-950/40',
    cancelled: 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700',
  };

  const statusLabel: Record<string, string> = {
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  // 格式化完成时间
  const completedTime = task.completedAt
    ? new Date(task.completedAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  // 格式化文件大小
  const sizeStr = task.totalBytes > 0
    ? formatBytes(task.totalBytes)
    : '';

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-800 dark:text-gray-100 truncate flex-1" title={task.title}>
            {task.title}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusColor[task.status]}`}>
            {statusLabel[task.status]}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
          {completedTime && <span>{completedTime}</span>}
          {task.playlistTitle && <span className="truncate">{task.playlistTitle}</span>}
          {sizeStr && <span className="tabular-nums">{sizeStr}</span>}
        </div>
        {/* 错误信息 */}
        {task.status === 'failed' && task.error && (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-red-500 dark:text-red-400 truncate" title={task.error}>{task.error}</p>
            {task.errorCode && getErrorGuidance(task.errorCode).settingsLabel && (
              <button type="button" onClick={() => openSettings(getErrorGuidance(task.errorCode!).settingsTarget)} className="shrink-0 text-xs text-primary-600 dark:text-primary-400 hover:underline">
                {getErrorGuidance(task.errorCode).settingsLabel}
              </button>
            )}
          </div>
        )}
        {/* 输出路径（仅完成时显示） */}
        {task.status === 'completed' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate" title={task.outputPath}>
            📁 {task.outputPath}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {task.status === 'completed' && <DownloadFileActions taskId={task.id} />}
        <button
          onClick={() => onDelete(task)}
          title="删除记录"
          className="w-7 h-7 flex items-center justify-center rounded text-sm text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:bg-red-950/40 dark:hover:bg-red-950/40 hover:text-red-500 dark:text-red-400 transition-colors flex-shrink-0"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] ?? 'B'}`;
}
