import { io } from 'socket.io-client';
import { API_BASE } from './api';

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(API_BASE || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
