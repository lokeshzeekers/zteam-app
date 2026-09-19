// Who is connected right now. Lives in its own module (not in sockets/) so
// REST controllers can use it without creating a circular import.
//
// "Active" on screen = the user pressed "Go Active" (users.isActive, saved in the
// DB) AND they currently have at least one open connection. Without the second
// half, somebody who pressed Go Active and then closed the app stays "active"
// for everyone else forever.

const userSockets = new Map(); // userId -> Set(socketId)

function addSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
  return userSockets.get(userId).size; // >1 means the user already had another tab/device open
}

function removeSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(userId);
}

function isOnline(userId) {
  return userSockets.has(userId);
}

// The value everybody else should see for this user.
function isPresent(user) {
  return !!user && !!user.isActive && isOnline(user.id);
}

function forgetUser(userId) {
  userSockets.delete(userId);
}

module.exports = { addSocket, removeSocket, isOnline, isPresent, forgetUser };
