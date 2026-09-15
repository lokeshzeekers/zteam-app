const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Cross-department "friend request" style connection.
// Same-department users are always allowed to talk (no row needed).
class Connection extends Model {}
Connection.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  requesterId: { type: DataTypes.INTEGER, allowNull: false },
  receiverId: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'accepted', 'rejected'), defaultValue: 'pending' },
}, { sequelize, modelName: 'connection', tableName: 'connections' });

module.exports = Connection;
