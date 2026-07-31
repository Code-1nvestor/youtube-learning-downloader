const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
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
