/**
 * PWAInstallPrompt.tsx - PWA 安装提示组件
 *
 * 监听 beforeinstallprompt 事件，在应用可安装时显示提示横幅。
 * 用户安装后或拒绝后不再显示。
 *
 * 注意：iOS Safari 不支持 beforeinstallprompt，需手动引导添加到主屏幕。
 * 此组件仅在支持的浏览器（Chrome/Edge/Android）上显示安装按钮。
 */

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 已安装或已拒绝则不监听
    if (dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault(); // 阻止浏览器默认安装提示
      setInstallEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // 应用已安装则清除提示
    const installedHandler = () => setInstallEvent(null);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, [dismissed]);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'dismissed') {
      setDismissed(true);
    }
    setInstallEvent(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setInstallEvent(null);
  };

  if (!installEvent || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 max-w-sm card p-4 shadow-lg z-40 flex items-start gap-3">
      <span className="text-2xl flex-shrink-0">📱</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">安装到桌面</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          离线可用，像原生应用一样启动
        </p>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={handleInstall}
          className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
        >
          安装
        </button>
        <button
          onClick={handleDismiss}
          className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          稍后
        </button>
      </div>
    </div>
  );
}
