const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zteamDesktop', {
  notify: (payload) => ipcRenderer.send('notify', payload),
  flash: () => ipcRenderer.send('flash-taskbar'),
  clearFlash: () => ipcRenderer.send('clear-flash'),
});
