const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, nativeImage } = require('electron');
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
const START_URL = process.env.ZTEAM_APP_URL || `file://${path.join(__dirname, 'client-dist', 'index.html')}`;

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

  // Clear the blinking taskbar flag whenever the window regains focus.
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

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
    { label: 'Open Zteam', click: () => { mainWindow.show(); mainWindow.flashFrame(false); } },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('Zteam');
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); mainWindow.flashFrame(false); });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: notifications + taskbar blink, triggered from the web UI ----
ipcMain.on('notify', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title: title || 'Zteam', body: body || '' });
    n.on('click', () => { mainWindow.show(); mainWindow.focus(); mainWindow.flashFrame(false); });
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
});

ipcMain.on('clear-flash', () => {
  mainWindow?.flashFrame(false);
});
