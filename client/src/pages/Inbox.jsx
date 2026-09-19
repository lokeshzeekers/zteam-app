import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { usePresence } from '../context/PresenceContext';
import { FileIcon } from '../components/ChatIcons';

export default function Inbox() {
  const [threads, setThreads] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const { isUserActive } = usePresence();

  const load = useCallback(() => (
    api.get('/api/messages/inbox')
      .then((r) => setThreads(r.data.threads))
      .catch(() => { /* keep whatever we already show */ })
      .finally(() => setLoaded(true))
  ), []);

  useEffect(() => {
    load();

    // Real-time: refresh the list the moment a message is sent or received,
    // when somebody is deleted, and after a reconnect / coming back to the
    // window (covers anything missed while the socket was down or asleep).
    const socket = getSocket();
    socket?.on('new-message', load);
    socket?.on('message-sent', load);
    socket?.on('user-removed', load);
    socket?.on('connect', load);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      socket?.off('new-message', load);
      socket?.off('message-sent', load);
      socket?.off('user-removed', load);
      socket?.off('connect', load);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  return (
    <div className="panel">
      <h2>Inbox</h2>
      {loaded && threads.filter((t) => t.user).length === 0 && (
        <p className="muted">No conversations yet. Open a department to start chatting with a teammate.</p>
      )}
      <div className="thread-list">
        {threads.map((t) => t.user && (
          <div key={t.user.id} className="thread-row" onClick={() => navigate(`/chat/${t.user.id}`)}>
            <div className={`avatar ${isUserActive(t.user.id, t.user.isActive) ? 'online' : 'offline'}`}>{t.user.name[0].toUpperCase()}</div>
            <div className="thread-row-body">
              <div className="thread-row-top">
                <strong>{t.user.name}</strong>
                <span className="muted small">{new Date(t.lastMessage.createdAt).toLocaleString()}</span>
              </div>
              <div className="muted thread-preview">
                {t.lastMessage.type === 'file'
                  ? <><FileIcon size={14} /> {t.lastMessage.fileName}</>
                  : t.lastMessage.content}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
