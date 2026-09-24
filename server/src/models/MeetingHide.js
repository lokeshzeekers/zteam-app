const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Per-user "remove this meeting from MY history" — same non-destructive
// pattern as GroupHide/ConversationClear. The meeting, its participants and
// everyone else's history are untouched.
class MeetingHide extends Model {}
MeetingHide.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  meetingId: { type: DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: 'meetinghide', tableName: 'meeting_hides' });

module.exports = MeetingHide;
