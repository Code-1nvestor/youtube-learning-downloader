/**
 * App.tsx - 应用根组件
 *
 * 布局：顶部导航栏 + 内容区。三个视图通过 Zustand 切换。
 */

import { useStore } from './store';
import { Home } from './pages/Home';
import { Queue } from './pages/Queue';
import { History } from './pages/History';
import { Settings } from './pages/Settings';

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const notice = useStore((s) => s.notice);

  return (
    <div className="min-h-screen flex flex-col">
      {/* 导航栏 */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="text-lg font-medium text-gray-800">学习资料下载器</span>
        <div className="flex gap-1">
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
        </div>
      </nav>

      {/* 全局通知 */}
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
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}
