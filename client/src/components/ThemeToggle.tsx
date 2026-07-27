/**
 * ThemeToggle.tsx - 主题切换按钮
 *
 * 三态循环：light -> dark -> system -> light
 * 图标随当前模式变化，tooltip 标注当前模式
 */

import { useTheme, type ThemeMode } from '../hooks/useTheme';

const MODE_LABEL: Record<ThemeMode, string> = {
  light: '亮色模式',
  dark: '暗色模式',
  system: '跟随系统',
};

const MODE_ICON: Record<ThemeMode, string> = {
  light: '☀️',
  dark: '🌙',
  system: '🖥️',
};

export function ThemeToggle() {
  const { mode, cycleMode } = useTheme();

  return (
    <button
      onClick={cycleMode}
      title={MODE_LABEL[mode]}
      className="w-8 h-8 flex items-center justify-center rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label={MODE_LABEL[mode]}
    >
      {MODE_ICON[mode]}
    </button>
  );
}
