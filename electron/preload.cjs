const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  selectGgufFile: () => ipcRenderer.invoke('desktop:select-gguf-file'),
  getDesktopInfo: () => ipcRenderer.invoke('desktop:get-info'),
  openModelsFolder: () => ipcRenderer.invoke('desktop:open-models-folder'),
  exitApp: () => ipcRenderer.invoke('desktop:exit-app'),
});
