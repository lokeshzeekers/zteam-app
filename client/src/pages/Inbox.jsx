import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Inbox() {
  const [threads, setThreads] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/messages/inbox').then((r) => setThreads(r.data.threads));
  }, []);

  return (
    <div className="panel">
      <h2>Inbox</h2>
      {threads.length === 0 && <p className="muted">No conversations yet. Open a department to start chatting with a teammate.</p>}
      <div className="thread-list">
        {threads.map((t) => t.user && (
          <div key={t.user.id} className="thread-row" onClick={() => navigate(`/chat/${t.user.id}`)}>
            <div className={`avatar ${t.user.isActive ? 'online' : 'offline'}`}>{t.user.name[0].toUpperCase()}</div>
            <div className="thread-row-body">
              <div className="thread-row-top">
                <strong>{t.user.name}</strong>
                <span className="muted small">{new Date(t.lastMessage.createdAt).toLocaleString()}</span>
              </div>
              <div className="muted">{t.lastMessage.type === 'file' ? `📎 ${t.lastMessage.fileName}` : t.lastMessage.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
