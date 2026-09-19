const crypto = require('crypto');
const { Op } = require('sequelize');
const { Meeting, MeetingParticipant, GroupMember, User } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { clearMeetingRoom } = require('../sockets');

function makeRoomKey() {
  return crypto.randomBytes(12).toString('hex');
}

async function resolveParticipantIds(req, { groupId, participantIds = [] }) {
  const ids = new Set(participantIds.map(Number));
  if (groupId) {
    const members = await GroupMember.findAll({ where: { groupId } });
    members.forEach((m) => ids.add(m.userId));
  }
  ids.add(req.user.id); // creator is always a participant
  return [...ids];
}

// Schedule (or instantly start) a meeting. Every non-self participant must be
// someone the creator can already communicate with (same dept / accepted
// connection), OR a fellow member of the given group.
async function createMeeting(req, res) {
  const { title, description, callType, scheduledAt, durationMinutes, groupId, participantIds, startNow } = req.body;
  if (!title) return res.status(400).json({ error: 'Meeting title is required' });

  const allIds = await resolveParticipantIds(req, { groupId, participantIds });
  const others = await User.findAll({ where: { id: allIds.filter((id) => id !== req.user.id) } });

  if (!groupId) {
    for (const u of others) {
      const allowed = await canCommunicate(req.user, u);
      if (!allowed) return res.status(403).json({ error: `You are not connected with ${u.name}` });
    }
  }

  const when = startNow ? new Date() : new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduled date/time' });

  const meeting = await Meeting.create({
    title, description, callType: callType === 'audio' ? 'audio' : 'video',
    createdBy: req.user.id, groupId: groupId || null,
    scheduledAt: when, durationMinutes: durationMinutes || 30,
    status: startNow ? 'ongoing' : 'scheduled',
    startedAt: startNow ? new Date() : null,
    roomKey: makeRoomKey(),
  });

  await MeetingParticipant.create({ meetingId: meeting.id, userId: req.user.id, status: 'joined' });
  for (const u of others) {
    await MeetingParticipant.create({ meetingId: meeting.id, userId: u.id, status: 'invited' });
  }

  const io = req.app.get('io');
  const payload = {
    meeting: {
      id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt,
      callType: meeting.callType, status: meeting.status, createdBy: req.user.id,
    },
    from: { id: req.user.id, name: req.user.name },
  };
  others.forEach((u) => {
    io.to(`user:${u.id}`).emit(startNow ? 'meeting-starting' : 'meeting-invite', payload);
  });

  res.status(201).json({ meeting });
}

async function listMyMeetings(req, res) {
  const rows = await MeetingParticipant.findAll({ where: { userId: req.user.id } });
  const meetingIds = rows.map((r) => r.meetingId);
  const meetings = await Meeting.findAll({
    where: { id: meetingIds },
    order: [['scheduledAt', 'ASC']],
  });

  const result = [];
  for (const m of meetings) {
    const participants = await MeetingParticipant.findAll({ where: { meetingId: m.id } });
    const users = await User.findAll({ where: { id: participants.map((p) => p.userId) } });
    result.push({
      id: m.id, title: m.title, description: m.description, callType: m.callType,
      createdBy: m.createdBy, scheduledAt: m.scheduledAt, durationMinutes: m.durationMinutes,
      status: m.status, roomKey: m.roomKey,
      isOwner: m.createdBy === req.user.id,
      hostName: users.find((u) => u.id === m.createdBy)?.name || 'Host',
      participants: users.map((u) => ({ id: u.id, name: u.name, position: u.position })),
    });
  }
  res.json({ meetings: result });
}

async function updateMeeting(req, res) {
  const meeting = await Meeting.findByPk(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organizer can edit this meeting' });
  }
  const { title, description, scheduledAt, durationMinutes, callType, addParticipantIds = [] } = req.body;
  if (title) meeting.title = title;
  if (description !== undefined) meeting.description = description;
  if (scheduledAt) meeting.scheduledAt = new Date(scheduledAt);
  if (durationMinutes) meeting.durationMinutes = durationMinutes;
  if (callType) meeting.callType = callType === 'audio' ? 'audio' : 'video';
  await meeting.save();

  const io = req.app.get('io');
  for (const id of addParticipantIds.map(Number)) {
    const target = await User.findByPk(id);
    if (!target) continue;
    const exists = await MeetingParticipant.findOne({ where: { meetingId: meeting.id, userId: id } });
    if (!exists) {
      await MeetingParticipant.create({ meetingId: meeting.id, userId: id, status: 'invited' });
      io.to(`user:${id}`).emit('meeting-invite', {
        meeting: { id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt, callType: meeting.callType, status: meeting.status, createdBy: meeting.createdBy },
        from: { id: req.user.id, name: req.user.name },
      });
    }
  }

  const participants = await MeetingParticipant.findAll({ where: { meetingId: meeting.id } });
  participants.forEach((p) => io.to(`user:${p.userId}`).emit('meeting-updated', { meetingId: meeting.id }));

  res.json({ meeting });
}

async function deleteMeeting(req, res) {
  const meeting = await Meeting.findByPk(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organizer can delete this meeting' });
  }
  const participants = await MeetingParticipant.findAll({ where: { meetingId: meeting.id } });
  const io = req.app.get('io');
  participants.forEach((p) => io.to(`user:${p.userId}`).emit('meeting-cancelled', { meetingId: meeting.id, title: meeting.title }));

  io.to(`meeting:${meeting.id}`).emit('meeting-ended', { meetingId: meeting.id, title: meeting.title, cancelled: true });
  io.in(`meeting:${meeting.id}`).socketsLeave(`meeting:${meeting.id}`);
  clearMeetingRoom(meeting.id);

  await MeetingParticipant.destroy({ where: { meetingId: meeting.id } });
  await meeting.destroy();
  res.json({ success: true });
}

// Explicitly start a scheduled meeting now (organizer only) - flips status
// and notifies all invited participants immediately (they get the
// notify+taskbar-blink treatment on their side).
async function startMeeting(req, res) {
  const meeting = await Meeting.findByPk(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organizer can start this meeting' });
  }
  if (meeting.status === 'cancelled' || meeting.status === 'ended') {
    return res.status(400).json({ error: `Meeting has already ${meeting.status}` });
  }
  // Already live (e.g. the scheduler or a double-click beat us to it): nothing to do.
  if (meeting.status === 'ongoing') return res.json({ meeting });

  meeting.status = 'ongoing';
  meeting.startedAt = new Date();
  await meeting.save();

  const participants = await MeetingParticipant.findAll({ where: { meetingId: meeting.id, userId: { [Op.ne]: req.user.id } } });
  const io = req.app.get('io');
  participants.forEach((p) => io.to(`user:${p.userId}`).emit('meeting-starting', {
    meeting: { id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt, callType: meeting.callType, status: meeting.status, createdBy: meeting.createdBy },
    from: { id: req.user.id, name: req.user.name },
  }));

  res.json({ meeting });
}

// End a live meeting for everyone (organizer / admin only). Anyone still in the
// room is told, so their client can leave cleanly.
async function endMeeting(req, res) {
  const meeting = await Meeting.findByPk(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organizer can end this meeting' });
  }
  if (meeting.status === 'ended' || meeting.status === 'cancelled') return res.json({ meeting });

  meeting.status = 'ended';
  meeting.endedAt = new Date();
  await meeting.save();

  const io = req.app.get('io');
  io.to(`meeting:${meeting.id}`).emit('meeting-ended', { meetingId: meeting.id, title: meeting.title });
  io.in(`meeting:${meeting.id}`).socketsLeave(`meeting:${meeting.id}`);
  clearMeetingRoom(meeting.id);

  // Everyone on the meetings page refreshes their list.
  const participants = await MeetingParticipant.findAll({ where: { meetingId: meeting.id } });
  participants.forEach((p) => io.to(`user:${p.userId}`).emit('meeting-updated', { meetingId: meeting.id }));

  res.json({ meeting });
}

module.exports = { createMeeting, listMyMeetings, updateMeeting, deleteMeeting, startMeeting, endMeeting };
