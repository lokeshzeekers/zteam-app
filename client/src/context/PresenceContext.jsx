import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getSocket } from '../socket';

const PresenceContext = createContext({ presence: {}, isUserActive: () => false });

// Tracks live active/inactive status for every user in one place, fed by the
// socket's 'presence-update' events. Any page can call isUserActive(id) and
// get the current value immediately, without needing to refetch or re-mount —
// this is what makes the green dot update in realtime across every screen at
// once, instead of only the sidebar.
export function PresenceProvider({ children }) {
  const { user } = useAuth();
  const [presence, setPresence] = useState({}); // userId -> boolean

  useEffect(() => {
    if (!user) {
      setPresence({});
      return;
    }
    // Seed with our own current status immediately so our own toggle reflects
    // everywhere without waiting on a round-trip.
    setPresence((p) => ({ ...p, [user.id]: user.isActive }));

    const socket = getSocket();
    if (!socket) return;

    const onPresence = ({ userId, isActive }) => {
      setPresence((p) => ({ ...p, [userId]: isActive }));
    };
    socket.on('presence-update', onPresence);
    return () => socket.off('presence-update', onPresence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Keep our own entry in sync if it changes via the sidebar toggle (optimistic update)
  useEffect(() => {
    if (user) setPresence((p) => ({ ...p, [user.id]: user.isActive }));
  }, [user?.isActive, user?.id]);

  // Given a user object/row that came from a REST fetch (which has its own
  // isActive snapshot from the DB at load time), prefer the live value if
  // we've received one, otherwise fall back to the fetched snapshot.
  function isUserActive(userId, fallback = false) {
    return presence[userId] !== undefined ? presence[userId] : fallback;
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
