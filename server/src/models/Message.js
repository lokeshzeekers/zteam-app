const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Message extends Model {}
Message.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  senderId: { type: DataTypes.INTEGER, allowNull: false },
  receiverId: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.ENUM('text', 'file'), defaultValue: 'text' },
  content: { type: DataTypes.TEXT, allowNull: true },
  fileUrl: { type: DataTypes.STRING, allowNull: true },
  fileName: { type: DataTypes.STRING, allowNull: true },
  readAt: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'message', tableName: 'messages' });

module.exports = Message;
