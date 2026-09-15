import { useEffect, useState } from 'react';
import api from '../api';
import { getSocket } from '../socket';

export default function Requests() {
  const [connections, setConnections] = useState([]);

  function refresh() {
    api.get('/api/connections').then((r) => setConnections(r.data.connections));
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    socket?.on('connection-request', refresh);
    socket?.on('connection-response', refresh);
    return () => {
      socket?.off('connection-request', refresh);
      socket?.off('connection-response', refresh);
    };
  }, []);

  async function respond(id, action) {
    await api.post(`/api/connections/${id}/respond`, { action });
    refresh();
  }

  const received = connections.filter((c) => c.direction === 'received' && c.status === 'pending');
  const sent = connections.filter((c) => c.direction === 'sent');
  const accepted = connections.filter((c) => c.status === 'accepted');

  return (
    <div className="panel">
      <h2>Connection Requests</h2>

      <h3>Pending — Waiting on you</h3>
      {received.length === 0 && <p className="muted">Nothing pending.</p>}
      {received.map((c) => (
        <div key={c.id} className="request-row">
          <div>
            <strong>{c.user?.name}</strong> <span className="muted">— {c.user?.position}</span>
          </div>
          <div className="request-actions">
            <button className="btn-accept" onClick={() => respond(c.id, 'accept')}>Accept</button>
            <button className="btn-reject" onClick={() => respond(c.id, 'reject')}>Decline</button>
          </div>
        </div>
      ))}

      <h3>Sent by you</h3>
      {sent.length === 0 && <p className="muted">No outgoing requests.</p>}
      {sent.map((c) => (
        <div key={c.id} className="request-row">
          <div><strong>{c.user?.name}</strong> <span className="muted">— {c.user?.position}</span></div>
          <span className={`status-pill ${c.status}`}>{c.status}</span>
        </div>
      ))}

      <h3>Connected</h3>
      {accepted.length === 0 && <p className="muted">No cross-department connections yet.</p>}
      {accepted.map((c) => (
        <div key={c.id} className="request-row">
          <div><strong>{c.user?.name}</strong> <span className="muted">— {c.user?.position}</span></div>
          <span className="status-pill accepted">connected</span>
        </div>
      ))}
    </div>
  );
}
