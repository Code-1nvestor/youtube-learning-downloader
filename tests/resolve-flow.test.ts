import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, type ResolveResult } from '../client/src/api.ts';
import { useStore } from '../client/src/store.ts';
import { runResolveFlow } from '../client/src/utils/resolve-flow.ts';

const result: ResolveResult = {
  kind: 'video',
  title: '测试课程',
  videos: [],
};

function resetResolveState(): void {
  useStore.setState({
    view: 'home',
    resolveInput: '',
    resolveResult: null,
    resolving: false,
    error: null,
  });
}

test.beforeEach(resetResolveState);

test('keeps the pasted link and pending state while switching views', async () => {
  let finishResolve: ((value: ResolveResult) => void) | undefined;
  const pendingRequest = new Promise<ResolveResult>((resolve) => {
    finishResolve = resolve;
  });
  const store = useStore.getState();

  store.setResolveInput('https://www.youtube.com/watch?v=demo');
  const resolvePromise = runResolveFlow(
    store.resolveInput,
    () => pendingRequest,
    store,
  );

  useStore.getState().setView('settings');
  useStore.getState().setView('home');
  assert.equal(useStore.getState().resolveInput, 'https://www.youtube.com/watch?v=demo');
  assert.equal(useStore.getState().resolving, true);

  assert.ok(finishResolve);
  finishResolve(result);
  await resolvePromise;
  assert.equal(useStore.getState().resolving, false);
  assert.deepEqual(useStore.getState().resolveResult, result);
});

test('ends the waiting state and keeps a successful result visible', async () => {
  await runResolveFlow('demo', async () => result, useStore.getState());

  assert.equal(useStore.getState().resolving, false);
  assert.equal(useStore.getState().error, null);
  assert.deepEqual(useStore.getState().resolveResult, result);
});

test('ends the waiting state and keeps a resolve error visible', async () => {
  await runResolveFlow(
    'demo',
    async () => {
      throw new ApiError('TIMEOUT', '解析超时，请检查网络');
    },
    useStore.getState(),
  );

  assert.equal(useStore.getState().resolving, false);
  assert.equal(useStore.getState().resolveResult, null);
  assert.deepEqual(useStore.getState().error, {
    code: 'TIMEOUT',
    message: '解析超时，请检查网络',
  });
});
