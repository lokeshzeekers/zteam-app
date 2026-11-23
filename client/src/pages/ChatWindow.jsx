import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import {
  AttachButton, SendIcon, TrashIcon, PhoneIcon, VideoIcon, CheckSquareIcon,
  PhoneIncomingIcon, PhoneMissedIcon, PhoneXIcon, CheckIcon, BanIcon, SearchIcon,
} from '../components/ChatIcons';
import BackButton from '../components/BackButton';
import FileAttachment from '../components/FileAttachment';
import MessageMenu from '../components/MessageMenu';
import ChatMenu from '../components/ChatMenu';
import DateSeparator from '../components/DateSeparator';
import ScrollToBottomButton from '../components/ScrollToBottomButton';
import ChatSearchBar from '../components/ChatSearchBar';
import Highlight from '../components/Highlight';
import useChatJump from '../hooks/useChatJump';
import { withDateSeparators } from '../utils/dates';
import { useNotificationCenter } from '../context/NotificationCenterContext';
import { confirmDialog, alertDialog } from '../dialogs';

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

// sent (1 grey check) -> delivered (2 grey checks) -> read (2 blue checks)
function ReadReceipt({ message }) {
  if (message.readAt) return <span className="receipt read" title="Read"><CheckIcon size={12} /><CheckIcon size={12} /></span>;
  if (message.deliveredAt) return <span className="receipt" title="Delivered"><CheckIcon size={12} /><CheckIcon size={12} /></span>;
  return <span className="receipt" title="Sent"><CheckIcon size={12} /></span>;
}

const TYPING_STOP_DELAY = 2500;

// Remembers who each chat is with, so re-opening a chat shows the name instantly.
const peerCache = new Map();

export default function ChatWindow({ onStartCall }) {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { markDMRead } = useNotificationCenter();
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [peer, setPeer] = useState(() => peerCache.get(Number(userId)) || null); // who this chat is with (header)
  const instantUntil = useRef(0); // scrolls before this time jump instantly (opening a chat) instead of animating
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [otherTyping, setOtherTyping] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMatchId, setCurrentMatchId] = useState(null);
  const bottomRef = useRef(null);
  const bodyRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const onBodyScroll = (e) => {
    const el = e.currentTarget;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  };
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const pendingFilesRef = useRef([]);
  pendingFilesRef.current = pendingFiles;
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const otherTypingTimeoutRef = useRef(null);

  function loadCalls() {
    api.get(`/api/calls/with/${userId}`).then((r) => setCalls(r.data.calls)).catch(() => {});
  }

  const fetchAround = useCallback((id) => (
    api.get(`/api/messages/with/${userId}`, { params: { around: id } }).then((r) => r.data)
  ), [userId]);
  const jump = useChatJump({ scopeKey: userId, setMessages, setHasMore, fetchAround });
  const { takeInitial, applyWindow, clearDetached } = jump;

  const isChatVisible = useCallback(() => (
    typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus())
  ), []);

  const loadFirstPage = useCallback(() => {
    // Coming from global Search with ?msg=<id>: open the chat positioned on that message.
    const around = takeInitial();
    const params = isChatVisible() ? undefined : { background: 1 };
    const req = around ? fetchAround(around) : api.get(`/api/messages/with/${userId}`, { params }).then((r) => r.data);
    return req
      .then((data) => {
        if (data.peer) { peerCache.set(Number(userId), data.peer); setPeer(data.peer); }
        if (around) { applyWindow(around, data); return; }
        instantUntil.current = Date.now() + 1500;
        setMessages(data.messages); setHasMore(data.hasMore); clearDetached();
      })
      .catch((err) => setError(err?.response?.data?.error || 'Cannot load conversation'));
  }, [userId, takeInitial, fetchAround, applyWindow, clearDetached]);

  async function loadOlder() {
    if (!hasMore || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldestId = messages[0].id;
      const { data } = await api.get(`/api/messages/with/${userId}`, { params: { before: oldestId } });
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
    if (isChatVisible()) markDMRead(Number(userId));
    loadFirstPage();
    loadCalls();

    const markVisibleChatRead = () => {
      if (!isChatVisible()) return;
      markDMRead(Number(userId));
      api.post(`/api/messages/with/${userId}/read`).catch(() => {});
    };

    window.addEventListener('focus', markVisibleChatRead);
    document.addEventListener('visibilitychange', markVisibleChatRead);

    const socket = getSocket();
    if (!socket) {
      return () => {
        window.removeEventListener('focus', markVisibleChatRead);
        document.removeEventListener('visibilitychange', markVisibleChatRead);
      };
    }
    const handler = ({ message }) => {
      if (message.senderId === Number(userId) || message.receiverId === Number(userId)) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        if (message.senderId === Number(userId)) {
          setOtherTyping(false);
          // Only mark read when this window/tab is actually visible & focused.
          if (isChatVisible()) {
            markDMRead(Number(userId));
            api.post(`/api/messages/with/${userId}/read`).catch(() => {});
          }
        }
      }
    };
    const onDeleted = ({ messageIds, otherUserId: fromId }) => {
      if (Number(fromId) !== Number(userId)) return;
      // Real time: the message turns into "This message was deleted" for both people
      // (content is dropped locally straight away, no reload needed).
      const at = new Date().toISOString();
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, deletedAt: at, content: null, fileUrl: null, fileName: null } : m)));
      setSelectedIds((prev) => prev.filter((id) => !messageIds.includes(id)));
      setEditingId((cur) => (messageIds.includes(cur) ? null : cur));
    };
    const onEdited = ({ message }) => {
      const otherId = message.senderId === user.id ? message.receiverId : message.senderId;
      if (otherId !== Number(userId)) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onRead = ({ messageIds }) => {
      const now = new Date().toISOString();
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, readAt: m.readAt || now, deliveredAt: m.deliveredAt || now } : m)));
    };
    const onCallLog = () => loadCalls();
    const onRemoved = ({ userId: removedId }) => {
      if (Number(removedId) === Number(userId)) setError('This person is no longer part of Zteam.');
    };
    const onTyping = ({ userId: fromId }) => {
      if (fromId !== Number(userId)) return;
      setOtherTyping(true);
      clearTimeout(otherTypingTimeoutRef.current);
      otherTypingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 4000);
    };
    const onStopTyping = ({ userId: fromId }) => {
      if (fromId !== Number(userId)) return;
      setOtherTyping(false);
      clearTimeout(otherTypingTimeoutRef.current);
    };
    socket.on('new-message', handler);
    socket.on('message-sent', handler);
    socket.on('messages-deleted', onDeleted);
    socket.on('message-edited', onEdited);
    socket.on('messages-read', onRead);
    socket.on('call-log-updated', onCallLog);
    socket.on('user-removed', onRemoved);
    socket.on('typing', onTyping);
    socket.on('stop-typing', onStopTyping);
    socket.on('connect', loadFirstPage);
    return () => {
      window.removeEventListener('focus', markVisibleChatRead);
      document.removeEventListener('visibilitychange', markVisibleChatRead);
      socket.off('new-message', handler);
      socket.off('message-sent', handler);
      socket.off('messages-deleted', onDeleted);
      socket.off('message-edited', onEdited);
      socket.off('messages-read', onRead);
      socket.off('call-log-updated', onCallLog);
      socket.off('user-removed', onRemoved);
      socket.off('typing', onTyping);
      socket.off('stop-typing', onStopTyping);
      socket.off('connect', loadFirstPage);
      clearTimeout(typingTimeoutRef.current);
      clearTimeout(otherTypingTimeoutRef.current);
      socket.emit('stop-typing', { receiverId: Number(userId) });
    };
  }, [userId, loadFirstPage, markDMRead, isChatVisible, user.id]);

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = bodyRef.current;
    if (!el) return;
    if (behavior === 'auto') {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // Layout effect = scroll before paint, so opening a chat lands on the newest message with no
  // visible scroll-down animation. Only NEW messages after that animate.
  useLayoutEffect(() => {
    if (jump.pendingRef.current || jump.detached) return;
    const isInitial = Date.now() < instantUntil.current;
    scrollToBottom(isInitial ? 'auto' : 'smooth');
  }, [messages, calls, scrollToBottom, jump.detached]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep pinned to bottom during initial load window as images/attachments/fonts finish layout
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const snapIfInitial = () => {
      if (!jump.pendingRef.current && !jump.detached && Date.now() < instantUntil.current) {
        el.scrollTop = el.scrollHeight;
      }
    };
    snapIfInitial();
    const raf = requestAnimationFrame(snapIfInitial);
    const t1 = setTimeout(snapIfInitial, 80);
    const t2 = setTimeout(snapIfInitial, 300);
    el.addEventListener('load', snapIfInitial, true);
    let mutObserver;
    if (typeof MutationObserver !== 'undefined') {
      mutObserver = new MutationObserver(snapIfInitial);
      mutObserver.observe(el, { childList: true, subtree: true });
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      el.removeEventListener('load', snapIfInitial, true);
      mutObserver?.disconnect();
    };
  }, [userId, messages.length, calls.length, jump.detached]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    pendingFilesRef.current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
  }, []);

  // After a jump window renders, scroll to the target message.
  useEffect(() => { jump.afterRender(); }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMatches = useCallback((q) => (
    api.get(`/api/messages/with/${userId}/search`, { params: { q } }).then((r) => r.data.matches)
  ), [userId]);
  function onSearchJump(match) { setCurrentMatchId(match.id); jump.jumpTo(match.id); }
  function closeSearch() { setSearchOpen(false); setSearchTerm(''); setCurrentMatchId(null); }

  async function backToLatest() {
    await loadFirstPage();
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  // Merge messages + call log entries into one time-ordered timeline.
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ kind: 'message', time: m.createdAt, data: m })),
      ...calls.map((c) => ({ kind: 'call', time: c.startedAt, data: c })),
    ];
    items.sort((a, b) => new Date(a.time) - new Date(b.time));
    return withDateSeparators(items, (i) => i.time);
  }, [messages, calls]);

  function resizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }

  function onTextChange(e) {
    setText(e.target.value);
    resizeTextarea(e.target);
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    // Throttle the 'typing' emit itself (no point re-announcing on every
    // keystroke); the auto-stop timeout is what actually debounces the signal.
    if (now - lastTypingEmitRef.current > 1500) {
      socket.emit('typing', { receiverId: Number(userId) });
      lastTypingEmitRef.current = now;
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop-typing', { receiverId: Number(userId) });
    }, TYPING_STOP_DELAY);
  }

  function stageFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(Boolean);
    if (incoming.length === 0) return;
    setNotice('');
    const staged = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setPendingFiles((prev) => [...prev, ...staged]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function removePendingFile(id) {
    setPendingFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  async function send(e) {
    e?.preventDefault();
    if (uploading) return;
    const trimmed = text.trim();
    const filesToSend = [...pendingFiles];
    if (!trimmed && filesToSend.length === 0) return;

    const socket = getSocket();
    if (trimmed) {
      socket.emit('send-message', { receiverId: Number(userId), content: text, type: 'text' }, (res) => {
        if (res?.error) setError(res.error);
      });
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      clearTimeout(typingTimeoutRef.current);
      socket.emit('stop-typing', { receiverId: Number(userId) });
    }

    if (filesToSend.length > 0) {
      setNotice('');
      setUploading(true);
      const failed = [];
      try {
        for (const item of filesToSend) {
          try {
            const form = new FormData();
            form.append('file', item.file);
            const { data } = await api.post('/api/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
            socket.emit('send-message', {
              receiverId: Number(userId), type: 'file', fileUrl: data.fileUrl, fileName: data.fileName,
            }, (res) => { if (res?.error) setNotice(res.error); });
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          } catch (err) {
            failed.push(item);
            setNotice(err?.response?.data?.error || `Could not upload "${item.file.name}".`);
          }
        }
        setPendingFiles(failed);
      } finally {
        setUploading(false);
      }
    }
  }

  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobileView(e.matches);
    setIsMobileView(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function onInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onFilePick(e) {
    stageFiles(e.target.files);
    e.target.value = '';
  }

  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function onDragEnter(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function onDragOver(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    stageFiles(e.dataTransfer?.files);
  }

  function toggleSelecting() {
    setSelecting((s) => !s);
    setSelectedIds([]);
    setEditingId(null);
  }
  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    if (!(await confirmDialog(`Delete ${selectedIds.length} message${selectedIds.length > 1 ? 's' : ''}? This cannot be undone.`, { confirmText: 'Delete' }))) return;
    try {
      await api.post('/api/messages/delete', { messageIds: selectedIds });
      setMessages((prev) => prev.filter((m) => !selectedIds.includes(m.id)));
      setSelectedIds([]);
      setSelecting(false);
    } catch (err) {
      alertDialog(err?.response?.data?.error || 'Could not delete the selected messages');
    }
  }

  async function deleteConversation() {
    if (!(await confirmDialog('Delete this whole conversation from your chat list? The other person keeps their copy. This cannot be undone on your side.', { confirmText: 'Delete' }))) return;
    try {
      await api.delete(`/api/messages/with/${userId}`);
      navigate('/');
    } catch (err) {
      alertDialog(err?.response?.data?.error || 'Could not delete the conversation');
    }
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
      const { data } = await api.put(`/api/messages/${id}`, { content });
      setMessages((prev) => prev.map((m) => (m.id === id ? data.message : m)));
      cancelEdit();
    } catch (err) {
      alertDialog(err?.response?.data?.error || 'Could not save the edit');
    }
  }

  if (error) {
    return <div className="panel"><p className="auth-error">{error}</p></div>;
  }

  return (
    <div
      className={`chat-window${isDragging ? ' dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="chat-drop-overlay" aria-hidden="true">
          <div className="chat-drop-card">Drop files to attach</div>
        </div>
      )}
      <div className="chat-header">
        <div className="chat-header-left">
          <BackButton fallback="/" />
          <span className={`chat-avatar${peer ? '' : ' skeleton'}`} aria-hidden="true">{peer ? peer.name.charAt(0).toUpperCase() : ''}</span>
          <div className="chat-title">
            {peer ? (
              <>
                <strong>{peer.name}</strong>
                {peer.position && <span className="chat-subtitle">{peer.position}{peer.isActive ? ' · Active' : ''}</span>}
              </>
            ) : (
              <span className="chat-skeleton-line" role="status" aria-label="Loading chat" />
            )}
          </div>
        </div>
        <div className="chat-header-actions chat-actions-inline">
          <button
            type="button"
            className={`icon-btn-sm${searchOpen ? ' active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title="Search in chat"
            aria-label="Search in chat"
          >
            <SearchIcon size={19} />
          </button>
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
        <ChatMenu
          className="chat-actions-menu"
          items={[
            { label: searchOpen ? 'Close search' : 'Search', icon: <SearchIcon size={19} />, onClick: () => (searchOpen ? closeSearch() : setSearchOpen(true)) },
            { label: 'Voice call', icon: <PhoneIcon size={19} />, onClick: () => onStartCall?.(Number(userId), 'audio') },
            { label: 'Video call', icon: <VideoIcon size={19} />, onClick: () => onStartCall?.(Number(userId), 'video') },
            { label: selecting ? 'Cancel selection' : 'Select messages', icon: <CheckSquareIcon size={19} />, onClick: toggleSelecting },
            { label: 'Delete conversation', icon: <TrashIcon size={19} />, onClick: deleteConversation, danger: true },
          ]}
        />
      </div>

      {searchOpen && (
        <ChatSearchBar fetchMatches={fetchMatches} onJump={onSearchJump} onTermChange={setSearchTerm} onClose={closeSearch} />
      )}

      {selecting && selectedIds.length > 0 && (
        <div className="selection-bar">
          <span>{selectedIds.length} selected</span>
          <button type="button" className="btn-danger btn-sm" onClick={deleteSelected}>
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      )}

      <div className="chat-body" ref={bodyRef} onScroll={onBodyScroll}>
        {hasMore && (
          <button type="button" className="load-older-btn" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {timeline.map((item) => item.kind === 'date' ? (
          <DateSeparator key={item.key} time={item.time} />
        ) : item.kind === 'call' ? (
          <CallHistoryRow key={`call-${item.data.id}`} call={item.data} meId={user.id} />
        ) : (
          <div
            key={item.data.id}
            id={`msg-${item.data.id}`}
            className={`msg ${item.data.senderId === user.id ? 'me' : 'them'} ${selecting && item.data.senderId === user.id ? 'selectable' : ''}${jump.highlightId === item.data.id ? ' msg-flash' : ''}${currentMatchId === item.data.id && searchOpen ? ' msg-current-match' : ''}`}
          >
            {selecting && item.data.senderId === user.id && !item.data.deletedAt && (
              <input
                type="checkbox"
                className="msg-select-checkbox"
                checked={selectedIds.includes(item.data.id)}
                onChange={() => toggleSelected(item.data.id)}
              />
            )}
            <div className="msg-content">
              {item.data.deletedAt ? (
                <>
                  <span className="msg-text msg-deleted">
                    <BanIcon size={14} /> {item.data.senderId === user.id ? 'You deleted this message' : 'This message was deleted'}
                  </span>
                  <div className="msg-time">{new Date(item.data.createdAt).toLocaleTimeString()}</div>
                </>
              ) : editingId === item.data.id ? (
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
                    <span className="msg-text"><Highlight text={item.data.content} term={searchOpen ? searchTerm : ''} /></span>
                  )}
                  {!selecting && item.data.senderId === user.id && item.data.type === 'text' && (
                    <MessageMenu onEdit={() => startEdit(item.data)} />
                  )}
                  <div className="msg-time">
                    {item.data.editedAt && <span className="edited-tag">edited</span>}
                    {new Date(item.data.createdAt).toLocaleTimeString()}
                    {item.data.senderId === user.id && <ReadReceipt message={item.data} />}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {otherTyping && (
          <div className="typing-indicator" aria-live="polite">
            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ScrollToBottomButton
        visible={showScrollBtn || jump.detached}
        onClick={() => {
          if (jump.detached) backToLatest();
          else bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
        }}
      />
      {notice && <div className="chat-notice" role="alert">{notice}</div>}
      <form className="chat-composer" onSubmit={send}>
        {pendingFiles.length > 0 && (
          <div className="staged-files-bar">
            {pendingFiles.map((item) => (
              <div className="staged-file-item" key={item.id}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.file.name} className="staged-file-thumb" />
                ) : (
                  <span className="staged-file-badge">{(item.file.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</span>
                )}
                <span className="staged-file-name" title={item.file.name}>{item.file.name}</span>
                <button
                  type="button"
                  className="staged-file-remove"
                  onClick={() => removePendingFile(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input">
          <AttachButton onClick={() => fileInputRef.current.click()} uploading={uploading} />
          <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={onFilePick} />
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={onTextChange}
            onKeyDown={onInputKeyDown}
            placeholder={isMobileView ? "Type a message..." : "Type a message... (Shift+Enter for new line)"}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={uploading || (!text.trim() && pendingFiles.length === 0)}
            aria-label="Send"
          >
            <SendIcon size={16} /> <span className="send-label">{uploading ? 'Sending…' : 'Send'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
