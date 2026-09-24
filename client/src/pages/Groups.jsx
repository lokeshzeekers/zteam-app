import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useNotificationCenter } from '../context/NotificationCenterContext';
import { getSocket } from '../socket';
import { TrashIcon } from '../components/ChatIcons';

export default function Groups() {
  const { user } = useAuth();
  const { isGroupUnread, markGroupRead } = useNotificationCenter();
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
    // Real-time: keep the list current the moment a group message arrives, a
    // group is cleared from another window, or we reconnect / come back to the
    // window — no need to switch sections and return.
    const socket = getSocket();
    const onChange = () => refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    socket?.on('group-invite', onChange);
    socket?.on('user-removed', onChange);
    socket?.on('new-group-message', onChange);
    socket?.on('group-cleared', onChange);
    socket?.on('group-messages-deleted', onChange);
    socket?.on('connect', onChange);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onChange);
    return () => {
      socket?.off('group-invite', onChange);
      socket?.off('user-removed', onChange);
      socket?.off('new-group-message', onChange);
      socket?.off('group-cleared', onChange);
      socket?.off('group-messages-deleted', onChange);
      socket?.off('connect', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onChange);
    };
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

  // Clears the messages for me only — the group stays in the list.
  async function clearGroupMessages(e, groupId, name) {
    e.stopPropagation(); // don't also navigate into the group
    if (!confirm(`Delete all messages in "${name}" for you? The group stays in your list and other members keep their copy.`)) return;
    try {
      await api.post(`/api/groups/${groupId}/hide`);
      markGroupRead(groupId);
      refresh();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the messages');
    }
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
          <div className={`member-card${isGroupUnread(g.id) ? ' unread' : ''}`} key={g.id} onClick={() => navigate(`/groups/${g.id}`)} role="button" tabIndex={0}>
            <div className="avatar online" style={{ background: '#16305c' }}>{g.name[0].toUpperCase()}</div>
            <div className="member-name">{g.name}</div>
            <div className="muted small">{g.members.length} member{g.members.length !== 1 ? 's' : ''}</div>
            {isGroupUnread(g.id) && <div className="unread-tag">New messages</div>}
            <button
              type="button"
              className="icon-btn-sm danger group-hide-btn"
              onClick={(e) => clearGroupMessages(e, g.id, g.name)}
              title="Delete messages"
              aria-label={`Delete messages in ${g.name}`}
            >
              <TrashIcon size={19} />
            </button>
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
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Group'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
