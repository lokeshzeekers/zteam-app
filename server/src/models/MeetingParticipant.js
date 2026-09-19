const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Explicit allow-list of who may join a meeting. A user is allowed to join
// the meeting's call ONLY if a row exists here for them (enforced at
// socket 'meeting-join' time), regardless of how they found the link.
class MeetingParticipant extends Model {}
MeetingParticipant.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  meetingId: { type: DataTypes.INTEGER, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('invited', 'joined', 'declined'), defaultValue: 'invited' },
}, { sequelize, modelName: 'meetingparticipant', tableName: 'meeting_participants' });

module.exports = MeetingParticipant;
