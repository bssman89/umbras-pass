const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  selectGgufFile: () => ipcRenderer.invoke('desktop:select-gguf-file'),
  getDesktopInfo: () => ipcRenderer.invoke('desktop:get-info'),
  openModelsFolder: () => ipcRenderer.invoke('desktop:open-models-folder'),
  openUpdatesFolder: () => ipcRenderer.invoke('desktop:open-updates-folder'),
  launchUpdateInstaller: (filePath) =>
    ipcRenderer.invoke('desktop:launch-update-installer', filePath),
  exitApp: () => ipcRenderer.invoke('desktop:exit-app'),
});
