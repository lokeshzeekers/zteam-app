// Bridges in-app events to OS-level notifications + taskbar icon blink.
// window.zteamDesktop is injected by Electron's preload script (see /electron/preload.js).
// When running as a plain web page (no Electron), falls back to the browser Notification API.

export function notifyDesktop({ title, body }) {
  if (window.zteamDesktop?.notify) {
    window.zteamDesktop.notify({ title, body });
    return;
  }
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  }
}

export function flashTaskbar() {
  window.zteamDesktop?.flash?.();
}

export function clearFlash() {
  window.zteamDesktop?.clearFlash?.();
}

export function playPing() {
  try {
    const audio = new Audio('/ping.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {
    /* ignore */
  }
}
