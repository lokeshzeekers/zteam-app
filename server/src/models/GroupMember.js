const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class GroupMember extends Model {}
GroupMember.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.INTEGER, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.ENUM('owner', 'member'), defaultValue: 'member' },
}, { sequelize, modelName: 'groupmember', tableName: 'group_members' });

module.exports = GroupMember;
