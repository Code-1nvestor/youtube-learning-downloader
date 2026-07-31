const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
    openLogsDirectory: () => ipcRenderer.invoke('desktop:open-logs-directory'),
    openDownload: (taskId) => ipcRenderer.invoke('desktop:open-download', taskId),
    revealDownload: (taskId) => ipcRenderer.invoke('desktop:reveal-download', taskId),
    restartApp: () => ipcRenderer.invoke('desktop:restart-app'),
  }),
);
