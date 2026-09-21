import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api';
import { connectSocket, disconnectSocket, getSocket } from '../socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('zteam_token'));
  const [loading, setLoading] = useState(true);

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

  function logout() {
    const socket = getSocket();
    socket?.emit('go-inactive');
    disconnectSocket();
    localStorage.removeItem('zteam_token');
    setToken(null);
    setUser(null);
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
