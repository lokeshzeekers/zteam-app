const jwt = require('jsonwebtoken');
const { User, Message, CallLog, GroupMessage, Meeting, MeetingParticipant } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isMember: isGroupMember } = require('../controllers/groupController');

// Track which socket ids belong to which user (a user can have multiple tabs/devices)
const userSockets = new Map(); // userId -> Set(socketId)
// Track who's currently inside which meeting room, for the mesh signaling relay.
const meetingRooms = new Map(); // meetingId -> Set(userId)

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
    socket.on('go-active', async (payload, ack) => {
      try {
        user.isActive = true;
        user.lastActiveAt = new Date();
        await User.update({ isActive: true, lastActiveAt: new Date() }, { where: { id: user.id } });
        io.emit('presence-update', { userId: user.id, isActive: true });
        ack?.({ ok: true, isActive: true });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to go active' });
      }
    });

    socket.on('go-inactive', async (payload, ack) => {
      try {
        user.isActive = false;
        await User.update({ isActive: false }, { where: { id: user.id } });
        io.emit('presence-update', { userId: user.id, isActive: false });
        ack?.({ ok: true, isActive: false });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to go inactive' });
      }
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

    // ---- Group text chat ----
    socket.on('send-group-message', async (payload, ack) => {
      try {
        const { groupId, content, type = 'text', fileUrl, fileName } = payload;
        if (!(await isGroupMember(groupId, user.id))) return ack?.({ error: 'Not a member of this group' });

        const message = await GroupMessage.create({
          groupId, senderId: user.id, type, content: content || null, fileUrl: fileUrl || null, fileName: fileName || null,
        });
        io.to(`group:${groupId}`).emit('new-group-message', { message });
        ack?.({ message });
      } catch (err) {
        ack?.({ error: 'Failed to send message' });
      }
    });

    // Join/leave the group's socket room so we actually receive its broadcasts.
    // Membership is re-checked here too (not just on the REST endpoints).
    socket.on('join-group-room', async ({ groupId }, ack) => {
      if (!(await isGroupMember(groupId, user.id))) return ack?.({ error: 'Not a member of this group' });
      socket.join(`group:${groupId}`);
      ack?.({ ok: true });
    });
    socket.on('leave-group-room', ({ groupId }) => {
      socket.leave(`group:${groupId}`);
    });

    // ---- Group meetings (mesh WebRTC: every participant connects to every other) ----
    socket.on('meeting-join', async ({ meetingId }, ack) => {
      try {
        const meeting = await Meeting.findByPk(meetingId);
        if (!meeting) return ack?.({ error: 'Meeting not found' });
        if (meeting.status === 'cancelled' || meeting.status === 'ended') {
          return ack?.({ error: `This meeting has ${meeting.status}` });
        }
        const participant = await MeetingParticipant.findOne({ where: { meetingId, userId: user.id } });
        if (!participant) return ack?.({ error: 'You are not invited to this meeting' });

        participant.status = 'joined';
        await participant.save();
        if (meeting.status === 'scheduled') {
          meeting.status = 'ongoing';
          meeting.startedAt = meeting.startedAt || new Date();
          await meeting.save();
        }

        const room = `meeting:${meetingId}`;
        const existing = [...(meetingRooms.get(meetingId) || [])];
        if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Set());
        meetingRooms.get(meetingId).add(user.id);
        socket.join(room);

        socket.to(room).emit('meeting-peer-joined', { userId: user.id, name: user.name });
        ack?.({ ok: true, existingPeers: existing, callType: meeting.callType, title: meeting.title });
      } catch (err) {
        ack?.({ error: 'Failed to join meeting' });
      }
    });

    socket.on('meeting-leave', ({ meetingId }) => {
      meetingRooms.get(meetingId)?.delete(user.id);
      socket.leave(`meeting:${meetingId}`);
      socket.to(`meeting:${meetingId}`).emit('meeting-peer-left', { userId: user.id });
    });

    socket.on('meeting-mute-update', ({ meetingId, audioMuted, videoMuted }) => {
      socket.to(`meeting:${meetingId}`).emit('meeting-mute-update', { userId: user.id, audioMuted, videoMuted });
    });

    socket.on('meeting-webrtc-offer', ({ meetingId, to, offer }) => {
      io.to(`user:${to}`).emit('meeting-webrtc-offer', { meetingId, from: user.id, offer });
    });
    socket.on('meeting-webrtc-answer', ({ meetingId, to, answer }) => {
      io.to(`user:${to}`).emit('meeting-webrtc-answer', { meetingId, from: user.id, answer });
    });
    socket.on('meeting-webrtc-ice-candidate', ({ meetingId, to, candidate }) => {
      io.to(`user:${to}`).emit('meeting-webrtc-ice-candidate', { meetingId, from: user.id, candidate });
    });

    // ---- Disconnect ----
    socket.on('disconnect', async () => {
      removeSocket(user.id, socket.id);
      // NOTE: we intentionally do NOT flip isActive to false here anymore.
      // isActive is a user-controlled status (the "Go Active" button), not a
      // connection state — a page reload or brief network drop used to wipe it
      // out because this handler force-set it false on every disconnect.
      // It now only changes via explicit 'go-inactive' or on sign-out (the
      // client already emits 'go-inactive' before disconnecting on logout).

      // Clean up any meeting rooms this socket was in (only if this was
      // their last open tab/connection — a user with two tabs shouldn't be
      // dropped from a call because they closed one of them).
      if (!isOnline(user.id)) {
        for (const [meetingId, members] of meetingRooms.entries()) {
          if (members.has(user.id)) {
            members.delete(user.id);
            socket.to(`meeting:${meetingId}`).emit('meeting-peer-left', { userId: user.id });
          }
        }
      }
    });
  });
}

module.exports = { initSockets, isOnline };
