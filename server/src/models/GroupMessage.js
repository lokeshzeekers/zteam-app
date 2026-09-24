const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Deliberately a separate table from the 1:1 `messages` table rather than
// reusing it — avoids any risky schema migration on the existing DM history
// (receiverId there is NOT NULL) and keeps group chat fully additive.
class GroupMessage extends Model {}
GroupMessage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.INTEGER, allowNull: false },
  senderId: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.ENUM('text', 'file'), defaultValue: 'text' },
  content: { type: DataTypes.TEXT, allowNull: true },
  fileUrl: { type: DataTypes.STRING, allowNull: true },
  fileName: { type: DataTypes.STRING, allowNull: true },
  editedAt: { type: DataTypes.DATE, allowNull: true },
  deletedAt: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'groupmessage', tableName: 'group_messages' });

module.exports = GroupMessage;
