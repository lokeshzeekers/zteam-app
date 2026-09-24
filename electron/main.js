const { app, BrowserWindow, Notification, ipcMain, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Windows groups/pins the app correctly in the taskbar when this is set
// BEFORE the app is ready, and matches the id used in package.json "build.appId".
app.setAppUserModelId('com.zteam.desktop');

let mainWindow;

// ---- Single instance ----------------------------------------------------------
// Closing the window quits Zteam completely (see the 'close' handler). This lock is
// the safety net for double-clicks and repeated launches: a second launch never
// starts another full copy (window, server session, taskbar entry) — it just brings
// the running window to the front and exits immediately.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
}

// Bring the (possibly hidden or minimized) window to the front.
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  stopContinuousFlash();
  clearOverlayBadge();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else showMainWindow();
});

// Point the bundled desktop client at your production server.
// Set this to your Hostinger VPS domain, e.g. https://zteam.yourdomain.com
// (The web build embeds this at build-time via VITE_API_URL; this is a fallback
// for loading the local client-dist folder if you prefer bundling the UI too.)
const START_URL = process.env.ZTEAM_APP_URL || 'https://zteam.zeekerstech.com';

// ---- Taskbar flashing --------------------------------------------------------
// On Windows, flashFrame(true) is FlashWindowEx(..., uCount = 4): the OS blinks
// the taskbar button exactly 4 times, then goes quiet (button stays orange) — one
// call can never blink "until focused". (Verified in Electron's
// native_window_views.cc + Chromium's HWNDMessageHandler::FlashFrame.)
// So while the window is not focused we re-arm it: STOP, a short pause so
// Windows really processes the stop, then START a fresh 4-blink round.
// (The previous version fired STOP and START back-to-back in the same tick, which
// did not give a reliable restart.)
// One repeating timer at most; everything is cleared on focus / hide / quit.
const FLASH_REARM_MS = 2000; // how often a new blink round is started
const FLASH_RESTART_GAP_MS = 300; // pause between the STOP and the next START

let flashTimer = null;
let flashRestartTimer = null;

// A hidden window has no taskbar button to blink.
function canFlash() {
  return !!mainWindow && !mainWindow.isDestroyed()
    && (mainWindow.isVisible() || mainWindow.isMinimized())
    && !mainWindow.isFocused();
}

function rearmFlash() {
  if (!canFlash()) { stopContinuousFlash(); return; }
  mainWindow.flashFrame(false);
  flashRestartTimer = setTimeout(() => {
    flashRestartTimer = null;
    if (flashTimer && canFlash()) mainWindow.flashFrame(true);
  }, FLASH_RESTART_GAP_MS);
}

function startContinuousFlash() {
  if (process.platform === 'darwin') return;
  if (!canFlash()) return; // already looking at Zteam (or nothing to blink): don't flash
  if (flashTimer) return; // already blinking, never stack timers
  mainWindow.flashFrame(true);
  flashTimer = setInterval(rearmFlash, FLASH_REARM_MS);
}

function stopContinuousFlash() {
  if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
  if (flashRestartTimer) { clearTimeout(flashRestartTimer); flashRestartTimer = null; }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
}

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
    stopContinuousFlash();
    clearOverlayBadge();
  });

  mainWindow.on('close', (e) => {
    if (app.isQuiting) return; // a real quit is already underway
    if (process.platform === 'darwin') {
      // macOS convention: closing the window keeps the app in the Dock.
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    // Windows/Linux: let the window close and the process exit immediately,
    // with NO renderer interaction on the way out.
    //
    // An earlier version of this handler called
    // mainWindow.webContents.executeJavaScript(...) here to ping the server
    // that we're going inactive before quitting. That call can hang
    // indefinitely on a window that's mid-close — the IPC round trip to the
    // renderer gets torn down along with the window without the promise ever
    // resolving or rejecting, .catch() included. That dangling operation is
    // what was actually keeping Zteam alive in the background needing a
    // manual End Task, and, since the single-instance lock only releases
    // once the process truly exits, is also why reopening kept starting
    // brand new sessions instead of focusing the existing one.
    //
    // No renderer round trip is needed for correctness: the server already
    // computes "is this person shown as online" as isActive AND a live
    // socket connection (see server/src/utils/presence.js). The moment this
    // process actually exits, the socket drops and presence flips to
    // offline on its own — nothing here needs to wait for or trigger that.
    app.isQuiting = true;
  });
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
  if (!gotTheLock) return; // a duplicate launch: the running instance handles it
  createWindow();

  // Check for a newer Zteam desktop release.
  // GitHub Releases is configured in electron/package.json.
  if (!app.isPackaged) {
    console.log('Auto-update check skipped in development mode.');
  } else {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Real quit cleanup ----
// Only cosmetic cleanup now (stop any taskbar flash) — the close handler above
// no longer routes through here to block on an async handshake before quitting.
// This still fires for quit paths that don't go through the window 'close'
// handler at all (Cmd+Q on macOS, the auto-updater's quitAndInstall, etc.),
// so it's kept as a safety net for the flashing/badge state, not for blocking.
app.on('before-quit', () => {
  app.isQuiting = true; // a real quit is underway: the close handler must let the window close
  stopContinuousFlash();
});

// ---- IPC: notifications + taskbar blink + badge, triggered from the web UI ----
// Notifications by tag, so one can be taken down again (e.g. its message was deleted).
const activeNotifications = new Map();

ipcMain.on('notify', (event, { title, body, tag }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title: title || 'Zteam', body: body || '' });
    n.on('click', showMainWindow);
    if (tag) {
      activeNotifications.get(tag)?.close();
      activeNotifications.set(tag, n);
      n.on('close', () => { if (activeNotifications.get(tag) === n) activeNotifications.delete(tag); });
    }
    n.show();
  }
});

ipcMain.on('close-notification', (event, tag) => {
  if (!tag) return;
  activeNotifications.get(tag)?.close();
  activeNotifications.delete(tag);
});

ipcMain.on('flash-taskbar', () => {
  if (!mainWindow) return;
  if (process.platform === 'darwin') {
    app.dock.bounce('critical');
  } else {
    // Windows & Linux: keeps re-blinking the taskbar icon until the window is focused
    startContinuousFlash();
  }
  setOverlayBadge();
});

ipcMain.on('clear-flash', () => {
  stopContinuousFlash();
  clearOverlayBadge();
});
