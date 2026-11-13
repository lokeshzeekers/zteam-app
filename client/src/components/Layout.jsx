import { useEffect, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import CallManager from './CallManager';
import NotificationPrompt from './NotificationPrompt';
import BrandMark from './BrandMark';
import ChatWindow from '../pages/ChatWindow';
import { useNotificationCenter } from '../context/NotificationCenterContext';

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const { unreadDMCount, unreadGroupCount, meetingAlertCount } = useNotificationCenter();
  const hasAlerts = unreadDMCount + unreadGroupCount + meetingAlertCount > 0;

  // Phones / tablets: the sidebar is a drawer. Close it whenever the page changes.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
      <header className="mobile-topbar">
        <button
          type="button"
          className="hamburger"
          onClick={() => setNavOpen((o) => !o)}
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          {hasAlerts && !navOpen && <span className="badge-dot" aria-hidden="true" />}
        </button>
        <BrandMark size={24} />
        <span>Zteam</span>
      </header>
      <div className="nav-overlay" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <Sidebar />
      <main className="content">
        <NotificationPrompt />
        <Outlet />
      </main>
      <CallManager />
    </div>
  );
}

// Wrapper so ChatWindow can trigger calls via the global CallManager instance
export function ChatRoute() {
  const { userId } = useParams();
  return <ChatWindow key={userId} onStartCall={(id, type) => window.__zteamStartCall?.(id, type)} />;
}
