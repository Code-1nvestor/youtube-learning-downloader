import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createCloseGuard,
  formatActiveTaskSummary,
  summarizeActiveTasks,
} = require('../desktop/close-guard.cjs') as {
  createCloseGuard: (options: {
    loadQueueStatus: () => Promise<unknown>;
    confirmClose: (context: { statusKnown: boolean; summary: ActiveSummary | null }) => Promise<boolean>;
    approveClose: () => void;
    onError?: (error: unknown) => void;
  }) => {
    handleClose: (event: { preventDefault: () => void }) => boolean;
    requestClose: () => Promise<void>;
    isApproved: () => boolean;
    isChecking: () => boolean;
  };
  formatActiveTaskSummary: (summary: ActiveSummary) => string;
  summarizeActiveTasks: (queueStatus: unknown) => ActiveSummary;
};

interface ActiveSummary {
  downloading: number;
  queued: number;
  retrying: number;
  total: number;
}

test('summarizes only tasks that would be interrupted by application exit', () => {
  const summary = summarizeActiveTasks({
    tasks: [
      { status: 'downloading' },
      { status: 'queued' },
      { status: 'retrying' },
      { status: 'paused' },
      { status: 'completed' },
      { status: 'failed' },
      { status: 'cancelled' },
    ],
  });

  assert.deepEqual(summary, { downloading: 1, queued: 1, retrying: 1, total: 3 });
  assert.equal(formatActiveTaskSummary(summary), '下载中 1 个，排队中 1 个，等待重试 1 个');
  assert.throws(() => summarizeActiveTasks({}), /tasks 数组/);
});

test('closes immediately when no active download can be interrupted', async () => {
  let confirmationCalls = 0;
  let closeCalls = 0;
  const guard = createCloseGuard({
    loadQueueStatus: async () => ({ tasks: [{ status: 'paused' }, { status: 'completed' }] }),
    confirmClose: async () => {
      confirmationCalls += 1;
      return false;
    },
    approveClose: () => { closeCalls += 1; },
  });

  await guard.requestClose();
  assert.equal(closeCalls, 1);
  assert.equal(confirmationCalls, 0);
  assert.equal(guard.isApproved(), true);
});

test('keeps the application open when the user chooses to continue downloading', async () => {
  let closeCalls = 0;
  const guard = createCloseGuard({
    loadQueueStatus: async () => ({ tasks: [{ status: 'downloading' }] }),
    confirmClose: async ({ statusKnown, summary }) => {
      assert.equal(statusKnown, true);
      assert.equal(summary?.total, 1);
      return false;
    },
    approveClose: () => { closeCalls += 1; },
  });

  await guard.requestClose();
  assert.equal(closeCalls, 0);
  assert.equal(guard.isApproved(), false);
});

test('closes after explicit confirmation and allows the approved close event through', async () => {
  let closeCalls = 0;
  let prevented = 0;
  const guard = createCloseGuard({
    loadQueueStatus: async () => ({ tasks: [{ status: 'queued' }] }),
    confirmClose: async () => true,
    approveClose: () => { closeCalls += 1; },
  });

  assert.equal(guard.handleClose({ preventDefault: () => { prevented += 1; } }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCalls, 1);
  assert.equal(prevented, 1);
  assert.equal(guard.handleClose({ preventDefault: () => { prevented += 1; } }), false);
  assert.equal(prevented, 1);
});

test('uses a conservative confirmation when queue status cannot be read', async () => {
  const errors: unknown[] = [];
  let confirmationContext: { statusKnown: boolean; summary: ActiveSummary | null } | null = null;
  let closeCalls = 0;
  const guard = createCloseGuard({
    loadQueueStatus: async () => { throw new Error('backend unavailable'); },
    confirmClose: async (context) => {
      confirmationContext = context;
      return true;
    },
    approveClose: () => { closeCalls += 1; },
    onError: (error) => errors.push(error),
  });

  await guard.requestClose();
  assert.deepEqual(confirmationContext, { statusKnown: false, summary: null });
  assert.equal(errors.length, 1);
  assert.equal(closeCalls, 1);
});

test('coalesces repeated close attempts while one confirmation is pending', async () => {
  let releaseConfirmation: ((value: boolean) => void) | undefined;
  let loadCalls = 0;
  const guard = createCloseGuard({
    loadQueueStatus: async () => {
      loadCalls += 1;
      return { tasks: [{ status: 'retrying' }] };
    },
    confirmClose: () => new Promise<boolean>((resolve) => { releaseConfirmation = resolve; }),
    approveClose: () => {},
  });

  const first = guard.requestClose();
  const second = guard.requestClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guard.isChecking(), true);
  assert.equal(loadCalls, 1);
  releaseConfirmation?.(false);
  await Promise.all([first, second]);
  assert.equal(guard.isChecking(), false);
});
