const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mountfield', {
  getImages: () => ipcRenderer.invoke('get-mountfield-images')
});
