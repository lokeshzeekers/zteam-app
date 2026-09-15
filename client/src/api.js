import axios from 'axios';

// In dev, Vite proxies /api to the local backend (see vite.config.js).
// In production build, set VITE_API_URL to your server URL, e.g. https://zteam.yourdomain.com
export const API_BASE = import.meta.env.VITE_API_URL || '';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('zteam_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
