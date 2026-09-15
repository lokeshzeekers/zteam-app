const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class CallLog extends Model {}
CallLog.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  callerId: { type: DataTypes.INTEGER, allowNull: false },
  calleeId: { type: DataTypes.INTEGER, allowNull: false },
  callType: { type: DataTypes.ENUM('audio', 'video'), defaultValue: 'audio' },
  status: { type: DataTypes.ENUM('missed', 'completed', 'rejected'), defaultValue: 'missed' },
  startedAt: { type: DataTypes.DATE, allowNull: true },
  endedAt: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'calllog', tableName: 'call_logs' });

module.exports = CallLog;
