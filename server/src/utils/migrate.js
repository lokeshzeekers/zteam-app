const { DataTypes } = require('sequelize');
const { sequelize } = require('../models');

// sequelize.sync() creates missing TABLES fine, but it will not add a new
// COLUMN to a table that already exists in production (the live `messages`
// table predates `deletedAt`). This adds it once, safely and idempotently —
// checked every boot, only actually runs the ALTER TABLE the first time,
// never touches or drops any existing data.
async function ensureColumn(table, column, definition) {
  const qi = sequelize.getQueryInterface();
  const existing = await qi.describeTable(table);
  if (!existing[column]) {
    await qi.addColumn(table, column, definition);
    console.log(`Migration: added column "${column}" to "${table}"`);
  }
}

async function runMigrations() {
  await ensureColumn('messages', 'deletedAt', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn('messages', 'deliveredAt', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn('messages', 'editedAt', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn('group_messages', 'editedAt', { type: DataTypes.DATE, allowNull: true });
}

module.exports = { runMigrations };
