import { useEffect, useRef } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import {
  createQueueStatusSnapshot,
  describeQueueTransitions,
  hasRunningQueueTasks,
  type QueueStatusSnapshot,
} from '../utils/queue-status';

const ACTIVE_POLL_INTERVAL_MS = 1_500;
const ERROR_RETRY_INTERVAL_MS = 3_000;

/** 在所有页面持续同步活动任务；同一时刻最多只有一个队列请求。 */
export function useQueueSync(): void {
  const view = useStore((state) => state.view);
  const tasks = useStore((state) => state.tasks);
  const setTasks = useStore((state) => state.setTasks);
  const notify = useStore((state) => state.notify);
  const hasRunningTasks = hasRunningQueueTasks(tasks);
  const previousStatuses = useRef<QueueStatusSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let nextDelay: number | null = null;
      try {
        const queue = await api.getQueue();
        if (cancelled) return;

        const notice = describeQueueTransitions(previousStatuses.current, queue.tasks);
        previousStatuses.current = createQueueStatusSnapshot(queue.tasks);
        setTasks(queue.tasks);
        if (notice) notify(notice);

        if (hasRunningQueueTasks(queue.tasks)) nextDelay = ACTIVE_POLL_INTERVAL_MS;
      } catch (error) {
        console.error('[queue] 全局同步失败:', error);
        // 活动任务或队列页发生临时故障时继续低频恢复；其他页面避免空闲轮询。
        if (hasRunningTasks || view === 'queue') nextDelay = ERROR_RETRY_INTERVAL_MS;
      } finally {
        if (!cancelled && nextDelay !== null) {
          timer = setTimeout(() => void poll(), nextDelay);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [hasRunningTasks, notify, setTasks, view]);
}
