const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Per-user "last time I opened this group" — the single source of truth for
// group unread state. Mirrors GroupHide/ConversationClear (same per-user,
// non-destructive pattern): opening a group upserts this row; a group is
// unread for a user whenever it has a (non-deleted) message newer than
// their own lastReadAt here. Survives refresh/relogin because it's a real
// DB row, not client-side state.
class GroupRead extends Model {}
GroupRead.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  groupId: { type: DataTypes.INTEGER, allowNull: false },
  lastReadAt: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'groupread', tableName: 'group_reads' });

module.exports = GroupRead;
