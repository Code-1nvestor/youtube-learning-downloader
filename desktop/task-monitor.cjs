'use strict';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'retrying']);

function readTasks(queueStatus) {
  if (!queueStatus || !Array.isArray(queueStatus.tasks)) {
    throw new Error('队列状态缺少 tasks 数组');
  }
  return queueStatus.tasks.filter((task) => task && typeof task === 'object');
}

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

function averageProgress(tasks) {
  if (tasks.length === 0) return 0;
  return tasks.reduce((sum, task) => sum + clampProgress(task.progress), 0) / tasks.length / 100;
}

function calculateTaskbarProgress(queueStatus) {
  const tasks = readTasks(queueStatus);
  const downloading = tasks.filter((task) => task.status === 'downloading');
  if (downloading.length > 0) {
    const hasIndeterminatePhase = downloading.some((task) => (
      !Number.isFinite(Number(task.totalBytes))
      || Number(task.totalBytes) <= 0
      || task.phase === 'merging'
      || task.phase === 'post-processing'
    ));
    if (hasIndeterminatePhase) return { value: 2, mode: 'indeterminate' };
    return { value: averageProgress(downloading), mode: 'normal' };
  }

  if (tasks.some((task) => task.status === 'queued' || task.status === 'retrying')) {
    return { value: 2, mode: 'indeterminate' };
  }

  const paused = tasks.filter((task) => task.status === 'paused');
  if (paused.length > 0) {
    return { value: Math.max(0.01, averageProgress(paused)), mode: 'paused' };
  }

  return { value: -1, mode: 'none' };
}

function createTaskStatusSnapshot(tasks) {
  return new Map(tasks.map((task) => [String(task.id), task.status]));
}

function shortTitle(title) {
  const normalized = String(title ?? '').trim() || '未命名任务';
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}

function describeTerminalTransitions(previous, tasks) {
  if (previous === null) return null;

  const completed = [];
  const failed = [];
  for (const task of tasks) {
    const oldStatus = previous.get(String(task.id));
    if (oldStatus === task.status) continue;
    if (task.status === 'completed') completed.push(task);
    if (task.status === 'failed') failed.push(task);
  }

  if (completed.length === 1 && failed.length === 0) {
    return { title: '下载完成', body: `“${shortTitle(completed[0].title)}”已经下载完成。` };
  }
  if (failed.length === 1 && completed.length === 0) {
    return { title: '下载失败', body: `“${shortTitle(failed[0].title)}”下载失败，请打开下载队列查看。` };
  }
  if (completed.length === 0 && failed.length === 0) return null;

  const parts = [];
  if (completed.length > 0) parts.push(`${completed.length} 个任务下载完成`);
  if (failed.length > 0) parts.push(`${failed.length} 个任务下载失败`);
  return {
    title: failed.length > 0 ? '下载任务有新结果' : '下载完成',
    body: `${parts.join('，')}${failed.length > 0 ? '，请打开下载队列查看。' : '。'}`,
  };
}

function createTaskMonitor({
  loadQueueStatus,
  updateTaskbar,
  showNotification,
  shouldNotify = () => true,
  onError = () => {},
  activeIntervalMs = 1_500,
  idleIntervalMs = 4_000,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = (timer) => clearTimeout(timer),
}) {
  if (typeof loadQueueStatus !== 'function') throw new TypeError('loadQueueStatus 必须是函数');
  if (typeof updateTaskbar !== 'function') throw new TypeError('updateTaskbar 必须是函数');
  if (typeof showNotification !== 'function') throw new TypeError('showNotification 必须是函数');

  let running = false;
  let polling = false;
  let timer = null;
  let previous = null;

  const poll = async () => {
    if (!running || polling) return;
    polling = true;
    let nextDelay = idleIntervalMs;

    try {
      const queueStatus = await loadQueueStatus();
      if (!running) return;
      const tasks = readTasks(queueStatus);
      const notification = describeTerminalTransitions(previous, tasks);
      previous = createTaskStatusSnapshot(tasks);
      nextDelay = tasks.some((task) => ACTIVE_STATUSES.has(task.status))
        ? activeIntervalMs
        : idleIntervalMs;

      try {
        updateTaskbar(calculateTaskbarProgress(queueStatus));
      } catch (error) {
        onError(error);
      }

      if (notification) {
        try {
          if (shouldNotify()) await showNotification(notification);
        } catch (error) {
          onError(error);
        }
      }
    } catch (error) {
      onError(error);
    } finally {
      polling = false;
      if (running) {
        timer = schedule(() => {
          timer = null;
          void poll();
        }, nextDelay);
      }
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      void poll();
    },
    stop() {
      running = false;
      previous = null;
      if (timer !== null) cancelSchedule(timer);
      timer = null;
      try {
        updateTaskbar({ value: -1, mode: 'none' });
      } catch (error) {
        onError(error);
      }
    },
    pollNow: poll,
    isRunning: () => running,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  calculateTaskbarProgress,
  createTaskMonitor,
  createTaskStatusSnapshot,
  describeTerminalTransitions,
};
