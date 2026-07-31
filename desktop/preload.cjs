const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
  }),
);
