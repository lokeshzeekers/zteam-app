// Bridges in-app events to OS-level notifications + taskbar icon blink.
// window.zteamDesktop is injected by Electron's preload script (see /electron/preload.js).
// When running as a plain web page (no Electron — e.g. testing via a pinned
// Chrome shortcut), this falls back to two real browser capabilities:
//   1. The Notification API — shows an OS toast. Requires permission, which
//      Chrome will only prompt for in response to an actual user click (see
//      requestNotificationPermission below) — a permission request fired
//      from a socket event handler is silently ignored by the browser.
//   2. The Badging API — puts a small dot/count on the taskbar/dock icon,
//      the closest browser-native equivalent to Electron's taskbar blink.
//      It only has a visible effect once the site is "installed" as an app
//      (see manifest.json + the Install option Chrome shows in the address
//      bar) — a plain tab or a "Create shortcut" window won't show it.
// Neither of these can make the taskbar icon literally flash/blink the way
// Electron's flashFrame() does — that native OS call is not exposed to web
// pages at all, in any browser, for any kind of installed or pinned site.
// That part of the behavior only exists in the real desktop (Electron) app.

export function getNotificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

// Call this directly from a click handler (a button, not a socket event) —
// that's the only way Chrome will actually show the permission prompt.
export function requestNotificationPermission() {
  if (!('Notification' in window)) return Promise.resolve('unsupported');
  return Notification.requestPermission();
}

// Notifications we've shown, by tag, so a cancelled call's toast can be closed again
// (e.g. the caller hangs up before anyone answers).
const shown = new Map();

export function notifyDesktop({ title, body, tag }) {
  if (window.zteamDesktop?.notify) {
    window.zteamDesktop.notify({ title, body, tag });
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag, renotify: !!tag });
    n.onclick = () => { window.focus(); n.close(); };
    if (tag) {
      shown.get(tag)?.close();
      shown.set(tag, n);
      n.onclose = () => { if (shown.get(tag) === n) shown.delete(tag); };
    }
  }
  // If permission is 'default' or 'denied' we deliberately do NOT call
  // requestPermission() here — this fires from a socket event, not a user
  // click, so Chrome would just ignore it. Use the "Enable notifications"
  // button in the app (see NotificationPrompt component) instead.
}

// Take a notification back down (used when a call stops ringing).
export function closeNotification(tag) {
  if (!tag) return;
  shown.get(tag)?.close();
  shown.delete(tag);
  window.zteamDesktop?.closeNotification?.(tag); // only present in newer desktop builds
}

export function flashTaskbar() {
  if (window.zteamDesktop?.flash) {
    window.zteamDesktop.flash();
    return;
  }
  try { navigator.setAppBadge?.(1); } catch (e) { /* not supported / not installed */ }
}

export function clearFlash() {
  if (window.zteamDesktop?.clearFlash) {
    window.zteamDesktop.clearFlash();
    return;
  }
  try { navigator.clearAppBadge?.(); } catch (e) { /* ignore */ }
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
