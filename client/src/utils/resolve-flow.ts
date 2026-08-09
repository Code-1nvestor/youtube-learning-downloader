import { ApiError, type ResolveResult } from '../api';
import type { UserFacingError } from '../store';

interface ResolveFlowActions {
  setResolving: (resolving: boolean) => void;
  setResolveResult: (result: ResolveResult | null) => void;
  setError: (error: UserFacingError | null) => void;
}

type ResolveRequest = (query: string) => Promise<ResolveResult>;

/**
 * 执行一次首页解析，并保证成功或失败后都会结束等待状态。
 * 独立成纯流程函数，便于覆盖切页期间仍在进行的异步请求。
 */
export async function runResolveFlow(
  query: string,
  request: ResolveRequest,
  actions: ResolveFlowActions,
): Promise<void> {
  actions.setResolving(true);
  actions.setError(null);

  try {
    const result = await request(query);
    actions.setResolveResult(result);
  } catch (error) {
    actions.setResolveResult(null);
    actions.setError(toUserFacingResolveError(error));
  } finally {
    actions.setResolving(false);
  }
}

function toUserFacingResolveError(error: unknown): UserFacingError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'UNKNOWN', message: '解析失败，请检查网络或 URL' };
}
