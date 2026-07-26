/**
 * Queue.tsx - 下载队列页
 *
 * 功能：显示所有任务，自动轮询进度，支持暂停/恢复/取消/删除。
 *
 * 轮询策略：
 * - 页面挂载时启动，每 1.5 秒拉取一次队列状态
 * - 有活跃任务（downloading/queued）时持续轮询
 * - 全部完成/失败/取消时停止轮询
 * - 页面卸载时停止轮询
 */

import { useEffect, useRef } from 'react';
import { api, ApiError, type DownloadTask } from '../api';
import { useStore } from '../store';

const POLL_INTERVAL = 1500;

export function Queue() {
  const { tasks, setTasks, polling, setPolling, notify } = useStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询逻辑
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await api.getQueue();
        if (cancelled) return;
        setTasks(status.tasks);

        // 有活跃任务时继续轮询，否则停止
        const hasActive = status.tasks.some(
          (t) => t.status === 'downloading' || t.status === 'queued',
        );
        if (!hasActive && polling) {
          setPolling(false);
        } else if (hasActive && !polling) {
          setPolling(true);
        }
      } catch (e) {
        // 轮询失败不弹通知，只在控制台记录
        console.error('[queue] 轮询失败:', e);
      }
    };

    // 启动时立即拉取一次
    poll();

    // 有活跃任务时启动定时器
    if (polling) {
      timerRef.current = setInterval(poll, POLL_INTERVAL);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [polling, setTasks, setPolling]);

  const handleAction = async (task: DownloadTask, action: 'pause' | 'resume' | 'cancel' | 'remove') => {
    try {
      const status =
        action === 'pause' ? await api.pauseTask(task.id)
        : action === 'resume' ? await api.resumeTask(task.id)
        : action === 'cancel' ? await api.cancelTask(task.id)
        : await api.removeTask(task.id);
      setTasks(status.tasks);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '操作失败';
      notify(msg);
    }
  };

  // 空状态
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-sm">暂无下载任务</p>
        <p className="text-xs mt-1">在首页输入 YouTube 链接开始下载</p>
      </div>
    );
  }

  // 按播放列表分组
  const groups = groupByPlaylist(tasks);

  return (
    <div className="space-y-4">
      {groups.map(([group, items]) => (
        <div key={group} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 分组标题 */}
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{group}</span>
            <span className="text-xs text-gray-400">{items.length} 个任务</span>
          </div>
          {/* 任务列表 */}
          <div className="divide-y divide-gray-50">
            {items.map((task) => (
              <TaskItem key={task.id} task={task} onAction={handleAction} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskItem({
  task,
  onAction,
}: {
  task: DownloadTask;
  onAction: (task: DownloadTask, action: 'pause' | 'resume' | 'cancel' | 'remove') => void;
}) {
  const statusColor: Record<string, string> = {
    queued: 'text-gray-500 bg-gray-100',
    downloading: 'text-blue-600 bg-blue-50',
    completed: 'text-green-600 bg-green-50',
    failed: 'text-red-600 bg-red-50',
    cancelled: 'text-gray-400 bg-gray-100',
    paused: 'text-amber-600 bg-amber-50',
  };

  const statusLabel: Record<string, string> = {
    queued: '排队中',
    downloading: '下载中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    paused: '已暂停',
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      {/* 标题 + 进度 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-800 truncate flex-1">{task.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor[task.status]}`}>
            {statusLabel[task.status]}
          </span>
        </div>
        {/* 进度条 */}
        {(task.status === 'downloading' || task.status === 'paused') && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: `${Math.min(task.progress, 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 tabular-nums w-10 text-right">
              {Math.round(task.progress)}%
            </span>
            {task.speed && (
              <span className="text-xs text-gray-400 tabular-nums">{task.speed}</span>
            )}
            {task.eta && task.status === 'downloading' && (
              <span className="text-xs text-gray-400">ETA {task.eta}</span>
            )}
          </div>
        )}
        {/* 错误信息 */}
        {task.status === 'failed' && task.error && (
          <p className="text-xs text-red-500 mt-1 truncate">{task.error}</p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-1 flex-shrink-0">
        {(task.status === 'downloading' || task.status === 'queued') && (
          <ActionButton onClick={() => onAction(task, 'pause')} title="暂停">
            ⏸
          </ActionButton>
        )}
        {(task.status === 'paused' || task.status === 'failed') && (
          <ActionButton onClick={() => onAction(task, 'resume')} title="恢复">
            ▶
          </ActionButton>
        )}
        {(task.status === 'downloading' || task.status === 'queued' || task.status === 'paused') && (
          <ActionButton onClick={() => onAction(task, 'cancel')} title="取消" danger>
            ✕
          </ActionButton>
        )}
        {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
          <ActionButton onClick={() => onAction(task, 'remove')} title="移除">
            🗑
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

// ==========================================
// 工具
// ==========================================

function groupByPlaylist(tasks: DownloadTask[]): [string, DownloadTask[]][] {
  const map = new Map<string, DownloadTask[]>();
  for (const t of tasks) {
    const key = t.playlistTitle ?? '未分类';
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  return Array.from(map.entries());
}
