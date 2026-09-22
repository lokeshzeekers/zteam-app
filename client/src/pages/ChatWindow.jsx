import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { AttachButton, FileAttachment, SendIcon, TrashIcon, PhoneIcon, VideoIcon, CheckSquareIcon, PhoneIncomingIcon, PhoneMissedIcon, PhoneXIcon } from '../components/ChatIcons';
import BackButton from '../components/BackButton';
import { useNotificationCenter } from '../context/NotificationCenterContext';

function CallHistoryRow({ call, meId }) {
  const iAmCaller = call.callerId === meId;
  const label = call.callType === 'video' ? 'Video call' : 'Audio call';
  let Icon = PhoneIncomingIcon;
  let text = label;
  if (call.status === 'missed') { Icon = PhoneMissedIcon; text = iAmCaller ? `${label} · No answer` : `${label} · Missed`; }
  else if (call.status === 'rejected') { Icon = PhoneXIcon; text = iAmCaller ? `${label} · Declined` : `${label} · You declined`; }
  else if (call.status === 'completed') {
    const secs = call.endedAt ? Math.max(0, Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)) : null;
    text = secs !== null ? `${label} · ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)} min`}` : label;
  }
  return (
    <div className={`call-log-row ${call.status}`}>
      <Icon size={15} />
      <span>{text}</span>
      <span className="muted small">{new Date(call.startedAt).toLocaleTimeString()}</span>
    </div>
  );
}

export default function ChatWindow({ onStartCall }) {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { markDMRead } = useNotificationCenter();
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  function loadCalls() {
    api.get(`/api/calls/with/${userId}`).then((r) => setCalls(r.data.calls)).catch(() => {});
  }

  useEffect(() => {
    setError('');
    setSelecting(false);
    setSelectedIds([]);
    markDMRead(Number(userId));
    const load = () => api.get(`/api/messages/with/${userId}`)
      .then((r) => setMessages(r.data.messages))
      .catch((err) => setError(err?.response?.data?.error || 'Cannot load conversation'));
    load();
    loadCalls();

    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ message }) => {
      if (message.senderId === Number(userId) || message.receiverId === Number(userId)) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        if (message.senderId === Number(userId)) markDMRead(Number(userId));
      }
    };
    const onDeleted = ({ messageIds, otherUserId: fromId }) => {
      if (Number(fromId) !== Number(userId)) return;
      setMessages((prev) => prev.filter((m) => !messageIds.includes(m.id)));
      setSelectedIds((prev) => prev.filter((id) => !messageIds.includes(id)));
    };
    const onCallLog = () => loadCalls();
    const onRemoved = ({ userId: removedId }) => {
      if (Number(removedId) === Number(userId)) setError('This person is no longer part of Zteam.');
    };
    socket.on('new-message', handler);
    socket.on('message-sent', handler);
    socket.on('messages-deleted', onDeleted);
    socket.on('call-log-updated', onCallLog);
    socket.on('user-removed', onRemoved);
    socket.on('connect', load);
    return () => {
      socket.off('new-message', handler);
      socket.off('message-sent', handler);
      socket.off('messages-deleted', onDeleted);
      socket.off('call-log-updated', onCallLog);
      socket.off('user-removed', onRemoved);
      socket.off('connect', load);
    };
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, calls]);

  // Merge messages + call log entries into one time-ordered timeline.
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ kind: 'message', time: m.createdAt, data: m })),
      ...calls.map((c) => ({ kind: 'call', time: c.startedAt, data: c })),
    ];
    items.sort((a, b) => new Date(a.time) - new Date(b.time));
    return items;
  }, [messages, calls]);

  function send(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    const socket = getSocket();
    socket.emit('send-message', { receiverId: Number(userId), content: text, type: 'text' }, (res) => {
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
      getSocket().emit('send-message', {
        receiverId: Number(userId), type: 'file', fileUrl: data.fileUrl, fileName: data.fileName,
      }, (res) => { if (res?.error) setNotice(res.error); });
    } catch (err) {
      setNotice(err?.response?.data?.error || 'Could not upload the file.');
    } finally {
      setUploading(false);
    }
  }

  function toggleSelecting() {
    setSelecting((s) => !s);
    setSelectedIds([]);
  }
  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} message${selectedIds.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.post('/api/messages/delete', { messageIds: selectedIds });
      setMessages((prev) => prev.filter((m) => !selectedIds.includes(m.id)));
      setSelectedIds([]);
      setSelecting(false);
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the selected messages');
    }
  }

  async function deleteConversation() {
    if (!confirm('Delete this whole conversation from your chat list? The other person keeps their copy. This cannot be undone on your side.')) return;
    try {
      await api.delete(`/api/messages/with/${userId}`);
      navigate('/');
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete the conversation');
    }
  }

  if (error) {
    return <div className="panel"><p className="auth-error">{error}</p></div>;
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-left">
          <BackButton fallback="/" />
          <strong>Conversation</strong>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="icon-btn-sm"
            onClick={() => onStartCall?.(Number(userId), 'audio')}
            title="Audio call"
            aria-label="Audio call"
          >
            <PhoneIcon size={19} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            onClick={() => onStartCall?.(Number(userId), 'video')}
            title="Video call"
            aria-label="Video call"
          >
            <VideoIcon size={19} />
          </button>
          <button
            type="button"
            className={`icon-btn-sm${selecting ? ' active' : ''}`}
            onClick={toggleSelecting}
            title={selecting ? 'Cancel selection' : 'Select messages'}
            aria-label={selecting ? 'Cancel selection' : 'Select messages'}
          >
            <CheckSquareIcon size={19} />
          </button>
          <button type="button" className="icon-btn-sm danger" onClick={deleteConversation} title="Delete conversation" aria-label="Delete conversation">
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

      <div className="chat-body">
        {timeline.map((item) => item.kind === 'call' ? (
          <CallHistoryRow key={`call-${item.data.id}`} call={item.data} meId={user.id} />
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
              {item.data.type === 'file' ? (
                <FileAttachment fileUrl={item.data.fileUrl} fileName={item.data.fileName} />
              ) : (
                item.data.content
              )}
              <div className="msg-time">{new Date(item.data.createdAt).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {notice && <div className="chat-notice" role="alert">{notice}</div>}
      <form className="chat-input" onSubmit={send}>
        <AttachButton onClick={() => fileInputRef.current.click()} uploading={uploading} />
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFilePick} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." />
        <button type="submit" className="send-btn"><SendIcon size={16} /> Send</button>
      </form>
    </div>
  );
}
