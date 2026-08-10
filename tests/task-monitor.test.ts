import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  calculateTaskbarProgress,
  createTaskMonitor,
  createTaskStatusSnapshot,
  describeTerminalTransitions,
} = require('../desktop/task-monitor.cjs') as {
  calculateTaskbarProgress: (status: unknown) => { value: number; mode: string };
  createTaskStatusSnapshot: (tasks: Task[]) => Map<string, string>;
  describeTerminalTransitions: (
    previous: ReadonlyMap<string, string> | null,
    tasks: Task[],
  ) => { title: string; body: string } | null;
  createTaskMonitor: (options: MonitorOptions) => {
    start: () => void;
    stop: () => void;
    pollNow: () => Promise<void>;
    isRunning: () => boolean;
  };
};

interface Task {
  id: string;
  title: string;
  status: string;
  progress?: number;
  totalBytes?: number;
  phase?: string;
}

interface MonitorOptions {
  loadQueueStatus: () => Promise<{ tasks: Task[] }>;
  updateTaskbar: (progress: { value: number; mode: string }) => void;
  showNotification: (notice: { title: string; body: string }) => void | Promise<void>;
  shouldNotify?: () => boolean;
  onError?: (error: unknown) => void;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancelSchedule?: (timer: unknown) => void;
}

function task(id: string, status: string, progress = 0, title = `任务 ${id}`): Task {
  return { id, status, progress, title, totalBytes: 100 };
}

test('maps queue state to Windows taskbar progress modes', () => {
  assert.deepEqual(calculateTaskbarProgress({
    tasks: [task('one', 'downloading', 20), task('two', 'downloading', 80)],
  }), { value: 0.5, mode: 'normal' });
  assert.deepEqual(calculateTaskbarProgress({
    tasks: [task('bad-low', 'downloading', -20), task('bad-high', 'downloading', 140)],
  }), { value: 0.5, mode: 'normal' });
  assert.deepEqual(calculateTaskbarProgress({ tasks: [task('wait', 'retrying')] }), {
    value: 2,
    mode: 'indeterminate',
  });
  assert.deepEqual(calculateTaskbarProgress({ tasks: [task('paused', 'paused', 35)] }), {
    value: 0.35,
    mode: 'paused',
  });
  assert.deepEqual(calculateTaskbarProgress({ tasks: [task('done', 'completed', 100)] }), {
    value: -1,
    mode: 'none',
  });
  assert.throws(() => calculateTaskbarProgress({}), /tasks 数组/);
});

test('uses indeterminate taskbar mode for unknown-size downloads and merge phases', () => {
  assert.deepEqual(calculateTaskbarProgress({
    tasks: [{ ...task('unknown', 'downloading'), totalBytes: 0, phase: 'downloading-video' }],
  }), { value: 2, mode: 'indeterminate' });
  assert.deepEqual(calculateTaskbarProgress({
    tasks: [{ ...task('merge', 'downloading', 100), phase: 'merging' }],
  }), { value: 2, mode: 'indeterminate' });
});

test('uses the first desktop sync as a silent baseline and reports terminal transitions once', () => {
  const baseline = [task('one', 'downloading', 60), task('old', 'completed', 100)];
  assert.equal(describeTerminalTransitions(null, baseline), null);

  const next = [
    task('one', 'completed', 100, '机械设计基础'),
    task('two', 'failed', 20, '液压系统课程'),
    task('old', 'completed', 100),
  ];
  const notice = describeTerminalTransitions(createTaskStatusSnapshot(baseline), next);
  assert.deepEqual(notice, {
    title: '下载任务有新结果',
    body: '1 个任务下载完成，1 个任务下载失败，请打开下载队列查看。',
  });
  assert.equal(describeTerminalTransitions(createTaskStatusSnapshot(next), next), null);
});

test('reports a fast task that first appears after completion', () => {
  assert.deepEqual(
    describeTerminalTransitions(new Map(), [task('fast', 'completed', 100, '三分钟课程')]),
    { title: '下载完成', body: '“三分钟课程”已经下载完成。' },
  );
});

test('polls sequentially, adapts interval, suppresses focused-window notifications, and stops cleanly', async () => {
  const scheduled: Array<{ callback: () => void; delay: number; token: object }> = [];
  const cancelled: unknown[] = [];
  const taskbar: Array<{ value: number; mode: string }> = [];
  const notices: Array<{ title: string; body: string }> = [];
  const statuses = [
    { tasks: [task('one', 'downloading', 25, '装配课程')] },
    { tasks: [task('one', 'completed', 100, '装配课程')] },
    { tasks: [task('one', 'failed', 100, '装配课程')] },
  ];
  let focused = true;
  let loadCalls = 0;

  const monitor = createTaskMonitor({
    loadQueueStatus: async () => statuses[loadCalls++]!,
    updateTaskbar: (progress) => taskbar.push(progress),
    showNotification: (notice) => { notices.push(notice); },
    shouldNotify: () => !focused,
    activeIntervalMs: 10,
    idleIntervalMs: 40,
    schedule: (callback, delay) => {
      const token = {};
      scheduled.push({ callback, delay, token });
      return token;
    },
    cancelSchedule: (timer) => { cancelled.push(timer); },
  });

  monitor.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delay, 10);
  assert.deepEqual(taskbar.at(-1), { value: 0.25, mode: 'normal' });

  scheduled.shift()?.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 2);
  assert.equal(notices.length, 0);
  assert.equal(scheduled[0]?.delay, 40);

  focused = false;
  scheduled.shift()?.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 3);
  assert.deepEqual(notices, [{
    title: '下载失败',
    body: '“装配课程”下载失败，请打开下载队列查看。',
  }]);

  const pendingTimer = scheduled[0]?.token;
  monitor.stop();
  assert.equal(monitor.isRunning(), false);
  assert.deepEqual(cancelled, [pendingTimer]);
  assert.deepEqual(taskbar.at(-1), { value: -1, mode: 'none' });
});

test('does not restore stale taskbar progress when an in-flight poll finishes after stop', async () => {
  let finishLoad: ((status: { tasks: Task[] }) => void) | undefined;
  const taskbar: Array<{ value: number; mode: string }> = [];
  const monitor = createTaskMonitor({
    loadQueueStatus: () => new Promise((resolve) => { finishLoad = resolve; }),
    updateTaskbar: (progress) => taskbar.push(progress),
    showNotification: () => {},
  });

  monitor.start();
  await new Promise((resolve) => setImmediate(resolve));
  monitor.stop();
  finishLoad?.({ tasks: [task('late', 'downloading', 90)] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(taskbar, [{ value: -1, mode: 'none' }]);
});
