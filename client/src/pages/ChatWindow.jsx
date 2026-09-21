import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { AttachButton, FileAttachment, SendIcon } from '../components/ChatIcons';
import BackButton from '../components/BackButton';
import { useNotificationCenter } from '../context/NotificationCenterContext';

export default function ChatWindow({ onStartCall }) {
  const { userId } = useParams();
  const { user } = useAuth();
  const { markDMRead } = useNotificationCenter();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setError('');
    markDMRead(Number(userId));
    const load = () => api.get(`/api/messages/with/${userId}`)
      .then((r) => setMessages(r.data.messages))
      .catch((err) => setError(err?.response?.data?.error || 'Cannot load conversation'));
    load();

    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ message }) => {
      if (message.senderId === Number(userId) || message.receiverId === Number(userId)) {
        // Never show the same message twice (e.g. one that also arrived via a refetch).
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        if (message.senderId === Number(userId)) markDMRead(Number(userId)); // we're looking right at it
      }
    };
    const onRemoved = ({ userId: removedId }) => {
      if (Number(removedId) === Number(userId)) setError('This person is no longer part of Zteam.');
    };
    socket.on('new-message', handler);
    socket.on('message-sent', handler);
    socket.on('user-removed', onRemoved);
    socket.on('connect', load); // pick up anything sent while we were disconnected
    return () => {
      socket.off('new-message', handler);
      socket.off('message-sent', handler);
      socket.off('user-removed', onRemoved);
      socket.off('connect', load);
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
          <button onClick={() => onStartCall?.(Number(userId), 'audio')}>📞 Audio</button>
          <button onClick={() => onStartCall?.(Number(userId), 'video')}>🎥 Video</button>
        </div>
      </div>
      <div className="chat-body">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.senderId === user.id ? 'me' : 'them'}`}>
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
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." />
        <button type="submit" className="send-btn"><SendIcon size={16} /> Send</button>
      </form>
    </div>
  );
}
