import { useState } from 'react';
import { useStore } from '../store';

export function DownloadFileActions({ taskId }: { taskId: string }) {
  const notify = useStore((state) => state.notify);
  const [busyAction, setBusyAction] = useState<'open' | 'reveal' | null>(null);

  if (!window.desktop) return null;

  const run = async (action: 'open' | 'reveal') => {
    setBusyAction(action);
    try {
      const result = action === 'open'
        ? await window.desktop!.openDownload(taskId)
        : await window.desktop!.revealDownload(taskId);
      if (result.error) {
        notify(result.error);
      } else if (action === 'reveal') {
        notify('已在文件夹中定位下载结果');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '桌面文件操作失败');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void run('open')}
        disabled={busyAction !== null}
        title="使用 Windows 默认程序打开文件"
        className="h-7 px-2 rounded text-xs text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 disabled:opacity-40"
      >
        {busyAction === 'open' ? '打开中…' : '打开'}
      </button>
      <button
        type="button"
        onClick={() => void run('reveal')}
        disabled={busyAction !== null}
        title="在 Windows 文件资源管理器中定位"
        className="h-7 px-2 rounded text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
      >
        {busyAction === 'reveal' ? '定位中…' : '文件夹'}
      </button>
    </div>
  );
}
