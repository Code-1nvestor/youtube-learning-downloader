'use strict';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'retrying']);

function summarizeActiveTasks(queueStatus) {
  if (!queueStatus || !Array.isArray(queueStatus.tasks)) {
    throw new Error('队列状态缺少 tasks 数组');
  }

  const summary = { downloading: 0, queued: 0, retrying: 0, total: 0 };
  for (const task of queueStatus.tasks) {
    if (!task || typeof task !== 'object' || !ACTIVE_STATUSES.has(task.status)) continue;
    summary[task.status] += 1;
    summary.total += 1;
  }
  return summary;
}

function formatActiveTaskSummary(summary) {
  const parts = [];
  if (summary.downloading > 0) parts.push(`下载中 ${summary.downloading} 个`);
  if (summary.queued > 0) parts.push(`排队中 ${summary.queued} 个`);
  if (summary.retrying > 0) parts.push(`等待重试 ${summary.retrying} 个`);
  return parts.join('，');
}

function createCloseGuard({ loadQueueStatus, confirmClose, approveClose, onError = () => {} }) {
  if (typeof loadQueueStatus !== 'function') throw new TypeError('loadQueueStatus 必须是函数');
  if (typeof confirmClose !== 'function') throw new TypeError('confirmClose 必须是函数');
  if (typeof approveClose !== 'function') throw new TypeError('approveClose 必须是函数');

  let approved = false;
  let checking = false;

  const finishClose = () => {
    approved = true;
    try {
      approveClose();
    } catch (error) {
      approved = false;
      onError(error);
    }
  };

  const requestClose = async () => {
    if (approved || checking) return;
    checking = true;
    try {
      let summary = null;
      let statusKnown = true;
      try {
        summary = summarizeActiveTasks(await loadQueueStatus());
      } catch (error) {
        statusKnown = false;
        onError(error);
      }

      if (statusKnown && summary.total === 0) {
        finishClose();
        return;
      }

      try {
        const confirmed = await confirmClose({ statusKnown, summary });
        if (confirmed) finishClose();
      } catch (error) {
        onError(error);
      }
    } finally {
      checking = false;
    }
  };

  const handleClose = (event) => {
    if (approved) return false;
    event.preventDefault();
    void requestClose();
    return true;
  };

  return {
    handleClose,
    requestClose,
    isApproved: () => approved,
    isChecking: () => checking,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  createCloseGuard,
  formatActiveTaskSummary,
  summarizeActiveTasks,
};
