const jwt = require('jsonwebtoken');
const { User, Message, CallLog, GroupMessage, Meeting, MeetingParticipant } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isMember: isGroupMember } = require('../controllers/groupController');
const { addSocket, removeSocket, isOnline } = require('../utils/presence');

// Track who's currently inside which meeting room, for the mesh signaling relay.
const meetingRooms = new Map(); // meetingId -> Set(userId)

// ---- 1:1 call state (server is the source of truth, so a call that was
// cancelled / answered elsewhere / timed out can never be "accepted" later) ----
const CALL_RING_MS = (Number(process.env.CALL_RING_SECONDS) || 45) * 1000;
const pendingCalls = new Map(); // `${callerId}>${calleeId}` -> { callerId, calleeId, callType, callerSocketId, timer }
const activeCalls = new Map(); // userId -> { withId, mySocketId, peerSocketId }

function takePending(key) {
  const p = pendingCalls.get(key);
  if (p) { clearTimeout(p.timer); pendingCalls.delete(key); }
  return p;
}
function clearActive(userId) {
  const c = activeCalls.get(userId);
  if (!c) return null;
  activeCalls.delete(userId);
  if (activeCalls.get(c.withId)?.withId === userId) activeCalls.delete(c.withId);
  return c;
}

// Used by the meeting controller / scheduler.
function isMeetingRoomEmpty(meetingId) {
  const members = meetingRooms.get(Number(meetingId));
  return !members || members.size === 0;
}
function clearMeetingRoom(meetingId) {
  meetingRooms.delete(Number(meetingId));
}

// Tell every other invitee that a meeting just went live.
async function notifyMeetingStarting(io, meeting, starter) {
  const invited = await MeetingParticipant.findAll({ where: { meetingId: meeting.id } });
  invited.filter((p) => p.userId !== starter.id).forEach((p) => {
    io.to(`user:${p.userId}`).emit('meeting-starting', {
      meeting: {
        id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt,
        callType: meeting.callType, status: meeting.status, createdBy: meeting.createdBy,
      },
      from: { id: starter.id, name: starter.name },
    });
  });
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
    const openConnections = addSocket(user.id, socket.id);
    // First connection for this user and they had pressed "Go Active" earlier:
    // they are visibly active again for everyone.
    if (openConnections === 1 && user.isActive) {
      io.emit('presence-update', { userId: user.id, isActive: true });
    }

    // Snapshot of who is active right now. Clients ask for it on every (re)connect,
    // so an update missed while offline / asleep can never leave a stale status.
    socket.on('get-presence', async (payload, ack) => {
      try {
        const rows = await User.findAll({ where: { isActive: true }, attributes: ['id'] });
        ack?.({ activeUserIds: rows.map((r) => r.id).filter((id) => isOnline(id)) });
      } catch (err) {
        ack?.({ activeUserIds: [] });
      }
    });

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
    socket.on('call-request', async ({ calleeId, callType } = {}) => {
      calleeId = Number(calleeId);
      const callee = await User.findByPk(calleeId);
      if (!callee) return;
      const allowed = await canCommunicate(user, callee);
      if (!allowed) return;
      if (!isOnline(calleeId)) {
        socket.emit('call-unavailable', { calleeId, reason: 'offline' });
        return;
      }
      if (activeCalls.has(calleeId) || activeCalls.has(user.id)) {
        socket.emit('call-unavailable', { calleeId, reason: 'busy' });
        return;
      }

      const key = `${user.id}>${calleeId}`;
      takePending(key); // re-dialling replaces any earlier ring
      const timer = setTimeout(() => {
        const p = takePending(key);
        if (!p) return;
        // Nobody picked up: stop ringing on every device of the callee, tell the caller.
        io.to(`user:${calleeId}`).emit('call-ended', { by: user.id, reason: 'missed' });
        io.to(p.callerSocketId).emit('call-ended', { by: calleeId, reason: 'no-answer' });
      }, CALL_RING_MS);
      pendingCalls.set(key, { callerId: user.id, calleeId, callType: callType || 'audio', callerSocketId: socket.id, timer });

      io.to(`user:${calleeId}`).emit('incoming-call', {
        callerId: user.id, callerName: user.name, callType: callType || 'audio',
      });
    });

    socket.on('call-accept', ({ callerId } = {}) => {
      callerId = Number(callerId);
      const p = takePending(`${callerId}>${user.id}`);
      // Call was cancelled, timed out or already answered on another device.
      if (!p || activeCalls.has(user.id) || activeCalls.has(callerId)) {
        socket.emit('call-ended', { by: callerId, reason: 'gone' });
        return;
      }
      // Bind the call to these two exact sockets so media signalling never
      // reaches the callee's other tabs / apps.
      activeCalls.set(user.id, { withId: callerId, mySocketId: socket.id, peerSocketId: p.callerSocketId });
      activeCalls.set(callerId, { withId: user.id, mySocketId: p.callerSocketId, peerSocketId: socket.id });
      io.to(p.callerSocketId).emit('call-accepted', { by: user.id });
      // Stop ringing on the callee's other devices.
      socket.to(`user:${user.id}`).emit('call-ended', { by: callerId, reason: 'answered-elsewhere' });
      // Anyone else who was ringing this user gets a busy signal.
      for (const other of [...pendingCalls.values()].filter((x) => x.calleeId === user.id)) {
        takePending(`${other.callerId}>${other.calleeId}`);
        io.to(other.callerSocketId).emit('call-unavailable', { calleeId: user.id, reason: 'busy' });
      }
    });

    socket.on('call-reject', ({ callerId } = {}) => {
      callerId = Number(callerId);
      const p = takePending(`${callerId}>${user.id}`);
      if (!p) return;
      io.to(p.callerSocketId).emit('call-rejected', { by: user.id });
      socket.to(`user:${user.id}`).emit('call-ended', { by: callerId, reason: 'declined-elsewhere' });
    });

    socket.on('call-end', ({ otherUserId } = {}) => {
      otherUserId = Number(otherUserId);
      // Caller hanging up while it is still ringing -> stop it everywhere.
      const ringing = takePending(`${user.id}>${otherUserId}`);
      if (ringing) {
        io.to(`user:${otherUserId}`).emit('call-ended', { by: user.id, reason: 'cancelled' });
        return;
      }
      const c = activeCalls.get(user.id);
      if (c && c.withId === otherUserId) {
        clearActive(user.id);
        io.to(c.peerSocketId).emit('call-ended', { by: user.id, reason: 'hangup' });
      }
    });

    // Media signalling only flows between the two sockets that are in the call.
    function relayCall(to, event, data) {
      const c = activeCalls.get(user.id);
      if (!c || c.withId !== Number(to) || c.mySocketId !== socket.id) return;
      io.to(c.peerSocketId).emit(event, { from: user.id, ...data });
    }
    socket.on('webrtc-offer', ({ to, offer } = {}) => relayCall(to, 'webrtc-offer', { offer }));
    socket.on('webrtc-answer', ({ to, answer } = {}) => relayCall(to, 'webrtc-answer', { answer }));
    socket.on('webrtc-ice-candidate', ({ to, candidate } = {}) => relayCall(to, 'webrtc-ice-candidate', { candidate }));

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
    socket.on('meeting-join', async ({ meetingId } = {}, ack) => {
      try {
        meetingId = Number(meetingId);
        const meeting = await Meeting.findByPk(meetingId);
        if (!meeting) return ack?.({ error: 'Meeting not found' });
        if (meeting.status === 'cancelled' || meeting.status === 'ended') {
          return ack?.({ error: `This meeting has ${meeting.status}` });
        }
        const participant = await MeetingParticipant.findOne({ where: { meetingId, userId: user.id } });
        if (!participant) return ack?.({ error: 'You are not invited to this meeting' });

        // Only the organizer can open a meeting that has not started yet;
        // everybody else waits until it is ongoing.
        if (meeting.status === 'scheduled') {
          if (meeting.createdBy !== user.id) {
            return ack?.({ error: 'The host has not started this meeting yet. Please try again in a moment.' });
          }
          meeting.status = 'ongoing';
          meeting.startedAt = meeting.startedAt || new Date();
          await meeting.save();
          await notifyMeetingStarting(io, meeting, user);
        }

        participant.status = 'joined';
        await participant.save();

        const room = `meeting:${meetingId}`;
        // Never hand back ourselves (happens when a tab is refreshed / the
        // socket reconnects before the old one is cleaned up).
        const existing = [...(meetingRooms.get(meetingId) || [])].filter((id) => id !== user.id);
        if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Set());
        meetingRooms.get(meetingId).add(user.id);
        socket.join(room);

        socket.to(room).emit('meeting-peer-joined', { userId: user.id, name: user.name });
        ack?.({ ok: true, existingPeers: existing, callType: meeting.callType, title: meeting.title });
      } catch (err) {
        console.error('meeting-join failed:', err.message);
        ack?.({ error: 'Failed to join meeting' });
      }
    });

    socket.on('meeting-leave', ({ meetingId } = {}) => {
      meetingId = Number(meetingId);
      meetingRooms.get(meetingId)?.delete(user.id);
      socket.leave(`meeting:${meetingId}`);
      socket.to(`meeting:${meetingId}`).emit('meeting-peer-left', { userId: user.id });
    });

    socket.on('meeting-mute-update', ({ meetingId, audioMuted, videoMuted } = {}) => {
      socket.to(`meeting:${Number(meetingId)}`).emit('meeting-mute-update', { userId: user.id, audioMuted, videoMuted });
    });

    // WebRTC signaling relay - only between two people who are both inside the
    // same meeting room, so a random user can't inject signaling into a call.
    function inSameMeeting(meetingId, otherId) {
      const members = meetingRooms.get(Number(meetingId));
      return !!members && members.has(user.id) && members.has(Number(otherId));
    }
    socket.on('meeting-webrtc-offer', ({ meetingId, to, offer }) => {
      if (!inSameMeeting(meetingId, to)) return;
      io.to(`user:${to}`).emit('meeting-webrtc-offer', { meetingId: Number(meetingId), from: user.id, offer });
    });
    socket.on('meeting-webrtc-answer', ({ meetingId, to, answer }) => {
      if (!inSameMeeting(meetingId, to)) return;
      io.to(`user:${to}`).emit('meeting-webrtc-answer', { meetingId: Number(meetingId), from: user.id, answer });
    });
    socket.on('meeting-webrtc-ice-candidate', ({ meetingId, to, candidate }) => {
      if (!inSameMeeting(meetingId, to)) return;
      io.to(`user:${to}`).emit('meeting-webrtc-ice-candidate', { meetingId: Number(meetingId), from: user.id, candidate });
    });

    // ---- Disconnect ----
    socket.on('disconnect', async () => {
      removeSocket(user.id, socket.id);

      // Calls this socket was part of must not be left ringing / half-open.
      for (const [key, p] of [...pendingCalls.entries()]) {
        if (p.callerSocketId === socket.id) {
          takePending(key);
          io.to(`user:${p.calleeId}`).emit('call-ended', { by: user.id, reason: 'cancelled' });
        }
      }
      const liveCall = activeCalls.get(user.id);
      if (liveCall && liveCall.mySocketId === socket.id) {
        clearActive(user.id);
        io.to(liveCall.peerSocketId).emit('call-ended', { by: user.id, reason: 'disconnected' });
      }
      if (!isOnline(user.id)) {
        // Their last device is gone: calls still ringing for them can't be answered.
        for (const [key, p] of [...pendingCalls.entries()]) {
          if (p.calleeId === user.id) {
            takePending(key);
            io.to(p.callerSocketId).emit('call-unavailable', { calleeId: user.id, reason: 'offline' });
          }
        }
        // ...and everyone stops seeing them as active.
        io.emit('presence-update', { userId: user.id, isActive: false });
      }
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

module.exports = { initSockets, isOnline, isMeetingRoomEmpty, clearMeetingRoom };
