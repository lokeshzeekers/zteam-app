const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Meeting extends Model {}
Meeting.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  callType: { type: DataTypes.ENUM('audio', 'video'), defaultValue: 'video' },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
  groupId: { type: DataTypes.INTEGER, allowNull: true }, // optional: tie meeting to a group's member list
  scheduledAt: { type: DataTypes.DATE, allowNull: false },
  durationMinutes: { type: DataTypes.INTEGER, defaultValue: 30 },
  status: { type: DataTypes.ENUM('scheduled', 'ongoing', 'ended', 'cancelled'), defaultValue: 'scheduled' },
  roomKey: { type: DataTypes.STRING, allowNull: false, unique: true },
  startedAt: { type: DataTypes.DATE, allowNull: true },
  endedAt: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'meeting', tableName: 'meetings' });

module.exports = Meeting;
