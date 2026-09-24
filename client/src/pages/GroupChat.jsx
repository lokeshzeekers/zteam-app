import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { AttachButton, FileAttachment, SendIcon, TrashIcon, CheckSquareIcon, PhoneIncomingIcon, PhoneMissedIcon, PhoneXIcon, CheckIcon } from '../components/ChatIcons';
import BackButton from '../components/BackButton';
import MessageMenu from '../components/MessageMenu';
import { useNotificationCenter } from '../context/NotificationCenterContext';

function GroupCallHistoryRow({ call }) {
  const label = call.callType === 'video' ? 'Video meeting' : 'Audio meeting';
  let Icon = PhoneIncomingIcon;
  let text = `${label} · ${call.title}`;
  if (call.status === 'cancelled') { Icon = PhoneXIcon; text = `${label} cancelled · ${call.title}`; }
  else if (call.myStatus === 'invited') { Icon = PhoneMissedIcon; text = `${label} · You missed it · ${call.title}`; }
  else {
    const secs = call.endedAt && call.startedAt ? Math.max(0, Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)) : null;
    text = `${label} · ${call.title}${secs !== null ? ` · ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)} min`}` : ''}`;
  }
  const statusClass = call.status === 'cancelled' || call.myStatus === 'invited' ? 'missed' : 'completed';
  return (
    <div className={`call-log-row ${statusClass}`}>
      <Icon size={15} />
      <span>{text}</span>
      <span className="muted small">{new Date(call.scheduledAt).toLocaleTimeString()}</span>
    </div>
  );
}

// Group read receipts on my own messages:
//   1 check   = sent (nobody else has caught up yet)
//   2 checks  = read by some members
//   2 green checks in a white pill = read by everyone (clearly visible on the blue bubble)
function GroupReceipt({ message, members, reads, myId }) {
  const others = members.filter((m) => m.id !== myId);
  if (others.length === 0) return <span className="receipt" title="Sent"><CheckIcon size={12} /></span>;
  const readers = others.filter((m) => reads[m.id] && new Date(reads[m.id]) >= new Date(message.createdAt));
  if (readers.length === others.length) {
    return <span className="receipt read" title="Read by everyone"><CheckIcon size={12} /><CheckIcon size={12} /></span>;
  }
  if (readers.length > 0) {
    return <span className="receipt" title={`Read by ${readers.map((m) => m.name).join(', ')}`}><CheckIcon size={12} /><CheckIcon size={12} /></span>;
  }
  return <span className="receipt" title="Sent"><CheckIcon size={12} /></span>;
}

export default function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { markGroupRead } = useNotificationCenter();
  const { isUserActive } = usePresence();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [reads, setReads] = useState({}); // userId -> lastReadAt
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // userId -> name
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const typingClearTimersRef = useRef({});

  function loadGroup() {
    return api.get(`/api/groups/${groupId}`).then((r) => { setGroup(r.data.group); setReads(r.data.reads || {}); });
  }
  function loadCalls() {
    api.get(`/api/calls/group/${groupId}`).then((r) => setCalls(r.data.calls)).catch(() => {});
  }
  const loadFirstPage = useCallback(() => {
    return api.get(`/api/groups/${groupId}/messages`)
      .then((r) => { setMessages(r.data.messages); setHasMore(r.data.hasMore); })
      .catch(() => {});
  }, [groupId]);

  async function loadOlder() {
    if (!hasMore || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldestId = messages[0].id;
      const { data } = await api.get(`/api/groups/${groupId}/messages`, { params: { before: oldestId } });
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } catch (err) {
      // non-fatal; leave "Load older" visible so they can retry
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    setError('');
    setSelecting(false);
    setSelectedIds([]);
    setEditingId(null);
    markGroupRead(Number(groupId));
    loadFirstPage();
    loadGroup().catch(() => setError('Group not found or you are not a member'));
    loadCalls();

    const socket = getSocket();
    if (!socket) return undefined;
    socket.emit('join-group-room', { groupId: Number(groupId) });
    const handler = ({ message }) => {
      if (String(message.groupId) === String(groupId)) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        markGroupRead(Number(groupId)); // we're looking right at this group
        if (message.senderId !== user.id) api.post(`/api/groups/${groupId}/read`).catch(() => {}); // lets the sender see it as read
        setTypingUsers((prev) => { const next = { ...prev }; delete next[message.senderId]; return next; });
      }
    };
    const onDeleted = ({ groupId: gid, messageIds }) => {
      if (String(gid) !== String(groupId)) return;
      setMessages((prev) => prev.filter((m) => !messageIds.includes(m.id)));
      setSelectedIds((prev) => prev.filter((id) => !messageIds.includes(id)));
    };
    const onEdited = ({ groupId: gid, message }) => {
      if (String(gid) !== String(groupId)) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onGroupRead = ({ groupId: gid, userId: readerId, lastReadAt }) => {
      if (String(gid) !== String(groupId)) return;
      setReads((prev) => ({ ...prev, [readerId]: lastReadAt }));
    };
    // I cleared this group's messages from another window (desktop app / browser).
    const onCleared = ({ groupId: gid }) => {
      if (String(gid) !== String(groupId)) return;
      setMessages([]);
      setHasMore(false);
      setSelectedIds([]);
    };
    // After a reconnect the server has forgotten our room: rejoin it and catch up.
    const onReconnect = () => {
      socket.emit('join-group-room', { groupId: Number(groupId) });
      loadFirstPage();
      loadGroup().catch(() => {});
      loadCalls();
    };
    const onRemoved = () => { loadGroup().catch(() => {}); };
    const onMeetingChange = () => loadCalls();
    const onGroupTyping = ({ groupId: gid, userId: fromId, name }) => {
      if (String(gid) !== String(groupId) || fromId === user.id) return;
      setTypingUsers((prev) => ({ ...prev, [fromId]: name }));
      clearTimeout(typingClearTimersRef.current[fromId]);
      typingClearTimersRef.current[fromId] = setTimeout(() => {
        setTypingUsers((prev) => { const next = { ...prev }; delete next[fromId]; return next; });
      }, 4000);
    };
    const onGroupStopTyping = ({ groupId: gid, userId: fromId }) => {
      if (String(gid) !== String(groupId)) return;
      setTypingUsers((prev) => { const next = { ...prev }; delete next[fromId]; return next; });
      clearTimeout(typingClearTimersRef.current[fromId]);
    };
    socket.on('new-group-message', handler);
    socket.on('group-messages-deleted', onDeleted);
    socket.on('group-message-edited', onEdited);
    socket.on('group-read', onGroupRead);
    socket.on('group-cleared', onCleared);
    socket.on('connect', onReconnect);
    socket.on('user-removed', onRemoved);
    socket.on('meeting-updated', onMeetingChange);
    socket.on('meeting-cancelled', onMeetingChange);
    socket.on('meeting-starting', onMeetingChange);
    socket.on('meeting-ended', onMeetingChange);
    socket.on('group-typing', onGroupTyping);
    socket.on('group-stop-typing', onGroupStopTyping);
    return () => {
      socket.off('new-group-message', handler);
      socket.off('group-messages-deleted', onDeleted);
      socket.off('group-message-edited', onEdited);
      socket.off('group-read', onGroupRead);
      socket.off('group-cleared', onCleared);
      socket.off('connect', onReconnect);
      socket.off('user-removed', onRemoved);
      socket.off('meeting-updated', onMeetingChange);
      socket.off('meeting-cancelled', onMeetingChange);
      socket.off('meeting-starting', onMeetingChange);
      socket.off('meeting-ended', onMeetingChange);
      socket.off('group-typing', onGroupTyping);
      socket.off('group-stop-typing', onGroupStopTyping);
      socket.emit('group-stop-typing', { groupId: Number(groupId) });
      socket.emit('leave-group-room', { groupId: Number(groupId) });
      clearTimeout(typingTimeoutRef.current);
      Object.values(typingClearTimersRef.current).forEach(clearTimeout);
    };
  }, [groupId, loadFirstPage, markGroupRead, user.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, calls]);

  const isOwner = group && (group.createdBy === user.id || user.role === 'admin');

  // Merge messages + past-meeting entries into one time-ordered timeline.
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ kind: 'message', time: m.createdAt, data: m })),
      ...calls.map((c) => ({ kind: 'call', time: c.startedAt || c.scheduledAt, data: c })),
    ];
    items.sort((a, b) => new Date(a.time) - new Date(b.time));
    return items;
  }, [messages, calls]);

  function onTextChange(e) {
    setText(e.target.value);
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current > 1500) {
      socket.emit('group-typing', { groupId: Number(groupId) });
      lastTypingEmitRef.current = now;
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('group-stop-typing', { groupId: Number(groupId) });
    }, 2500);
  }

  function send(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    getSocket().emit('send-group-message', { groupId: Number(groupId), content: text, type: 'text' }, (res) => {
      if (res?.error) setError(res.error);
    });
    setText('');
    clearTimeout(typingTimeoutRef.current);
    getSocket().emit('group-stop-typing', { groupId: Number(groupId) });
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

  function toggleSelecting() {
    setSelecting((s) => !s);
    setSelectedIds([]);
    setEditingId(null);
  }
  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditText(m.content || '');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }
  async function saveEdit(id) {
    const content = editText.trim();
    if (!content) return;
    try {
      const { data } = await api.put(`/api/groups/${groupId}/messages/${id}`, { content });
      setMessages((prev) => prev.map((m) => (m.id === id ? data.message : m)));
      cancelEdit();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save the edit');
    }
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} message${selectedIds.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.post(`/api/groups/${groupId}/messages/delete`, { messageIds: selectedIds });
      setMessages((prev) => prev.filter((m) => !selectedIds.includes(m.id)));
      setSelectedIds([]);
      setSelecting(false);
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the selected messages');
    }
  }

  // Clears the messages for me only — I stay in the chat and the group stays in my list.
  async function clearMessagesForMe() {
    if (!confirm(`Delete all messages in "${group.name}" for you? The group stays in your list and other members keep their copy.`)) return;
    try {
      await api.post(`/api/groups/${groupId}/hide`);
      setMessages([]);
      setHasMore(false);
      setSelectedIds([]);
      setSelecting(false);
      markGroupRead(Number(groupId));
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the messages');
    }
  }

  if (error && !group) return <div className="panel"><p className="auth-error">{error}</p></div>;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-left">
          <BackButton fallback="/groups" />
          <strong>{group?.name || 'Group'}</strong>
        </div>
        <div className="chat-header-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setShowMembers((s) => !s)}>
            👥 Members ({group?.members.length || 0})
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={startMeetingNow} title="Start a group video meeting now">🎥 Start Meeting</button>
          <button
            type="button"
            className={`icon-btn-sm${selecting ? ' active' : ''}`}
            onClick={toggleSelecting}
            title={selecting ? 'Cancel selection' : 'Select messages'}
            aria-label={selecting ? 'Cancel selection' : 'Select messages'}
          >
            <CheckSquareIcon size={19} />
          </button>
          {isOwner && <button type="button" className="btn-secondary btn-sm" onClick={openEdit}>Edit</button>}
          {isOwner && <button type="button" className="btn-danger btn-sm" onClick={deleteGroup}>Delete</button>}
          <button type="button" className="icon-btn-sm danger" onClick={clearMessagesForMe} title="Delete all messages (for me)" aria-label="Delete all messages for me">
            <TrashIcon size={19} />
          </button>
        </div>
      </div>

      {selecting && selectedIds.length > 0 && (
        <div className="selection-bar">
          <span>{selectedIds.length} selected</span>
          <button type="button" className="btn-danger btn-sm" onClick={deleteSelected}>
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      )}

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
        {hasMore && (
          <button type="button" className="load-older-btn" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {timeline.length === 0 && (
          <div className="empty-state small">
            <p><strong>No messages yet</strong></p>
            <p className="muted">Start the conversation.</p>
          </div>
        )}
        {timeline.map((item) => item.kind === 'call' ? (
          <GroupCallHistoryRow key={`call-${item.data.id}`} call={item.data} />
        ) : (
          <div key={item.data.id} className={`msg ${item.data.senderId === user.id ? 'me' : 'them'} ${selecting && item.data.senderId === user.id ? 'selectable' : ''}`}>
            {selecting && item.data.senderId === user.id && (
              <input
                type="checkbox"
                className="msg-select-checkbox"
                checked={selectedIds.includes(item.data.id)}
                onChange={() => toggleSelected(item.data.id)}
              />
            )}
            <div className="msg-content">
              {item.data.senderId !== user.id && (
                <div className="msg-sender">{group?.members.find((mem) => mem.id === item.data.senderId)?.name || 'Member'}</div>
              )}
              {editingId === item.data.id ? (
                <div className="msg-edit-form">
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} autoFocus />
                  <div className="msg-edit-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                    <button type="button" className="btn-primary btn-sm" onClick={() => saveEdit(item.data.id)}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  {item.data.type === 'file' ? (
                    <FileAttachment fileUrl={item.data.fileUrl} fileName={item.data.fileName} />
                  ) : (
                    <span className="msg-text">{item.data.content}</span>
                  )}
                  {!selecting && item.data.senderId === user.id && item.data.type === 'text' && (
                    <MessageMenu onEdit={() => startEdit(item.data)} />
                  )}
                  <div className="msg-time">
                    {item.data.editedAt && <span className="edited-tag">edited</span>}
                    {new Date(item.data.createdAt).toLocaleTimeString()}
                    {item.data.senderId === user.id && group && <GroupReceipt message={item.data} members={group.members} reads={reads} myId={user.id} />}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {Object.keys(typingUsers).length > 0 && (
          <div className="typing-indicator" aria-live="polite">
            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            <span className="muted small">{Object.values(typingUsers).join(', ')} typing…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {notice && <div className="chat-notice" role="alert">{notice}</div>}
      <form className="chat-input" onSubmit={send}>
        <AttachButton onClick={() => fileInputRef.current.click()} uploading={uploading} />
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFilePick} />
        <input value={text} onChange={onTextChange} placeholder="Message the group..." />
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
