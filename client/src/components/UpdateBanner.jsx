import { useCallback, useEffect, useRef, useState } from 'react';

// Keeps an already-open app (installed EXE, Android APK, browser tab) in step with the server.
//
// The website is the single source of truth: every deployment publishes /version.json. This
// component compares it with the build that is currently running and, when they differ:
//   - right after the app opened (first 30s) .......... reloads immediately (nothing to lose yet)
//   - app comes back to the foreground ................ reloads, unless a call is active or an
//                                                       unsent message is being typed
//   - otherwise ....................................... shows a "Reload" bar
// It never reloads during a call/meeting and never loops (one automatic reload per new build).
const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const CHECK_EVERY_MS = 5 * 60 * 1000;
const FRESH_PAGE_MS = 30 * 1000;
const RELOADED_KEY = 'zteam_reloaded_for_build';
const pageOpenedAt = Date.now();

async function fetchLatestBuild() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // offline / server restarting: try again later
  }
}

function isBusy() {
  if (document.querySelector('.call-banner, .call-modal')) return true; // call ringing / in progress
  const typing = [...document.querySelectorAll('.chat-input input, .chat-input textarea')].some((el) => el.value && el.value.trim());
  return typing; // don't throw away an unsent message
}

export default function UpdateBanner() {
  const [latest, setLatest] = useState(null);
  const latestRef = useRef(null);

  const reloadNow = useCallback((build) => {
    try { sessionStorage.setItem(RELOADED_KEY, build); } catch { /* storage unavailable */ }
    window.location.reload();
  }, []);

  const tryAutoReload = useCallback(() => {
    const build = latestRef.current;
    if (!build || build === CURRENT || isBusy()) return;
    let already = null;
    try { already = sessionStorage.getItem(RELOADED_KEY); } catch { /* ignore */ }
    if (already === build) return; // reloaded once already for this build: don't loop, banner stays
    reloadNow(build);
  }, [reloadNow]);

  const check = useCallback(async (reason) => {
    if (CURRENT === 'dev') return;
    const build = await fetchLatestBuild();
    if (!build || build === CURRENT) return;
    latestRef.current = build;
    setLatest(build);
    if (reason === 'launch' && Date.now() - pageOpenedAt < FRESH_PAGE_MS) tryAutoReload();
    if (reason === 'foreground') tryAutoReload();
  }, [tryAutoReload]);

  useEffect(() => {
    if (CURRENT === 'dev') return undefined;
    const first = setTimeout(() => check('launch'), 2000);
    const interval = setInterval(() => check('interval'), CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check('foreground'); };
    const onOnline = () => check('foreground');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(first); clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [check]);

  if (!latest || latest === CURRENT) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Zteam is available.</span>
      <button type="button" onClick={() => reloadNow(latest)}>Reload</button>
    </div>
  );
}
