import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { getSocket } from '../socket';

const PresenceContext = createContext({ presence: {}, isUserActive: () => false });

// Live active/inactive status for every user, in one place.
//
// The server is the source of truth. We ask it for a full snapshot every time
// the socket connects (first load AND every reconnect after a network drop or a
// sleeping laptop), then keep it fresh from 'presence-update' events. That means
// a missed event can never leave somebody stuck as active/inactive on your screen.
export function PresenceProvider({ children }) {
  const { user, updateUser, logout } = useAuth();
  const [presence, setPresence] = useState({}); // userId -> boolean
  const [ready, setReady] = useState(false); // have we received a snapshot yet?
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!user) {
      setPresence({});
      setReady(false);
      return undefined;
    }
    setPresence((p) => ({ ...p, [user.id]: user.isActive }));

    const socket = getSocket();
    if (!socket) return undefined;

    const loadSnapshot = () => {
      socket.emit('get-presence', {}, (res) => {
        const next = {};
        (res?.activeUserIds || []).forEach((id) => { next[id] = true; });
        next[userRef.current.id] = !!userRef.current.isActive;
        setPresence(next);
        setReady(true);
      });
    };

    const onPresence = ({ userId, isActive }) => {
      setPresence((p) => ({ ...p, [userId]: isActive }));
      // Same account open elsewhere (e.g. desktop app + browser): keep this
      // window's own "Go Active" button in step.
      const me = userRef.current;
      if (me && userId === me.id && me.isActive !== isActive) updateUser({ isActive });
    };

    const onRemoved = ({ userId }) => {
      setPresence((p) => { const next = { ...p }; delete next[userId]; return next; });
      if (userRef.current && userId === userRef.current.id) {
        alert('Your account has been removed by an administrator.');
        logout();
      }
    };

    socket.on('presence-update', onPresence);
    socket.on('user-removed', onRemoved);
    socket.on('connect', loadSnapshot);
    if (socket.connected) loadSnapshot();

    return () => {
      socket.off('presence-update', onPresence);
      socket.off('user-removed', onRemoved);
      socket.off('connect', loadSnapshot);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Keep our own entry in sync if it changes via the sidebar toggle (optimistic update)
  useEffect(() => {
    if (user) setPresence((p) => ({ ...p, [user.id]: user.isActive }));
  }, [user?.isActive, user?.id]);

  // Once we've had a snapshot, anybody not in it is offline. Until then, fall
  // back to whatever the page's own REST fetch said.
  function isUserActive(userId, fallback = false) {
    if (presence[userId] !== undefined) return presence[userId];
    return ready ? false : fallback;
  }

  return (
    <PresenceContext.Provider value={{ presence, isUserActive }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  return useContext(PresenceContext);
}
