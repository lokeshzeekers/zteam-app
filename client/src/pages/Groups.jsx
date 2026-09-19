import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../socket';

export default function Groups() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [candidates, setCandidates] = useState([]); // people you're allowed to add
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.get('/api/groups').then((r) => setGroups(r.data.groups));
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    const onInvite = () => refresh();
    socket?.on('group-invite', onInvite);
    return () => socket?.off('group-invite', onInvite);
  }, []);

  async function openCreate() {
    setError('');
    setName('');
    setSelected([]);
    // Build the addable list: same-department colleagues + accepted cross-department connections.
    const people = new Map();
    if (user.departmentId) {
      const { data } = await api.get(`/api/directory/departments/${user.departmentId}/members`);
      data.members.forEach((m) => { if (!m.isSelf) people.set(m.id, m); });
    }
    const { data: conns } = await api.get('/api/connections');
    conns.connections.filter((c) => c.status === 'accepted').forEach((c) => people.set(c.user.id, c.user));
    setCandidates([...people.values()]);
    setShowCreate(true);
  }

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function createGroup(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/api/groups', { name, memberIds: selected });
      setShowCreate(false);
      refresh();
      navigate(`/groups/${data.group.id}`);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create group');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Groups</h2>
        <button className="primary-btn" onClick={openCreate}>+ New Group</button>
      </div>

      {groups.length === 0 && (
        <div className="empty-state">
          <p><strong>No groups yet</strong></p>
          <p className="muted">Create a group to chat and hold meetings with several teammates at once.</p>
        </div>
      )}

      <div className="member-grid">
        {groups.map((g) => (
          <div className="member-card" key={g.id} onClick={() => navigate(`/groups/${g.id}`)} role="button" tabIndex={0}>
            <div className="avatar online" style={{ background: '#16305c' }}>{g.name[0].toUpperCase()}</div>
            <div className="member-name">{g.name}</div>
            <div className="muted small">{g.members.length} member{g.members.length !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="call-modal" onClick={() => setShowCreate(false)}>
          <div className="edit-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>New Group</h3>
            <form className="profile-form flat" onSubmit={createGroup}>
              {error && <div className="auth-error">{error}</div>}
              <label>Group name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              <label>Members</label>
              <div className="checkbox-list">
                {candidates.length === 0 && <p className="muted small">No connected colleagues to add yet.</p>}
                {candidates.map((c) => (
                  <label key={c.id} className="checkbox-row">
                    <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                    {c.name} <span className="muted small">— {c.position || 'Member'}</span>
                  </label>
                ))}
              </div>
              <div className="edit-modal-actions">
                <button type="button" className="btn-reject" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Group'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
