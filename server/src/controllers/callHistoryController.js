const { Op } = require('sequelize');
const { CallLog, User, Meeting, MeetingParticipant } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isMember } = require('./groupController');

// 1:1 call history between the current user and one other person.
async function getDMCallHistory(req, res) {
  const me = req.user;
  const otherId = Number(req.params.userId);
  const other = await User.findByPk(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const allowed = await canCommunicate(me, other);
  if (!allowed) return res.status(403).json({ error: 'Not connected with this user yet' });

  const calls = await CallLog.findAll({
    where: {
      [Op.or]: [
        { callerId: me.id, calleeId: otherId },
        { callerId: otherId, calleeId: me.id },
      ],
    },
    order: [['startedAt', 'ASC']],
    limit: 200,
  });

  res.json({
    calls: calls.map((c) => ({
      id: c.id, callerId: c.callerId, calleeId: c.calleeId, callType: c.callType,
      status: c.status, startedAt: c.startedAt, endedAt: c.endedAt,
    })),
  });
}

// Read-only view of past calls (meetings that actually started) for a group
// chat — this only queries existing Meeting data, it does not create, edit,
// join, or otherwise change any meeting.
async function getGroupCallHistory(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });

  const meetings = await Meeting.findAll({
    where: { groupId, status: { [Op.in]: ['ongoing', 'ended', 'cancelled'] } },
    order: [['scheduledAt', 'ASC']],
    limit: 200,
  });

  const result = [];
  for (const m of meetings) {
    const myParticipant = await MeetingParticipant.findOne({ where: { meetingId: m.id, userId: req.user.id } });
    const participantCount = await MeetingParticipant.count({ where: { meetingId: m.id } });
    result.push({
      id: m.id, title: m.title, callType: m.callType, status: m.status,
      startedAt: m.startedAt, endedAt: m.endedAt, scheduledAt: m.scheduledAt,
      participantCount,
      // From THIS viewer's point of view: did they actually join, or miss it?
      myStatus: myParticipant ? myParticipant.status : 'invited',
    });
  }
  res.json({ calls: result });
}

module.exports = { getDMCallHistory, getGroupCallHistory };
