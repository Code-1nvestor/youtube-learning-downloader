/**
 * App.tsx - 应用根组件
 *
 * 布局：顶部导航栏 + 内容区。四个视图通过 Zustand 切换。
 * Phase 6 新增：主题切换按钮（导航栏右侧）、PWA 安装提示、
 * 全局错误通知样式、网络状态监听与离线提示。
 */

import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Home } from './pages/Home';
import { Queue } from './pages/Queue';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { ThemeToggle } from './components/ThemeToggle';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { FirstRunWizard } from './components/FirstRunWizard';
import { useAppVersion } from './hooks/useAppVersion';

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openSettings = useStore((s) => s.openSettings);
  const notice = useStore((s) => s.notice);
  const online = useStore((s) => s.online);
  const setOnline = useStore((s) => s.setOnline);
  const notify = useStore((s) => s.notify);
  const appVersion = useAppVersion();
  const [wizardOpen, setWizardOpen] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('yld:first-run-complete:v1') !== '1',
  );

  // 监听网络状态变化
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      notify('网络已恢复');
    };
    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline, notify]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* 导航栏 */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center gap-6 sticky top-0 z-30">
        <div className="flex items-baseline gap-2 shrink-0">
          <span className="text-lg font-medium text-gray-800 dark:text-gray-100">
            学习资料下载器
          </span>
          {appVersion && (
            <button
              type="button"
              onClick={() => openSettings('about')}
              title="查看当前运行版本"
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400"
            >
              v{appVersion}
            </button>
          )}
        </div>
        <div className="flex gap-1 flex-1">
          <NavButton active={view === 'home'} onClick={() => setView('home')}>
            首页
          </NavButton>
          <NavButton active={view === 'queue'} onClick={() => setView('queue')}>
            下载队列
          </NavButton>
          <NavButton active={view === 'history'} onClick={() => setView('history')}>
            历史
          </NavButton>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')}>
            设置
          </NavButton>
          <NavButton active={false} onClick={() => setWizardOpen(true)}>
            使用准备
          </NavButton>
        </div>
        {/* 网络状态指示器 */}
        <span
          className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
          title={online ? '在线' : '离线'}
        />
        <ThemeToggle />
      </nav>

      {/* 离线横幅 */}
      {!online && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-6 py-2 text-center text-sm text-amber-700 dark:text-amber-400">
          当前处于离线状态，部分功能不可用
        </div>
      )}

      {/* 全局通知（信息） */}
      {notice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">
          {notice}
        </div>
      )}

      {/* 内容区 */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-6">
        {view === 'home' && <Home />}
        {view === 'queue' && <Queue />}
        {view === 'history' && <History />}
        {view === 'settings' && <Settings />}
      </main>

      {/* PWA 安装提示 */}
      <PWAInstallPrompt />
      <FirstRunWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onGoSettings={(target) => {
          setWizardOpen(false);
          openSettings(target);
        }}
      />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-primary-100 text-primary-700 dark:bg-primary-600 dark:text-white'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}
