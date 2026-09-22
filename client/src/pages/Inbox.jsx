import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { usePresence } from '../context/PresenceContext';
import { useNotificationCenter } from '../context/NotificationCenterContext';
import { FileIcon, TrashIcon } from '../components/ChatIcons';

export default function Inbox() {
  const [threads, setThreads] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const { isUserActive } = usePresence();
  const { isDMUnread } = useNotificationCenter();

  async function deleteConversation(e, otherUserId) {
    e.stopPropagation(); // don't also navigate into the chat
    if (!confirm('Delete this conversation from your chat list? The other person keeps their copy.')) return;
    try {
      await api.delete(`/api/messages/with/${otherUserId}`);
      setThreads((prev) => prev.filter((t) => t.user?.id !== otherUserId));
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the conversation');
    }
  }

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
    socket?.on('conversation-cleared', load);
    socket?.on('connect', load);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      socket?.off('new-message', load);
      socket?.off('message-sent', load);
      socket?.off('user-removed', load);
      socket?.off('conversation-cleared', load);
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
          <div
            key={t.user.id}
            className={`thread-row${isDMUnread(t.user.id) ? ' unread' : ''}`}
            onClick={() => navigate(`/chat/${t.user.id}`)}
          >
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
            {isDMUnread(t.user.id) && <span className="unread-dot" title="New message" aria-label="New unread message" />}
            <button
              type="button"
              className="icon-btn-sm danger thread-delete-btn"
              onClick={(e) => deleteConversation(e, t.user.id)}
              title="Delete conversation"
              aria-label={`Delete conversation with ${t.user.name}`}
            >
              <TrashIcon size={19} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
