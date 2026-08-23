const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
    startYoutubeAuth: () => ipcRenderer.invoke('desktop:start-youtube-auth'),
    completeYoutubeAuth: () => ipcRenderer.invoke('desktop:complete-youtube-auth'),
    cancelYoutubeAuth: () => ipcRenderer.invoke('desktop:cancel-youtube-auth'),
    selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
    openLogsDirectory: () => ipcRenderer.invoke('desktop:open-logs-directory'),
    saveDiagnosticReport: () => ipcRenderer.invoke('desktop:save-diagnostic-report'),
    saveDataBackup: () => ipcRenderer.invoke('desktop:save-data-backup'),
    restoreDataBackup: () => ipcRenderer.invoke('desktop:restore-data-backup'),
    openDownload: (taskId) => ipcRenderer.invoke('desktop:open-download', taskId),
    revealDownload: (taskId) => ipcRenderer.invoke('desktop:reveal-download', taskId),
    restartApp: () => ipcRenderer.invoke('desktop:restart-app'),
  }),
);
