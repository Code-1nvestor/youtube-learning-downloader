/**
 * store.ts - Zustand 全局状态管理
 *
 * 管理三个核心维度：
 * 1. 视图切换（home / queue / settings）
 * 2. 解析流程（结果、加载态、错误）
 * 3. 队列状态（任务列表、轮询控制）
 *
 * 不用 React Router：页面少（3 个），用 state 切换更简洁。
 */

import { create } from 'zustand';
import type { ResolveResult, DownloadTask, CookieStatus } from './api';

type View = 'home' | 'queue' | 'settings';

interface AppState {
  // -- 视图 --
  view: View;
  setView: (v: View) => void;

  // -- 解析 --
  resolveResult: ResolveResult | null;
  resolving: boolean;
  error: string | null;
  setResolving: (b: boolean) => void;
  setResolveResult: (r: ResolveResult | null) => void;
  setError: (e: string | null) => void;

  // -- 队列 --
  tasks: DownloadTask[];
  setTasks: (t: DownloadTask[]) => void;
  polling: boolean;
  setPolling: (b: boolean) => void;

  // -- Cookie --
  cookieStatus: CookieStatus | null;
  setCookieStatus: (c: CookieStatus | null) => void;

  // -- 全局通知 --
  notice: string | null;
  notify: (msg: string) => void;
  clearNotice: () => void;
}

export const useStore = create<AppState>((set) => ({
  // 视图
  view: 'home',
  setView: (v) => set({ view: v }),

  // 解析
  resolveResult: null,
  resolving: false,
  error: null,
  setResolving: (b) => set({ resolving: b }),
  setResolveResult: (r) => set({ resolveResult: r, error: null }),
  setError: (e) => set({ error: e, resolving: false }),

  // 队列
  tasks: [],
  setTasks: (t) => set({ tasks: t }),
  polling: false,
  setPolling: (b) => set({ polling: b }),

  // Cookie
  cookieStatus: null,
  setCookieStatus: (c) => set({ cookieStatus: c }),

  // 通知
  notice: null,
  notify: (msg) => {
    set({ notice: msg });
    // 3 秒后自动清除
    setTimeout(() => set({ notice: null }), 3000);
  },
  clearNotice: () => set({ notice: null }),
}));
