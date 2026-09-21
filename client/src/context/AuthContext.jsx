import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import api from '../api';
import { connectSocket, disconnectSocket, getSocket } from '../socket';

const AuthContext = createContext(null);

// The ONE place that tells the server "I'm going inactive" and waits for its
// acknowledgement. Used by the Electron quit handshake (window.__zteamGoInactive)
// and by web Sign Out, so both go through the same code path.
// waitForConnect: Sign Out clicked right after opening the app, while the socket is
// still connecting - give it a moment so go-inactive is really delivered (it is sent
// after the queued go-active, so the final state is inactive).
function sendGoInactive({ waitForConnect = false } = {}) {
  return new Promise((resolve) => {
    const socket = getSocket();
    if (!socket) { resolve(false); return; }
    const emit = () => {
      const timer = setTimeout(() => resolve(false), 1200);
      socket.emit('go-inactive', {}, () => { clearTimeout(timer); resolve(true); });
    };
    if (socket.connected) { emit(); return; }
    if (!waitForConnect || !socket.active) { resolve(false); return; } // not connecting: nothing to tell
    const wait = setTimeout(() => { socket.off('connect', onConnect); resolve(false); }, 1500);
    function onConnect() { clearTimeout(wait); emit(); }
    socket.once('connect', onConnect);
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('zteam_token'));
  const [loading, setLoading] = useState(true);
  const loggingOut = useRef(false);

  const bootstrap = useCallback(async (tok) => {
    try {
      const { data } = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } });
      setUser(data.user);
      const socket = connectSocket(tok);
      // The app being open at all means "active" — socket.io queues emits
      // until the connection is actually established, so this doesn't need
      // to wait for a 'connect' event first. Only fires here (app launch /
      // reload), never on a background reconnect, so it can't clobber a
      // manual "Go Inactive" click made later in the same session.
      socket.emit('go-active', {}, (ack) => {
        if (ack?.ok) setUser((u) => (u ? { ...u, isActive: true } : u));
      });
    } catch (err) {
      localStorage.removeItem('zteam_token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) bootstrap(token);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Fires when the page is actually being torn down — which, in the
    // Electron app, only happens on a real quit (app.quit()). Minimizing to
    // the tray just calls mainWindow.hide(), which leaves the page loaded
    // and running in the background, so this deliberately does NOT fire
    // then — exactly the "active while pinned, only inactive on real close"
    // behavior asked for. A plain browser tab close behaves the same way.
    function handleBeforeUnload() {
      getSocket()?.emit('go-inactive');
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    // Called by the Electron main process right before a REAL quit (tray "Quit",
    // updater restart, ...). Unlike 'beforeunload' it is awaited: the app only
    // exits once the server has acknowledged go-inactive, so the exit can't race
    // the network send. Resolves false (quit carries on) when nothing to tell.
    window.__zteamGoInactive = () => sendGoInactive();
    return () => { delete window.__zteamGoInactive; };
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('zteam_token', data.token);
    setToken(data.token);
    setUser(data.user);
    const socket = connectSocket(data.token);
    socket.emit('go-active', {}, (ack) => {
      if (ack?.ok) setUser((u) => (u ? { ...u, isActive: true } : u));
    });
    return data.user;
  }

  // Sign Out: the presence update must reach the server BEFORE the session and
  // socket are torn down (previously go-inactive was fired and the socket closed in
  // the same instant, so it could be lost). Guarded against double clicks.
  async function logout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      await sendGoInactive({ waitForConnect: true });
    } finally {
      disconnectSocket();
      localStorage.removeItem('zteam_token');
      setToken(null);
      setUser(null);
      loggingOut.current = false;
    }
  }

  function updateUser(patch) {
    setUser((u) => ({ ...u, ...patch }));
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
