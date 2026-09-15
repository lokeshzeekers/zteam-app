import { Outlet, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import CallManager from './CallManager';
import ChatWindow from '../pages/ChatWindow';

export default function Layout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="content">
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
