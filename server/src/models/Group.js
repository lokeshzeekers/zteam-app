const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// A group is just a named set of members for text chat AND as the default
// invite list for group meetings tied to it (a meeting can also invite an
// ad-hoc list of people without a group — see Meeting.groupId nullable).
class Group extends Model {}
Group.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: 'group', tableName: 'groups' });

module.exports = Group;
