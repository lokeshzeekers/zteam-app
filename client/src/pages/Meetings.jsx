import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../socket';
import { useNotificationCenter } from '../context/NotificationCenterContext';
import Select from '../components/Select';
import { TrashIcon } from '../components/ChatIcons';

const CALL_TYPE_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio only' },
];

function toLocalInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function Meetings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { clearMeetingAlerts } = useNotificationCenter();
  const [meetings, setMeetings] = useState([]);
  const [groups, setGroups] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // meeting being edited, or null = creating
  const [form, setForm] = useState({ title: '', description: '', callType: 'video', scheduledAt: '', durationMinutes: 30, groupId: '', participantIds: [], startNow: false });
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.get('/api/meetings')
      .then((r) => setMeetings(r.data.meetings))
      .catch(() => setActionError('Could not load meetings. Please refresh the page.'));
  }

  useEffect(() => {
    refresh();
    api.get('/api/groups').then((r) => setGroups(r.data.groups));
    // Being on this screen means any pending meeting alerts (new invites,
    // meetings that just went live) are, by definition, no longer unseen.
    clearMeetingAlerts();
    const socket = getSocket();
    const onChange = () => refresh();
    // These two specifically represent "something new happened" — since
    // we're already looking at the Meetings screen, immediately clear the
    // sidebar badge again instead of letting it reappear while we're here.
    const onAlertWhileOpen = () => { refresh(); clearMeetingAlerts(); };
    socket?.on('meeting-invite', onAlertWhileOpen);
    socket?.on('meeting-updated', onChange);
    socket?.on('meeting-cancelled', onChange);
    socket?.on('meeting-starting', onAlertWhileOpen);
    socket?.on('meeting-ended', onChange);
    socket?.on('meeting-history-removed', onChange);
    return () => {
      socket?.off('meeting-invite', onAlertWhileOpen);
      socket?.off('meeting-updated', onChange);
      socket?.off('meeting-cancelled', onChange);
      socket?.off('meeting-starting', onAlertWhileOpen);
      socket?.off('meeting-ended', onChange);
      socket?.off('meeting-history-removed', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCreate() {
    setEditing(null);
    setError('');
    const in30 = new Date(Date.now() + 30 * 60 * 1000);
    setForm({ title: '', description: '', callType: 'video', scheduledAt: toLocalInputValue(in30), durationMinutes: 30, groupId: '', participantIds: [], startNow: false });
    setShowForm(true);

    // Load people you can invite. A failure here must never stop the form from opening.
    const people = new Map();
    try {
      if (user.departmentId) {
        const { data } = await api.get(`/api/directory/departments/${user.departmentId}/members`);
        data.members.forEach((m) => { if (!m.isSelf) people.set(m.id, m); });
      }
    } catch (err) { /* keep going with connections only */ }
    try {
      const { data: conns } = await api.get('/api/connections');
      conns.connections.filter((c) => c.status === 'accepted' && c.user).forEach((c) => people.set(c.user.id, c.user));
    } catch (err) { /* keep going with whoever we found */ }
    setCandidates([...people.values()]);
  }

  function openEdit(m) {
    setEditing(m);
    setError('');
    setForm({
      title: m.title, description: m.description || '', callType: m.callType,
      scheduledAt: toLocalInputValue(m.scheduledAt), durationMinutes: m.durationMinutes,
      groupId: '', participantIds: [], startNow: false,
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
        const { data } = await api.post('/api/meetings', {
          title: form.title, description: form.description, callType: form.callType,
          scheduledAt: form.startNow ? new Date().toISOString() : new Date(form.scheduledAt).toISOString(),
          durationMinutes: Number(form.durationMinutes) || 30,
          groupId: form.groupId || undefined, participantIds: form.participantIds,
          startNow: form.startNow,
        });
        if (form.startNow) {
          setShowForm(false);
          navigate(`/meetings/${data.meeting.id}/room`);
          return;
        }
      }
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save meeting');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(id, fn) {
    setActionError('');
    setBusyId(id);
    try { await fn(); }
    catch (err) { setActionError(err?.response?.data?.error || 'Something went wrong. Please try again.'); }
    finally { setBusyId(null); }
  }

  function cancelMeeting(id) {
    if (!confirm('Cancel and delete this meeting? Invited participants will be notified.')) return;
    return runAction(id, async () => { await api.delete(`/api/meetings/${id}`); refresh(); });
  }

  // Past meetings: remove from MY history only (others keep theirs).
  function removeFromHistory(m) {
    if (!confirm(`Remove "${m.title}" from your meeting history? Other participants keep their copy.`)) return;
    return runAction(m.id, async () => {
      await api.delete(`/api/meetings/${m.id}/history`);
      setMeetings((prev) => prev.filter((x) => x.id !== m.id));
    });
  }

  // Host: start a scheduled meeting (or re-enter one that's already live) and go to the room.
  function startNow(m) {
    return runAction(m.id, async () => {
      if (m.status !== 'ongoing') await api.post(`/api/meetings/${m.id}/start`);
      navigate(`/meetings/${m.id}/room`);
    });
  }

  function endMeeting(id) {
    if (!confirm('End this meeting for everyone?')) return;
    return runAction(id, async () => { await api.post(`/api/meetings/${id}/end`); refresh(); });
  }

  const upcoming = meetings.filter((m) => m.status === 'scheduled' || m.status === 'ongoing');
  const past = meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled');

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Meetings</h2>
        <button className="primary-btn" onClick={openCreate}>+ Schedule Meeting</button>
      </div>

      {actionError && <div className="auth-error" style={{ marginBottom: 12 }}>{actionError}</div>}

      <h3>Upcoming</h3>
      {upcoming.length === 0 && (
        <div className="empty-state">
          <p><strong>No meetings scheduled</strong></p>
          <p className="muted">Schedule a meeting to get your team on a call at a set time.</p>
        </div>
      )}
      {upcoming.map((m) => {
        const live = m.status === 'ongoing';
        const busy = busyId === m.id;
        return (
          <div className="request-row" key={m.id}>
            <div className="meeting-meta">
              <div className="meeting-title-line">
                <strong>{m.title}</strong>
                <span className={`status-pill ${live ? 'accepted' : 'pending'}`}>{live ? 'live now' : 'scheduled'}</span>
              </div>
              <div className="muted small">{new Date(m.scheduledAt).toLocaleString()} · {m.durationMinutes} min · {m.callType === 'audio' ? 'audio' : 'video'} · host: {m.isOwner ? 'you' : m.hostName}</div>
              <div className="muted small">{m.participants.map((p) => p.name).join(', ')}</div>
            </div>
            <div className="request-actions">
              {/* Everyone can join once it is live; only the host can start it. */}
              {live && (
                <button type="button" className="btn-success" disabled={busy} onClick={() => navigate(`/meetings/${m.id}/room`)}>Join</button>
              )}
              {!live && m.isOwner && (
                <button type="button" className="btn-success" disabled={busy} onClick={() => startNow(m)}>{busy ? 'Starting…' : 'Start now'}</button>
              )}
              {!live && !m.isOwner && <span className="muted small">Waiting for host to start</span>}
              {live && m.isOwner && (
                <button type="button" className="btn-outline-danger" disabled={busy} onClick={() => endMeeting(m.id)}>End</button>
              )}
              {m.isOwner && <button type="button" className="btn-secondary" disabled={busy} onClick={() => openEdit(m)}>Edit</button>}
              {m.isOwner && <button type="button" className="btn-danger" disabled={busy} onClick={() => cancelMeeting(m.id)}>Delete</button>}
            </div>
          </div>
        );
      })}

      {past.length > 0 && (
        <>
          <h3>Past</h3>
          {past.map((m) => (
            <div className="request-row" key={m.id}>
              <div>
                <strong>{m.title}</strong> <span className="status-pill rejected">{m.status}</span>
                <div className="muted small">{new Date(m.scheduledAt).toLocaleString()}</div>
              </div>
              <div className="request-actions">
                <button
                  type="button"
                  className="icon-btn-sm danger"
                  disabled={busyId === m.id}
                  onClick={() => removeFromHistory(m)}
                  title="Remove from my history"
                  aria-label={`Remove ${m.title} from my history`}
                >
                  <TrashIcon size={19} />
                </button>
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
              <div className="form-grid">
                <div className="form-field full">
                  <label htmlFor="mt-title">Title</label>
                  <input id="mt-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
                </div>
                <div className="form-field full">
                  <label htmlFor="mt-desc">Description</label>
                  <input id="mt-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="mt-when">Date &amp; time</label>
                  <input id="mt-when" type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} required disabled={!editing && form.startNow} />
                </div>
                <div className="form-field">
                  <label htmlFor="mt-dur">Duration (minutes)</label>
                  <input id="mt-dur" type="number" min="5" step="5" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
                </div>
                <div className="form-field">
                  <label>Call type</label>
                  <Select value={form.callType} onChange={(v) => setForm({ ...form, callType: v })} options={CALL_TYPE_OPTIONS} ariaLabel="Call type" />
                </div>
                {!editing && (
                  <div className="form-field">
                    <label>Use a group's members <span className="label-hint">(optional)</span></label>
                    <Select
                      value={form.groupId}
                      onChange={(v) => setForm({ ...form, groupId: v })}
                      options={[{ value: '', label: '— None —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                      ariaLabel="Group"
                    />
                  </div>
                )}
                <div className="form-field full">
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
                </div>
                {!editing && (
                  <div className="form-field full">
                    <label className="check-row">
                      <input type="checkbox" checked={form.startNow} onChange={(e) => setForm({ ...form, startNow: e.target.checked })} />
                      Start this meeting right now
                    </label>
                  </div>
                )}
              </div>
              <div className="edit-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : form.startNow ? 'Start meeting' : 'Schedule'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
