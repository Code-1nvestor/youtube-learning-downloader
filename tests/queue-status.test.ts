import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countQueueAttentionTasks,
  createQueueStatusSnapshot,
  describeQueueTransitions,
  hasRunningQueueTasks,
  type QueueTaskState,
} from '../client/src/utils/queue-status.ts';

function task(id: string, status: QueueTaskState['status'], title = `任务 ${id}`): QueueTaskState {
  return { id, status, title };
}

test('counts running and paused work without keeping completed history in the badge', () => {
  const tasks = [
    task('queued', 'queued'),
    task('running', 'downloading'),
    task('retry', 'retrying'),
    task('paused', 'paused'),
    task('done', 'completed'),
    task('failed', 'failed'),
  ];

  assert.equal(hasRunningQueueTasks(tasks), true);
  assert.equal(countQueueAttentionTasks(tasks), 4);
  assert.equal(hasRunningQueueTasks([task('paused', 'paused')]), false);
});

test('uses the first queue sync as a silent baseline', () => {
  assert.equal(
    describeQueueTransitions(null, [task('old', 'completed', '以前完成的课程')]),
    null,
  );
});

test('reports newly completed and failed tasks without repeating unchanged terminal states', () => {
  const before = createQueueStatusSnapshot([
    task('one', 'downloading'),
    task('two', 'retrying'),
    task('old', 'completed'),
  ]);
  const after = [
    task('one', 'completed', '机械设计基础'),
    task('two', 'failed', '液压系统课程'),
    task('old', 'completed'),
  ];

  assert.equal(
    describeQueueTransitions(before, after),
    '1 个任务下载完成，1 个任务下载失败，请查看下载队列',
  );
  assert.equal(describeQueueTransitions(createQueueStatusSnapshot(after), after), null);
});

test('reports a fast task that first appears after it has already completed', () => {
  assert.equal(
    describeQueueTransitions(new Map(), [task('fast', 'completed', '三分钟课程')]),
    '下载完成：“三分钟课程”',
  );
});
