import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';

export default function ChatWindow({ onStartCall }) {
  const { userId } = useParams();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setError('');
    api.get(`/api/messages/with/${userId}`)
      .then((r) => setMessages(r.data.messages))
      .catch((err) => setError(err?.response?.data?.error || 'Cannot load conversation'));

    const socket = getSocket();
    if (!socket) return;
    const handler = ({ message }) => {
      if (message.senderId === Number(userId) || message.receiverId === Number(userId)) {
        setMessages((prev) => [...prev, message]);
      }
    };
    socket.on('new-message', handler);
    socket.on('message-sent', handler);
    return () => {
      socket.off('new-message', handler);
      socket.off('message-sent', handler);
    };
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post('/api/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    const socket = getSocket();
    socket.emit('send-message', {
      receiverId: Number(userId), type: 'file', fileUrl: data.fileUrl, fileName: data.fileName,
    }, (res) => { if (res?.error) setError(res.error); });
    e.target.value = '';
  }

  if (error) {
    return <div className="panel"><p className="auth-error">{error}</p></div>;
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <strong>Conversation</strong>
        <div className="chat-header-actions">
          <button onClick={() => onStartCall?.(Number(userId), 'audio')}>📞 Audio</button>
          <button onClick={() => onStartCall?.(Number(userId), 'video')}>🎥 Video</button>
        </div>
      </div>
      <div className="chat-body">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.senderId === user.id ? 'me' : 'them'}`}>
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
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
