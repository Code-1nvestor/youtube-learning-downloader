export {};

declare global {
  interface Window {
    desktop?: {
      getAppVersion: () => Promise<string>;
      startYoutubeAuth: () => Promise<{ started: boolean; reused: boolean }>;
      completeYoutubeAuth: () => Promise<import('./api').CookieStatus>;
      cancelYoutubeAuth: () => Promise<boolean>;
      selectDirectory: () => Promise<string | null>;
      openLogsDirectory: () => Promise<{ path: string; error?: string }>;
      saveDiagnosticReport: () => Promise<{ saved: boolean; path?: string }>;
      saveDataBackup: () => Promise<{ saved: boolean; path?: string; taskCount?: number }>;
      restoreDataBackup: () => Promise<{ restored: boolean; restarting?: boolean }>;
      openDownload: (taskId: string) => Promise<{ path?: string; error?: string }>;
      revealDownload: (taskId: string) => Promise<{ path?: string; error?: string }>;
      restartApp: () => Promise<boolean>;
    };
  }
}
