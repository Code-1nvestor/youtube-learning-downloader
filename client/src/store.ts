/**
 * store.ts - Zustand 全局状态管理
 *
 * 管理核心维度：
 * 1. 视图切换（home / queue / history / settings）
 * 2. 解析流程（结果、加载态、错误）
 * 3. 队列状态（任务列表、轮询控制）
 * 4. 网络状态（在线/离线）
 *
 * 不用 React Router：页面少（4 个），用 state 切换更简洁。
 */

import { create } from 'zustand';
import type { ResolveResult, DownloadTask, CookieStatus } from './api';

type View = 'home' | 'queue' | 'history' | 'settings';
export type SettingsTarget = 'download' | 'network' | 'runtime' | 'update' | 'diagnostics' | 'cookie' | 'about';

export interface UserFacingError {
  code: string;
  message: string;
}

interface AppState {
  // -- 视图 --
  view: View;
  setView: (v: View) => void;
  settingsTarget: SettingsTarget | null;
  openSettings: (target?: SettingsTarget) => void;
  clearSettingsTarget: () => void;

  // -- 解析 --
  resolveResult: ResolveResult | null;
  resolving: boolean;
  error: UserFacingError | null;
  setResolving: (b: boolean) => void;
  setResolveResult: (r: ResolveResult | null) => void;
  setError: (e: UserFacingError | null) => void;

  // -- 队列 --
  tasks: DownloadTask[];
  setTasks: (t: DownloadTask[]) => void;

  // -- Cookie --
  cookieStatus: CookieStatus | null;
  setCookieStatus: (c: CookieStatus | null) => void;

  // -- 网络状态 --
  online: boolean;
  setOnline: (b: boolean) => void;

  // -- 全局通知 --
  notice: string | null;
  notify: (msg: string) => void;
  clearNotice: () => void;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function cancelNoticeTimer(): void {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
}

export const useStore = create<AppState>((set) => ({
  // 视图
  view: 'home',
  setView: (v) => set({ view: v }),
  settingsTarget: null,
  openSettings: (target) => set({ view: 'settings', settingsTarget: target ?? null }),
  clearSettingsTarget: () => set({ settingsTarget: null }),

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

  // Cookie
  cookieStatus: null,
  setCookieStatus: (c) => set({ cookieStatus: c }),

  // 网络状态
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  setOnline: (b) => set({ online: b }),

  // 通知
  notice: null,
  notify: (msg) => {
    cancelNoticeTimer();
    set({ notice: msg });
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      set({ notice: null });
    }, 3000);
  },
  clearNotice: () => {
    cancelNoticeTimer();
    set({ notice: null });
  },
}));
