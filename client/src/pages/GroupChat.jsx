import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';

export default function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setError('');
    api.get(`/api/groups/${groupId}`).then((r) => setGroup(r.data.group)).catch(() => setError('Group not found or you are not a member'));
    api.get(`/api/groups/${groupId}/messages`).then((r) => setMessages(r.data.messages));

    const socket = getSocket();
    if (!socket) return;
    socket.emit('join-group-room', { groupId: Number(groupId) });
    const handler = ({ message }) => {
      if (String(message.groupId) === String(groupId)) setMessages((prev) => [...prev, message]);
    };
    socket.on('new-group-message', handler);
    return () => {
      socket.off('new-group-message', handler);
      socket.emit('leave-group-room', { groupId: Number(groupId) });
    };
  }, [groupId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post('/api/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    getSocket().emit('send-group-message', {
      groupId: Number(groupId), type: 'file', fileUrl: data.fileUrl, fileName: data.fileName,
    }, (res) => { if (res?.error) setError(res.error); });
    e.target.value = '';
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

  if (error && !group) return <div className="panel"><p className="auth-error">{error}</p></div>;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <strong>{group?.name || 'Group'}</strong>
        <div className="chat-header-actions">
          <button onClick={startMeetingNow} title="Start a group video meeting now">🎥 Start Meeting</button>
        </div>
      </div>
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
              <a href={(api.defaults.baseURL || '') + m.fileUrl} target="_blank" rel="noreferrer">📎 {m.fileName}</a>
            ) : (
              m.content
            )}
            <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <button type="button" onClick={() => fileInputRef.current.click()}>📎</button>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFilePick} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the group..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
