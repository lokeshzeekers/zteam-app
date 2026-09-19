const { Op } = require('sequelize');
const { Meeting, MeetingParticipant, User } = require('../models');

// Polls for scheduled meetings whose time has arrived and flips them to
// "ongoing" + notifies every invited participant (the client turns this into
// a desktop notification + taskbar blink, same as an incoming call/message).
// No new dependency needed for this — a plain interval is enough at this scale.
function startMeetingScheduler(io, intervalMs = 30 * 1000) {
  async function tick() {
    try {
      const due = await Meeting.findAll({
        where: { status: 'scheduled', scheduledAt: { [Op.lte]: new Date() } },
      });
      for (const meeting of due) {
        meeting.status = 'ongoing';
        meeting.startedAt = new Date();
        await meeting.save();

        const participants = await MeetingParticipant.findAll({ where: { meetingId: meeting.id } });
        const organizer = await User.findByPk(meeting.createdBy);
        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit('meeting-starting', {
            meeting: {
              id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt,
              callType: meeting.callType, status: meeting.status, createdBy: meeting.createdBy,
            },
            from: { id: organizer?.id, name: organizer?.name || 'Organizer' },
          });
        });
      }
    } catch (err) {
      console.error('Meeting scheduler tick failed:', err.message);
    }
  }
  setInterval(tick, intervalMs);
  tick();
}

module.exports = { startMeetingScheduler };
