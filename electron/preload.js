const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zteamDesktop', {
  notify: (payload) => ipcRenderer.send('notify', payload),
  closeNotification: (tag) => ipcRenderer.send('close-notification', tag),
  flash: () => ipcRenderer.send('flash-taskbar'),
  clearFlash: () => ipcRenderer.send('clear-flash'),
});
