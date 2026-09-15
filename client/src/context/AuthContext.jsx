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
      connectSocket(tok);
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

  async function login(email, password) {
    const { data } = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('zteam_token', data.token);
    setToken(data.token);
    setUser(data.user);
    connectSocket(data.token);
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
