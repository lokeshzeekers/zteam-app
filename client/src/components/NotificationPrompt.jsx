import { useEffect, useState } from 'react';
import { getNotificationPermission, requestNotificationPermission } from '../notify';

const DISMISS_KEY = 'zteam_notif_prompt_dismissed';

// A slim banner asking for notification permission via a REAL click — this
// is the only reliable way to get Chrome to show the permission prompt at
// all. If it's requested from a socket event (e.g. when a message arrives)
// instead, the browser silently ignores it and permission stays stuck at
// "default" forever, which is why alerts can silently never appear.
export default function NotificationPrompt() {
  const [permission, setPermission] = useState(getNotificationPermission());
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    // window.zteamDesktop only exists inside the Electron app, where native
    // notifications don't need browser permission at all — hide the banner there.
    if (window.zteamDesktop) setDismissed(true);
  }, []);

  async function enable() {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result !== 'default') {
      sessionStorage.setItem(DISMISS_KEY, '1');
      setDismissed(true);
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  if (dismissed || permission === 'unsupported' || permission !== 'default') return null;

  return (
    <div className="notif-banner">
      <span>🔔 Turn on desktop notifications so you don't miss new messages and calls.</span>
      <div className="notif-banner-actions">
        <button type="button" className="btn-secondary btn-sm" onClick={dismiss}>Not now</button>
        <button type="button" className="btn-primary btn-sm" onClick={enable}>Enable notifications</button>
      </div>
    </div>
  );
}
