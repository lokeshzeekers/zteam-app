import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { usePresence } from '../context/PresenceContext';

export default function Search() {
  const navigate = useNavigate();
  const { isUserActive } = usePresence();
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState(null);
  const [people, setPeople] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runSearch(e) {
    e?.preventDefault();
    const term = q.trim();
    if (term.length < 2) { setError('Type at least 2 characters to search.'); return; }
    setError('');
    setLoading(true);
    try {
      const [msgRes, dirRes] = await Promise.all([
        api.get('/api/search/messages', { params: { q: term } }),
        api.get('/api/search/directory', { params: { q: term } }),
      ]);
      setMessages(msgRes.data);
      setPeople(dirRes.data.results);
    } catch (err) {
      setError(err?.response?.data?.error || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  const hasResults = messages && (messages.directMessages.length > 0 || messages.groupMessages.length > 0 || (people && people.length > 0));

  return (
    <div className="panel">
      <h2>Search</h2>
      <form className="search-form" onSubmit={runSearch}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages or people…"
          autoFocus
        />
        <button type="submit" className="primary-btn" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <div className="auth-error">{error}</div>}

      {messages && !hasResults && !error && (
        <p className="muted">No results for "{q}".</p>
      )}

      {people && people.length > 0 && (
        <>
          <h3>People</h3>
          <div className="search-results-list">
            {people.map((p) => (
              <div className="search-result-row" key={`u-${p.id}`} onClick={() => navigate(p.department ? `/department/${p.department.id}` : '/directory')} role="button" tabIndex={0}>
                <div className={`avatar ${isUserActive(p.id, p.isActive) ? 'online' : 'offline'}`} style={{ background: '#2f6feb' }}>{p.name[0].toUpperCase()}</div>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">{p.position || 'Member'}{p.department ? ` · ${p.department.name}` : ''} · {p.email}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {messages && messages.directMessages.length > 0 && (
        <>
          <h3>Direct messages</h3>
          <div className="search-results-list">
            {messages.directMessages.map((m) => (
              <div className="search-result-row" key={`dm-${m.id}`} onClick={() => navigate(`/chat/${m.withUser.id}`)} role="button" tabIndex={0}>
                <div>
                  <strong>{m.withUser.name}</strong>
                  <div className="muted small">{m.content}</div>
                </div>
                <span className="muted small">{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {messages && messages.groupMessages.length > 0 && (
        <>
          <h3>Group messages</h3>
          <div className="search-results-list">
            {messages.groupMessages.map((m) => (
              <div className="search-result-row" key={`g-${m.id}`} onClick={() => navigate(`/groups/${m.group.id}`)} role="button" tabIndex={0}>
                <div>
                  <strong>{m.group.name}</strong>
                  <div className="muted small">{m.content}</div>
                </div>
                <span className="muted small">{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
