import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';

export default function DepartmentMembers() {
  const { id } = useParams();
  const { user } = useAuth();
  const { isUserActive } = usePresence();
  const [members, setMembers] = useState([]);
  const [sameDept, setSameDept] = useState(false);
  const navigate = useNavigate();

  function refresh() {
    api.get(`/api/directory/departments/${id}/members`).then((r) => {
      setMembers(r.data.members);
      setSameDept(r.data.sameDept);
    });
  }

  useEffect(() => { refresh(); }, [id]);

  async function sendRequest(receiverId) {
    try {
      await api.post('/api/connections/request', { receiverId });
      refresh();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not send request');
    }
  }

  return (
    <div className="panel">
      <h2>Department Members {sameDept && <span className="status-pill accepted">your department</span>}</h2>
      <div className="member-grid">
        {members.map((m) => (
          <div className="member-card" key={m.id}>
            <div className={`avatar ${isUserActive(m.id, m.isActive) ? 'online' : 'offline'}`}>{m.name[0].toUpperCase()}</div>
            <div className="member-name">{m.name} {m.isSelf && '(you)'}</div>
            <div className="muted">{m.position || '—'}</div>

            {m.unlocked ? (
              <>
                <div className="muted small">{m.email}</div>
                {m.phone && <div className="muted small">{m.phone}</div>}
                {!m.isSelf && (
                  <div className="member-actions">
                    <button onClick={() => navigate(`/chat/${m.id}`)}>Message</button>
                  </div>
                )}
              </>
            ) : (
              !m.isSelf && (
                <div className="member-actions">
                  {!m.connection && <button onClick={() => sendRequest(m.id)}>Send Request</button>}
                  {m.connection?.status === 'pending' && m.connection.direction === 'sent' && (
                    <span className="status-pill pending">Request sent</span>
                  )}
                  {m.connection?.status === 'pending' && m.connection.direction === 'received' && (
                    <span className="status-pill pending">Respond in Requests</span>
                  )}
                  {m.connection?.status === 'rejected' && (
                    <button onClick={() => sendRequest(m.id)}>Request again</button>
                  )}
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
