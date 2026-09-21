import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getSocket } from '../socket';
import api from '../api';

const NotificationCenterContext = createContext(null);

// Tracks "you have something new to look at" per sidebar section:
//  - Inbox: direct-message threads with an unread incoming message
//  - Groups: groups with a new message since you last opened them
//  - Meetings: meetings that are live right now, or invites/starts you
//    haven't seen yet
// Seeded from the server on login so a refresh doesn't lose real unread
// state (for DMs, which the server tracks via readAt), then kept live via
// socket events. Group "unread" has no server-side read-receipt yet, so it
// only tracks activity that happens during the current session — opening a
// group clears it either way.
export function NotificationCenterProvider({ children }) {
  const { user } = useAuth();
  const [unreadDMs, setUnreadDMs] = useState(new Set());
  const [unreadGroups, setUnreadGroups] = useState(new Set());
  const [meetingAlerts, setMeetingAlerts] = useState(new Set());

  const seed = useCallback(async () => {
    try {
      const { data } = await api.get('/api/messages/inbox');
      const unread = data.threads
        .filter((t) => t.user && t.lastMessage.senderId === t.user.id && !t.lastMessage.readAt)
        .map((t) => t.user.id);
      setUnreadDMs(new Set(unread));
    } catch (e) { /* not fatal, badges just start empty */ }
    try {
      const { data } = await api.get('/api/meetings');
      const ongoing = data.meetings.filter((m) => m.status === 'ongoing').map((m) => m.id);
      setMeetingAlerts(new Set(ongoing));
    } catch (e) { /* ignore */ }
  }, []);

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
    const onReconnect = () => seed();

    socket.on('new-message', onNewMessage);
    socket.on('new-group-message', onNewGroupMessage);
    socket.on('meeting-invite', onMeetingAlert);
    socket.on('meeting-starting', onMeetingAlert);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('new-group-message', onNewGroupMessage);
      socket.off('meeting-invite', onMeetingAlert);
      socket.off('meeting-starting', onMeetingAlert);
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
