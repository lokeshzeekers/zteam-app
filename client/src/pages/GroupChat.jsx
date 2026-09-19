import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { AttachButton, FileAttachment, SendIcon } from '../components/ChatIcons';

export default function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { isUserActive } = usePresence();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [addIds, setAddIds] = useState([]);
  const [removeIds, setRemoveIds] = useState([]);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  function loadGroup() {
    return api.get(`/api/groups/${groupId}`).then((r) => setGroup(r.data.group));
  }

  useEffect(() => {
    setError('');
    const loadMessages = () => api.get(`/api/groups/${groupId}/messages`).then((r) => setMessages(r.data.messages)).catch(() => {});
    loadGroup().catch(() => setError('Group not found or you are not a member'));
    loadMessages();

    const socket = getSocket();
    if (!socket) return undefined;
    socket.emit('join-group-room', { groupId: Number(groupId) });
    const handler = ({ message }) => {
      if (String(message.groupId) === String(groupId)) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    };
    // After a reconnect the server has forgotten our room: rejoin it and catch up.
    const onReconnect = () => {
      socket.emit('join-group-room', { groupId: Number(groupId) });
      loadMessages();
      loadGroup().catch(() => {});
    };
    const onRemoved = () => { loadGroup().catch(() => {}); };
    socket.on('new-group-message', handler);
    socket.on('connect', onReconnect);
    socket.on('user-removed', onRemoved);
    return () => {
      socket.off('new-group-message', handler);
      socket.off('connect', onReconnect);
      socket.off('user-removed', onRemoved);
      socket.emit('leave-group-room', { groupId: Number(groupId) });
    };
  }, [groupId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const isOwner = group && (group.createdBy === user.id || user.role === 'admin');

  function send(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    getSocket().emit('send-group-message', { groupId: Number(groupId), content: text, type: 'text' }, (res) => {
      if (res?.error) setError(res.error);
    });
    setText('');
  }

  async function onFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/api/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      getSocket().emit('send-group-message', {
        groupId: Number(groupId), type: 'file', fileUrl: data.fileUrl, fileName: data.fileName,
      }, (res) => { if (res?.error) setNotice(res.error); });
    } catch (err) {
      setNotice(err?.response?.data?.error || 'Could not upload the file.');
    } finally {
      setUploading(false);
    }
  }

  async function startMeetingNow() {
    try {
      const { data } = await api.post('/api/meetings', {
        title: `${group?.name || 'Group'} call`, groupId: Number(groupId), callType: 'video', startNow: true,
      });
      navigate(`/meetings/${data.meeting.id}/room`);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not start meeting');
    }
  }

  async function openEdit() {
    setEditError('');
    setEditName(group.name);
    setAddIds([]);
    setRemoveIds([]);
    // People you could add who aren't already in the group
    const people = new Map();
    if (user.departmentId) {
      const { data } = await api.get(`/api/directory/departments/${user.departmentId}/members`);
      data.members.forEach((m) => { if (!m.isSelf) people.set(m.id, m); });
    }
    const { data: conns } = await api.get('/api/connections');
    conns.connections.filter((c) => c.status === 'accepted').forEach((c) => people.set(c.user.id, c.user));
    group.members.forEach((m) => people.delete(m.id));
    setCandidates([...people.values()]);
    setShowEdit(true);
  }

  function toggleAdd(id) {
    setAddIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleRemove(id) {
    setRemoveIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSavingEdit(true);
    setEditError('');
    try {
      await api.put(`/api/groups/${groupId}`, { name: editName, addMemberIds: addIds, removeMemberIds: removeIds });
      setShowEdit(false);
      await loadGroup();
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Could not save changes');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteGroup() {
    if (!confirm(`Delete "${group.name}"? This removes the group and its messages for everyone. This cannot be undone.`)) return;
    try {
      await api.delete(`/api/groups/${groupId}`);
      navigate('/groups');
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete group');
    }
  }

  if (error && !group) return <div className="panel"><p className="auth-error">{error}</p></div>;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <strong>{group?.name || 'Group'}</strong>
        <div className="chat-header-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setShowMembers((s) => !s)}>
            👥 Members ({group?.members.length || 0})
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={startMeetingNow} title="Start a group video meeting now">🎥 Start Meeting</button>
          {isOwner && <button type="button" className="btn-secondary btn-sm" onClick={openEdit}>Edit</button>}
          {isOwner && <button type="button" className="btn-danger btn-sm" onClick={deleteGroup}>Delete</button>}
        </div>
      </div>

      {showMembers && group && (
        <div className="group-members-panel">
          {group.members.map((m) => (
            <div className="group-member-row" key={m.id}>
              <span className={`dot-mini ${isUserActive(m.id, m.isActive) ? 'online' : ''}`} />
              <span>{m.name}</span>
              <span className="muted small">{m.position || 'Member'}</span>
              {m.id === group.createdBy && <span className="status-pill accepted">Owner</span>}
            </div>
          ))}
        </div>
      )}

      <div className="chat-body">
        {error && <div className="auth-error">{error}</div>}
        {messages.length === 0 && (
          <div className="empty-state small">
            <p><strong>No messages yet</strong></p>
            <p className="muted">Start the conversation.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.senderId === user.id ? 'me' : 'them'}`}>
            {m.senderId !== user.id && (
              <div className="msg-sender">{group?.members.find((mem) => mem.id === m.senderId)?.name || 'Member'}</div>
            )}
            {m.type === 'file' ? (
              <FileAttachment fileUrl={m.fileUrl} fileName={m.fileName} />
            ) : (
              m.content
            )}
            <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {notice && <div className="chat-notice" role="alert">{notice}</div>}
      <form className="chat-input" onSubmit={send}>
        <AttachButton onClick={() => fileInputRef.current.click()} uploading={uploading} />
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFilePick} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the group..." />
        <button type="submit" className="send-btn"><SendIcon size={16} /> Send</button>
      </form>

      {showEdit && (
        <div className="call-modal" onClick={() => setShowEdit(false)}>
          <div className="edit-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Group</h3>
            <form className="profile-form flat" onSubmit={saveEdit}>
              {editError && <div className="auth-error">{editError}</div>}
              <label>Group name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />

              <label>Current members</label>
              <div className="checkbox-list">
                {group.members.map((m) => (
                  <label key={m.id} className={`checkbox-row ${m.id === group.createdBy ? 'disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={!removeIds.includes(m.id)}
                      disabled={m.id === group.createdBy}
                      onChange={() => toggleRemove(m.id)}
                    />
                    {m.name} <span className="muted small">— {m.position || 'Member'}{m.id === group.createdBy ? ' (owner)' : ''}</span>
                  </label>
                ))}
              </div>
              <p className="muted small">Uncheck someone to remove them when you save.</p>

              <label>Add members</label>
              <div className="checkbox-list">
                {candidates.length === 0 && <p className="muted small">No more connected colleagues to add.</p>}
                {candidates.map((c) => (
                  <label key={c.id} className="checkbox-row">
                    <input type="checkbox" checked={addIds.includes(c.id)} onChange={() => toggleAdd(c.id)} />
                    {c.name} <span className="muted small">— {c.position || 'Member'}</span>
                  </label>
                ))}
              </div>

              <div className="edit-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowEdit(false)}>Cancel</button>
                <button type="submit" disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
