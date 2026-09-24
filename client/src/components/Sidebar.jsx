import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { useNotificationCenter } from '../context/NotificationCenterContext';
import { getSocket } from '../socket';
import api from '../api';
import BrandMark from './BrandMark';

export default function Sidebar() {
  const { user, logout, updateUser } = useAuth();
  const { isUserActive } = usePresence();
  const { unreadDMCount, unreadGroupCount, meetingAlertCount } = useNotificationCenter();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    api.get('/api/directory/departments').then((r) => setDepartments(r.data.departments));
    api.get('/api/messages/inbox').then((r) => setInbox(r.data.threads));
    api.get('/api/connections').then((r) => {
      setPendingCount(r.data.connections.filter((c) => c.status === 'pending' && c.direction === 'received').length);
    });

    const socket = getSocket();
    if (!socket) return;
    const onNewMessage = () => api.get('/api/messages/inbox').then((r) => setInbox(r.data.threads)).catch(() => {});
    // Somebody was deleted: drop them from Recent Chats right away (and re-check the list).
    const onRemoved = ({ userId }) => {
      setInbox((list) => list.filter((t) => t.user?.id !== userId));
      onNewMessage();
    };
    const onConnReq = () => api.get('/api/connections').then((r) => {
      setPendingCount(r.data.connections.filter((c) => c.status === 'pending' && c.direction === 'received').length);
    });
    socket.on('new-message', onNewMessage);
    socket.on('message-sent', onNewMessage);
    socket.on('messages-deleted', onNewMessage);
    socket.on('user-removed', onRemoved);
    socket.on('conversation-cleared', onNewMessage); // Inbox delete - possibly from another tab/device
    socket.on('connect', onNewMessage); // catch up after a reconnect
    socket.on('connection-request', onConnReq);
    socket.on('connection-response', onConnReq);
    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('message-sent', onNewMessage);
      socket.off('messages-deleted', onNewMessage);
      socket.off('user-removed', onRemoved);
      socket.off('conversation-cleared', onNewMessage);
      socket.off('connect', onNewMessage);
      socket.off('connection-request', onConnReq);
      socket.off('connection-response', onConnReq);
    };
  }, []);

  function toggleActive() {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      // Socket not ready yet (e.g. right after a reload) — don't lie about the state.
      return;
    }
    const next = !user.isActive;
    // Ask the server first; only reflect the new state once it's actually set,
    // so the button never shows "Active" when the toggle silently failed.
    socket.emit(next ? 'go-active' : 'go-inactive', {}, (ack) => {
      if (ack?.ok) updateUser({ isActive: next });
    });
  }

  return (
    <aside className="sidebar">
      <div className="brand-small">
        <BrandMark size={28} />
        <span>Zteam</span>
      </div>

      <div className="me-card">
        <div className={`avatar ${user.isActive ? 'online' : 'offline'}`}>{user.name?.[0]?.toUpperCase()}</div>
        <div className="me-info">
          <div className="me-name">{user.name}</div>
          <div className="me-position">{user.position || '—'}</div>
        </div>
      </div>
      <button className={`active-toggle ${user.isActive ? 'is-active' : ''}`} onClick={toggleActive}>
        <span className="dot" /> {user.isActive ? 'Active' : 'Go Active'}
      </button>

      <div className="nav-section main-nav">
        <NavLink to="/" end>Inbox {unreadDMCount > 0 && <span className="badge">{unreadDMCount}</span>}</NavLink>
        <NavLink to="/search">Search</NavLink>
        <NavLink to="/directory">Departments</NavLink>
        <NavLink to="/groups">Groups {unreadGroupCount > 0 && <span className="badge">{unreadGroupCount}</span>}</NavLink>
        <NavLink to="/meetings">Meetings {meetingAlertCount > 0 && <span className="badge">{meetingAlertCount}</span>}</NavLink>
        <NavLink to="/requests">Requests {pendingCount > 0 && <span className="badge">{pendingCount}</span>}</NavLink>
        <NavLink to="/profile">My Profile</NavLink>
        {user.role === 'admin' && <NavLink to="/admin">Admin Panel</NavLink>}
      </div>

      <div className="nav-section recent-chats">
        <div className="nav-label">Recent Chats</div>
        {inbox.map((t) => t.user && (
          <button key={t.user.id} className="thread-item" onClick={() => navigate(`/chat/${t.user.id}`)}>
            <span className={`dot-mini ${isUserActive(t.user.id, t.user.isActive) ? 'online' : ''}`} />
            {t.user.name}
          </button>
        ))}
      </div>

      <div className="nav-section dept-list">
        <div className="nav-label">Departments</div>
        {departments.map((d) => (
          <button key={d.id} className="thread-item" onClick={() => navigate(`/department/${d.id}`)}>
            {d.name}
          </button>
        ))}
      </div>

      <button className="logout-btn" onClick={async () => { await logout(); navigate('/login'); }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sign Out
      </button>
    </aside>
  );
}
