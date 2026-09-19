import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../socket';

function toLocalInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function Meetings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [groups, setGroups] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // meeting being edited, or null = creating
  const [form, setForm] = useState({ title: '', description: '', callType: 'video', scheduledAt: '', durationMinutes: 30, groupId: '', participantIds: [] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.get('/api/meetings').then((r) => setMeetings(r.data.meetings));
  }

  useEffect(() => {
    refresh();
    api.get('/api/groups').then((r) => setGroups(r.data.groups));
    const socket = getSocket();
    const onChange = () => refresh();
    socket?.on('meeting-invite', onChange);
    socket?.on('meeting-updated', onChange);
    socket?.on('meeting-cancelled', onChange);
    socket?.on('meeting-starting', onChange);
    return () => {
      socket?.off('meeting-invite', onChange);
      socket?.off('meeting-updated', onChange);
      socket?.off('meeting-cancelled', onChange);
      socket?.off('meeting-starting', onChange);
    };
  }, []);

  async function openCreate() {
    setEditing(null);
    setError('');
    const in30 = new Date(Date.now() + 30 * 60 * 1000);
    setForm({ title: '', description: '', callType: 'video', scheduledAt: toLocalInputValue(in30), durationMinutes: 30, groupId: '', participantIds: [] });

    const people = new Map();
    if (user.departmentId) {
      const { data } = await api.get(`/api/directory/departments/${user.departmentId}/members`);
      data.members.forEach((m) => { if (!m.isSelf) people.set(m.id, m); });
    }
    const { data: conns } = await api.get('/api/connections');
    conns.connections.filter((c) => c.status === 'accepted').forEach((c) => people.set(c.user.id, c.user));
    setCandidates([...people.values()]);
    setShowForm(true);
  }

  function openEdit(m) {
    setEditing(m);
    setError('');
    setForm({
      title: m.title, description: m.description || '', callType: m.callType,
      scheduledAt: toLocalInputValue(m.scheduledAt), durationMinutes: m.durationMinutes,
      groupId: '', participantIds: [],
    });
    setShowForm(true);
  }

  function toggleParticipant(id) {
    setForm((f) => ({ ...f, participantIds: f.participantIds.includes(id) ? f.participantIds.filter((x) => x !== id) : [...f.participantIds, id] }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/api/meetings/${editing.id}`, {
          title: form.title, description: form.description, callType: form.callType,
          scheduledAt: new Date(form.scheduledAt).toISOString(), durationMinutes: Number(form.durationMinutes),
          addParticipantIds: form.participantIds,
        });
      } else {
        await api.post('/api/meetings', {
          title: form.title, description: form.description, callType: form.callType,
          scheduledAt: new Date(form.scheduledAt).toISOString(), durationMinutes: Number(form.durationMinutes),
          groupId: form.groupId || undefined, participantIds: form.participantIds,
        });
      }
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save meeting');
    } finally {
      setSaving(false);
    }
  }

  async function cancelMeeting(id) {
    if (!confirm('Cancel and delete this meeting? Invited participants will be notified.')) return;
    await api.delete(`/api/meetings/${id}`);
    refresh();
  }

  async function startNow(id) {
    await api.post(`/api/meetings/${id}/start`);
    navigate(`/meetings/${id}/room`);
  }

  const upcoming = meetings.filter((m) => m.status === 'scheduled' || m.status === 'ongoing');
  const past = meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled');

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Meetings</h2>
        <button className="primary-btn" onClick={openCreate}>+ Schedule Meeting</button>
      </div>

      <h3>Upcoming</h3>
      {upcoming.length === 0 && (
        <div className="empty-state">
          <p><strong>No meetings scheduled</strong></p>
          <p className="muted">Schedule a meeting to get your team on a call at a set time.</p>
        </div>
      )}
      {upcoming.map((m) => (
        <div className="request-row" key={m.id}>
          <div>
            <strong>{m.title}</strong>{' '}
            <span className={`status-pill ${m.status === 'ongoing' ? 'accepted' : 'pending'}`}>{m.status}</span>
            <div className="muted small">{new Date(m.scheduledAt).toLocaleString()} · {m.durationMinutes} min · {m.callType}</div>
            <div className="muted small">{m.participants.map((p) => p.name).join(', ')}</div>
          </div>
          <div className="request-actions">
            {(m.status === 'ongoing' || m.status === 'scheduled') && (
              <button className="btn-accept" onClick={() => (m.status === 'ongoing' ? navigate(`/meetings/${m.id}/room`) : startNow(m.id))}>
                {m.status === 'ongoing' ? 'Join' : 'Start now'}
              </button>
            )}
            {m.isOwner && <button onClick={() => openEdit(m)}>Edit</button>}
            {m.isOwner && <button className="btn-reject" onClick={() => cancelMeeting(m.id)}>Delete</button>}
          </div>
        </div>
      ))}

      {past.length > 0 && (
        <>
          <h3>Past</h3>
          {past.map((m) => (
            <div className="request-row" key={m.id}>
              <div>
                <strong>{m.title}</strong> <span className="status-pill rejected">{m.status}</span>
                <div className="muted small">{new Date(m.scheduledAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {showForm && (
        <div className="call-modal" onClick={() => setShowForm(false)}>
          <div className="edit-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Meeting' : 'Schedule Meeting'}</h3>
            <form className="profile-form flat" onSubmit={save}>
              {error && <div className="auth-error">{error}</div>}
              <label>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
              <label>Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <label>Date &amp; time</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} required />
              <label>Duration (minutes)</label>
              <input type="number" min="5" step="5" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
              <label>Call type</label>
              <select value={form.callType} onChange={(e) => setForm({ ...form, callType: e.target.value })}>
                <option value="video">Video</option>
                <option value="audio">Audio only</option>
              </select>
              {!editing && (
                <>
                  <label>Use a group's member list (optional)</label>
                  <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">— None —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </>
              )}
              <label>{editing ? 'Invite more people' : 'Invite people'}</label>
              <div className="checkbox-list">
                {candidates.length === 0 && <p className="muted small">No connected colleagues to invite yet.</p>}
                {candidates.map((c) => (
                  <label key={c.id} className="checkbox-row">
                    <input type="checkbox" checked={form.participantIds.includes(c.id)} onChange={() => toggleParticipant(c.id)} />
                    {c.name} <span className="muted small">— {c.position || 'Member'}</span>
                  </label>
                ))}
              </div>
              <div className="edit-modal-actions">
                <button type="button" className="btn-reject" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Schedule'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
