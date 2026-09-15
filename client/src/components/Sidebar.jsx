import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../socket';
import api from '../api';

export default function Sidebar() {
  const { user, logout, updateUser } = useAuth();
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
    const onNewMessage = () => api.get('/api/messages/inbox').then((r) => setInbox(r.data.threads));
    const onConnReq = () => api.get('/api/connections').then((r) => {
      setPendingCount(r.data.connections.filter((c) => c.status === 'pending' && c.direction === 'received').length);
    });
    socket.on('new-message', onNewMessage);
    socket.on('message-sent', onNewMessage);
    socket.on('connection-request', onConnReq);
    socket.on('connection-response', onConnReq);
    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('message-sent', onNewMessage);
      socket.off('connection-request', onConnReq);
      socket.off('connection-response', onConnReq);
    };
  }, []);

  function toggleActive() {
    const socket = getSocket();
    const next = !user.isActive;
    updateUser({ isActive: next });
    socket?.emit(next ? 'go-active' : 'go-inactive');
  }

  return (
    <aside className="sidebar">
      <div className="brand-small">
        <div className="brand-logo small">Z</div>
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

      <div className="nav-section">
        <NavLink to="/" end>Inbox</NavLink>
        <NavLink to="/requests">Requests {pendingCount > 0 && <span className="badge">{pendingCount}</span>}</NavLink>
        <NavLink to="/profile">My Profile</NavLink>
        {user.role === 'admin' && <NavLink to="/admin">Admin Panel</NavLink>}
      </div>

      <div className="nav-section">
        <div className="nav-label">Recent Chats</div>
        {inbox.map((t) => t.user && (
          <button key={t.user.id} className="thread-item" onClick={() => navigate(`/chat/${t.user.id}`)}>
            <span className={`dot-mini ${t.user.isActive ? 'online' : ''}`} />
            {t.user.name}
          </button>
        ))}
      </div>

      <div className="nav-section">
        <div className="nav-label">Departments</div>
        {departments.map((d) => (
          <button key={d.id} className="thread-item" onClick={() => navigate(`/department/${d.id}`)}>
            {d.name}
          </button>
        ))}
      </div>

      <button className="logout-btn" onClick={() => { logout(); navigate('/login'); }}>Sign Out</button>
    </aside>
  );
}
