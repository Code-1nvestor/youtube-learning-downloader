export {};

declare global {
  interface Window {
    desktop?: {
      getAppVersion: () => Promise<string>;
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
