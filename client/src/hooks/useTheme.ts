/**
 * useTheme.ts - 主题切换 Hook
 *
 * 管理亮色/暗色主题，支持三种模式：
 * - light: 强制亮色
 * - dark: 强制暗色
 * - system: 跟随系统偏好（默认）
 *
 * 持久化到 localStorage，在 <html> 上切换 .dark 类。
 * 与 index.html 中的内联脚本配合，避免首屏闪烁。
 */

import { useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

/** 获取当前实际生效的主题（system 解析为 light 或 dark） */
function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/** 应用主题到 <html> 元素 */
function applyTheme(resolved: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/** 从 localStorage 读取主题模式（无效值回退到 system） */
function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage 不可用
  }
  return 'system';
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => getResolvedTheme(readStoredMode()));

  // 应用主题副作用
  useEffect(() => {
    const resolvedTheme = getResolvedTheme(mode);
    applyTheme(resolvedTheme);
    setResolved(resolvedTheme);

    // 持久化（system 模式也存储，以便下次恢复选择）
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 忽略写入失败
    }
  }, [mode]);

  // 监听系统主题变化（仅 system 模式下响应）
  useEffect(() => {
    if (mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const newResolved = e.matches ? 'dark' : 'light';
      applyTheme(newResolved);
      setResolved(newResolved);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [mode]);

  const setThemeMode = useCallback((m: ThemeMode) => setMode(m), []);

  // 在三个模式间循环切换（用于快速切换按钮）
  const cycleMode = useCallback(() => {
    setMode((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  }, []);

  return { mode, resolved, setThemeMode, cycleMode };
}
