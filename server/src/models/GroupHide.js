const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Same idea as ConversationClear but for group chats: hides a group from
// this one user's Groups list without touching membership, other members,
// or the group's shared message history at all.
class GroupHide extends Model {}
GroupHide.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  groupId: { type: DataTypes.INTEGER, allowNull: false },
  hiddenAt: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'grouphide', tableName: 'group_hides' });

module.exports = GroupHide;
