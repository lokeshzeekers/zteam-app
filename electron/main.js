const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Windows groups/pins the app correctly in the taskbar when this is set
// BEFORE the app is ready, and matches the id used in package.json "build.appId".
app.setAppUserModelId('com.zteam.desktop');

let mainWindow;
let tray;

// Point the bundled desktop client at your production server.
// Set this to your Hostinger VPS domain, e.g. https://zteam.yourdomain.com
// (The web build embeds this at build-time via VITE_API_URL; this is a fallback
// for loading the local client-dist folder if you prefer bundling the UI too.)
const START_URL = process.env.ZTEAM_APP_URL || 'https://zteam.zeekerstech.com';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(START_URL);

  // Clear the blinking taskbar flag AND the notification badge whenever the window regains focus.
  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
    clearOverlayBadge();
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting, so the app keeps receiving
    // messages/calls in the background (common for chat apps).
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: 'Open Zteam', click: () => { mainWindow.show(); mainWindow.flashFrame(false); clearOverlayBadge(); } },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('Zteam');
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); mainWindow.flashFrame(false); clearOverlayBadge(); });
}

// Windows-only: a small red dot drawn directly on the taskbar icon itself
// (same pattern Teams/Slack use for unread badges), separate from the
// flashing — it stays visible after the flash animation ends, until you
// actually focus the window. macOS gets the dock-badge equivalent.
function setOverlayBadge() {
  if (!mainWindow) return;
  if (process.platform === 'win32') {
    const badge = nativeImage.createFromPath(path.join(__dirname, 'assets', 'badge.png'));
    mainWindow.setOverlayIcon(badge, 'New notification');
  } else if (process.platform === 'darwin') {
    app.dock.setBadge('•');
  }
}
function clearOverlayBadge() {
  if (!mainWindow) return;
  if (process.platform === 'win32') mainWindow.setOverlayIcon(null, '');
  else if (process.platform === 'darwin') app.dock.setBadge('');
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Check for a newer Zteam desktop release.
  // GitHub Releases is configured in electron/package.json.
  if (!app.isPackaged) {
    console.log('Auto-update check skipped in development mode.');
  } else {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: notifications + taskbar blink + badge, triggered from the web UI ----
ipcMain.on('notify', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title: title || 'Zteam', body: body || '' });
    n.on('click', () => { mainWindow.show(); mainWindow.focus(); mainWindow.flashFrame(false); clearOverlayBadge(); });
    n.show();
  }
});

ipcMain.on('flash-taskbar', () => {
  if (!mainWindow) return;
  if (process.platform === 'darwin') {
    app.dock.bounce('critical');
  } else {
    // Windows & Linux: blinks/flashes the taskbar icon until the window is focused
    mainWindow.flashFrame(true);
  }
  setOverlayBadge();
});

ipcMain.on('clear-flash', () => {
  mainWindow?.flashFrame(false);
  clearOverlayBadge();
});
