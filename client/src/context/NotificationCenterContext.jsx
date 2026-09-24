import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getSocket } from '../socket';
import api from '../api';
import { clearFlash } from '../notify';

const NotificationCenterContext = createContext(null);

// Tracks "you have something new to look at" per sidebar section:
//  - Inbox: direct-message threads with an unread incoming message
//  - Groups: groups with a new message since you last opened them
//  - Meetings: meetings that are live right now, or invites/starts you
//    haven't seen yet
// Seeded from the server on login so a refresh/relogin never loses real
// unread state — DMs via readAt, groups via the GroupRead table (the
// server computes and returns `unread` per group) — then kept live via
// socket events for anything that happens during the session.
export function NotificationCenterProvider({ children }) {
  const { user } = useAuth();
  const [unreadDMs, setUnreadDMs] = useState(new Set());
  const [unreadGroups, setUnreadGroups] = useState(new Set());
  const [meetingAlerts, setMeetingAlerts] = useState(new Set());

  // Latest counts, readable from socket handlers without stale closures.
  const countsRef = useRef({ dms: 0, groups: 0, meetings: 0 });
  countsRef.current = { dms: unreadDMs.size, groups: unreadGroups.size, meetings: meetingAlerts.size };

  // Returns how many are unread now (or null if the request failed).
  const seedDMs = useCallback(async () => {
    try {
      const { data } = await api.get('/api/messages/inbox');
      // The server counts only incoming, unread, NOT-deleted messages after my clear point.
      const unread = data.threads.filter((t) => t.user && t.unread).map((t) => t.user.id);
      setUnreadDMs(new Set(unread));
      return unread.length;
    } catch (e) { return null; /* not fatal, badges just start empty */ }
  }, []);
  const seedGroups = useCallback(async () => {
    try {
      const { data } = await api.get('/api/groups');
      const unread = data.groups.filter((g) => g.unread).map((g) => g.id);
      setUnreadGroups(new Set(unread));
      return unread.length;
    } catch (e) { return null; }
  }, []);
  const seed = useCallback(async () => {
    await seedDMs();
    await seedGroups();
    try {
      const { data } = await api.get('/api/meetings');
      const ongoing = data.meetings.filter((m) => m.status === 'ongoing').map((m) => m.id);
      setMeetingAlerts(new Set(ongoing));
    } catch (e) { /* ignore */ }
  }, [seedDMs, seedGroups]);

  useEffect(() => {
    if (!user) {
      setUnreadDMs(new Set());
      setUnreadGroups(new Set());
      setMeetingAlerts(new Set());
      return;
    }
    seed();

    const socket = getSocket();
    if (!socket) return;

    const onNewMessage = ({ message }) => {
      // Not unread if you're already looking at that conversation (the chat marks
      // it read itself, but its listener can run before this one after a reload).
      if (window.location.pathname === `/chat/${message.senderId}`) return;
      if (message.senderId !== user.id) {
        setUnreadDMs((prev) => new Set(prev).add(message.senderId));
      }
    };
    const onNewGroupMessage = ({ message }) => {
      if (window.location.pathname === `/groups/${message.groupId}`) return;
      if (message.senderId !== user.id) {
        setUnreadGroups((prev) => new Set(prev).add(message.groupId));
      }
    };
    const onMeetingAlert = ({ meeting }) => {
      setMeetingAlerts((prev) => new Set(prev).add(meeting.id));
    };
    // Chat / group cleared from another window or device: it is no longer "new" here either.
    const onConversationCleared = ({ otherUserId }) => markDMRead(otherUserId);
    const onGroupCleared = ({ groupId }) => markGroupRead(groupId);
    // A message was deleted by its sender: recompute what is really still unread, and if
    // nothing is left, stop the taskbar blink / badge that the deleted message started.
    const afterDelete = async () => {
      const dms = await seedDMs();
      const groups = await seedGroups();
      const c = countsRef.current;
      if (dms === 0 && groups === 0 && c.meetings === 0) clearFlash();
    };
    const onReconnect = () => seed();

    socket.on('new-message', onNewMessage);
    socket.on('new-group-message', onNewGroupMessage);
    socket.on('meeting-invite', onMeetingAlert);
    socket.on('meeting-starting', onMeetingAlert);
    socket.on('messages-deleted', afterDelete);
    socket.on('group-messages-deleted', afterDelete);
    socket.on('conversation-cleared', onConversationCleared);
    socket.on('group-cleared', onGroupCleared);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('new-group-message', onNewGroupMessage);
      socket.off('meeting-invite', onMeetingAlert);
      socket.off('meeting-starting', onMeetingAlert);
      socket.off('messages-deleted', afterDelete);
      socket.off('group-messages-deleted', afterDelete);
      socket.off('conversation-cleared', onConversationCleared);
      socket.off('group-cleared', onGroupCleared);
      socket.off('connect', onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function markDMRead(otherUserId) {
    setUnreadDMs((prev) => {
      if (!prev.has(otherUserId)) return prev;
      const next = new Set(prev);
      next.delete(otherUserId);
      return next;
    });
  }
  function markGroupRead(groupId) {
    setUnreadGroups((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }
  function clearMeetingAlerts() {
    setMeetingAlerts(new Set());
  }

  return (
    <NotificationCenterContext.Provider
      value={{
        unreadDMCount: unreadDMs.size,
        unreadGroupCount: unreadGroups.size,
        meetingAlertCount: meetingAlerts.size,
        isDMUnread: (id) => unreadDMs.has(id),
        isGroupUnread: (id) => unreadGroups.has(id),
        markDMRead,
        markGroupRead,
        clearMeetingAlerts,
      }}
    >
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter() {
  return useContext(NotificationCenterContext);
}
