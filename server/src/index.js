require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const { sequelize } = require('./models');
const { initSockets } = require('./sockets');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const directoryRoutes = require('./routes/directory');
const connectionRoutes = require('./routes/connections');
const messageRoutes = require('./routes/messages');
const fileRoutes = require('./routes/files');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', credentials: true },
});
app.set('io', io);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/directory', directoryRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/files', fileRoutes);

initSockets(io);

const PORT = process.env.PORT || 5000;

async function start() {
  await sequelize.authenticate();
  await sequelize.sync(); // creates tables if they don't exist yet
  server.listen(PORT, () => console.log(`Zteam server listening on port ${PORT}`));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
