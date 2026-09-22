const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// "Delete conversation" is per-user only — it never touches the other
// person's copy or the shared message rows. A row here just means "hide
// this thread from my inbox unless something new happens after this time."
// If the other person sends a new message afterwards, the thread naturally
// reappears (same behavior as WhatsApp/Messenger "delete chat").
class ConversationClear extends Model {}
ConversationClear.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  otherUserId: { type: DataTypes.INTEGER, allowNull: false },
  clearedAt: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'conversationclear', tableName: 'conversation_clears' });

module.exports = ConversationClear;
