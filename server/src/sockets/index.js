const jwt = require('jsonwebtoken');
const { User, Message, CallLog } = require('../models');
const { canCommunicate } = require('../utils/permissions');

// Track which socket ids belong to which user (a user can have multiple tabs/devices)
const userSockets = new Map(); // userId -> Set(socketId)

function addSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}
function removeSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(userId);
}
function isOnline(userId) {
  return userSockets.has(userId);
}

function initSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(payload.id);
      if (!user) return next(new Error('Invalid user'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    addSocket(user.id, socket.id);

    // ---- Presence: user must explicitly go active ----
    socket.on('go-active', async () => {
      user.isActive = true;
      user.lastActiveAt = new Date();
      await User.update({ isActive: true, lastActiveAt: new Date() }, { where: { id: user.id } });
      io.emit('presence-update', { userId: user.id, isActive: true });
    });

    socket.on('go-inactive', async () => {
      user.isActive = false;
      await User.update({ isActive: false }, { where: { id: user.id } });
      io.emit('presence-update', { userId: user.id, isActive: false });
    });

    // ---- Messaging ----
    socket.on('send-message', async (payload, ack) => {
      try {
        const { receiverId, content, type = 'text', fileUrl, fileName } = payload;
        const receiver = await User.findByPk(receiverId);
        if (!receiver) return ack?.({ error: 'Recipient not found' });

        const allowed = await canCommunicate(user, receiver);
        if (!allowed) return ack?.({ error: 'Not connected with this user' });

        const message = await Message.create({
          senderId: user.id, receiverId, type, content: content || null, fileUrl: fileUrl || null, fileName: fileName || null,
        });

        io.to(`user:${receiverId}`).emit('new-message', { message });
        io.to(`user:${user.id}`).emit('message-sent', { message });
        ack?.({ message });
      } catch (err) {
        ack?.({ error: 'Failed to send message' });
      }
    });

    socket.on('typing', ({ receiverId }) => {
      io.to(`user:${receiverId}`).emit('typing', { userId: user.id });
    });

    // ---- Calls (WebRTC signaling relay) ----
    socket.on('call-request', async ({ calleeId, callType }) => {
      const callee = await User.findByPk(calleeId);
      if (!callee) return;
      const allowed = await canCommunicate(user, callee);
      if (!allowed) return;
      if (!isOnline(calleeId)) {
        io.to(`user:${user.id}`).emit('call-unavailable', { calleeId, reason: 'offline' });
        return;
      }
      io.to(`user:${calleeId}`).emit('incoming-call', {
        callerId: user.id, callerName: user.name, callType: callType || 'audio',
      });
    });

    socket.on('call-accept', ({ callerId }) => {
      io.to(`user:${callerId}`).emit('call-accepted', { by: user.id });
    });

    socket.on('call-reject', ({ callerId }) => {
      io.to(`user:${callerId}`).emit('call-rejected', { by: user.id });
    });

    socket.on('call-end', ({ otherUserId }) => {
      io.to(`user:${otherUserId}`).emit('call-ended', { by: user.id });
    });

    socket.on('webrtc-offer', ({ to, offer }) => {
      io.to(`user:${to}`).emit('webrtc-offer', { from: user.id, offer });
    });
    socket.on('webrtc-answer', ({ to, answer }) => {
      io.to(`user:${to}`).emit('webrtc-answer', { from: user.id, answer });
    });
    socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
      io.to(`user:${to}`).emit('webrtc-ice-candidate', { from: user.id, candidate });
    });

    // ---- Disconnect ----
    socket.on('disconnect', async () => {
      removeSocket(user.id, socket.id);
      if (!isOnline(user.id)) {
        await User.update({ isActive: false }, { where: { id: user.id } });
        io.emit('presence-update', { userId: user.id, isActive: false });
      }
    });
  });
}

module.exports = { initSockets, isOnline };
