const path = require('path');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const storage = process.env.DB_STORAGE || './data/zteam.sqlite';

// SQLite by default = zero external DB setup, single file, easy backups.
// To move to MySQL/Postgres on Hostinger later, swap this block for:
// new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
//   host: process.env.DB_HOST, dialect: 'mysql' // or 'postgres'
// });
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(storage),
  logging: false,
});

module.exports = sequelize;
