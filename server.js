const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

const PLAYER_COLORS = [0x00fff2, 0xff5ecb, 0x7cff5e, 0xffb400, 0x5ecbff, 0xff5e5e, 0xc95eff, 0xffffff];

// rooms: roomId -> { id, name, hostName, botsEnabled, nextColorIdx, players: Map<socketId, player> }
const rooms = new Map();

function makeRoomId(){
  let id;
  do { id = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(id));
  return id;
}

function roomSummary(room){
  return { id: room.id, name: room.name, hostName: room.hostName, playerCount: room.players.size, botsEnabled: room.botsEnabled };
}

app.get('/api/status', (req, res) => {
  res.json({ count: io.engine.clientsCount });
});

app.get('/api/rooms', (req, res) => {
  res.json(Array.from(rooms.values()).map(roomSummary));
});

function addPlayerToRoom(room, socket, name){
  const color = PLAYER_COLORS[room.nextColorIdx % PLAYER_COLORS.length];
  room.nextColorIdx++;
  const player = { id: socket.id, name, color, x: 0, y: 1, z: 0, yaw: 0, alive: true, kills: 0, deaths: 0 };
  room.players.set(socket.id, player);
  socket.join(room.id);
  socket.data.roomId = room.id;
  return player;
}

function removePlayerFromRoom(socket){
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.delete(socket.id);
  socket.data.roomId = null;
  if (room.players.size === 0) {
    rooms.delete(roomId);
  } else {
    io.to(roomId).emit('playerLeft', { id: socket.id });
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (data) => {
    const name = (typeof data?.name === 'string' ? data.name : 'PLAYER').slice(0, 20) || 'PLAYER';
    const serverName = (typeof data?.serverName === 'string' ? data.serverName : "PLAYER'S ARENA").slice(0, 24) || "PLAYER'S ARENA";
    const botsEnabled = data?.botsEnabled !== false;

    const room = { id: makeRoomId(), name: serverName, hostName: name, botsEnabled, nextColorIdx: 0, players: new Map() };
    rooms.set(room.id, room);
    const player = addPlayerToRoom(room, socket, name);

    socket.emit('roomJoined', { roomId: room.id, roomName: room.name, botsEnabled: room.botsEnabled, roster: Array.from(room.players.values()) });
  });

  socket.on('joinRoom', (data) => {
    const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
    const room = rooms.get(roomId);
    if (!room) { socket.emit('joinError', { message: 'That server no longer exists.' }); return; }
    const name = (typeof data?.name === 'string' ? data.name : 'PLAYER').slice(0, 20) || 'PLAYER';

    const player = addPlayerToRoom(room, socket, name);
    socket.emit('roomJoined', { roomId: room.id, roomName: room.name, botsEnabled: room.botsEnabled, roster: Array.from(room.players.values()) });
    socket.to(room.id).emit('playerJoined', player);
  });

  socket.on('move', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    const p = room && room.players.get(socket.id);
    if (!p) return;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.z !== 'number' || typeof data?.yaw !== 'number') return;
    p.x = data.x; p.y = data.y; p.z = data.z; p.yaw = data.yaw;
    if (typeof data.alive === 'boolean') p.alive = data.alive;
    socket.to(roomId).emit('playerMoved', { id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, alive: p.alive });
  });

  socket.on('shotHit', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const targetId = data?.targetId;
    const target = room.players.get(targetId);
    if (!target || !target.alive) return;
    const damage = typeof data.damage === 'number' ? data.damage : 0;
    const headshot = !!data.headshot;
    io.to(targetId).emit('applyDamage', { damage, headshot, fromId: socket.id });
  });

  socket.on('rocketFired', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.z !== 'number' ||
        typeof data?.dx !== 'number' || typeof data?.dy !== 'number' || typeof data?.dz !== 'number') return;
    socket.to(roomId).emit('rocketFired', data);
  });

  socket.on('died', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.alive = false;
    p.deaths++;
    const killer = room.players.get(data?.killerId);
    if (killer) killer.kills++;
    io.to(roomId).emit('killFeed', { victimId: socket.id, victimName: p.name, killerId: killer?.id || null, killerName: killer?.name || null });
    io.to(roomId).emit('scoreUpdate', { id: p.id, kills: p.kills, deaths: p.deaths });
    if (killer) io.to(roomId).emit('scoreUpdate', { id: killer.id, kills: killer.kills, deaths: killer.deaths });
  });

  socket.on('respawned', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.alive = true;
    if (typeof data?.x === 'number') p.x = data.x;
    if (typeof data?.y === 'number') p.y = data.y;
    if (typeof data?.z === 'number') p.z = data.z;
    socket.to(roomId).emit('playerRespawned', { id: socket.id, x: p.x, y: p.y, z: p.z });
  });

  socket.on('leaveRoom', () => {
    removePlayerFromRoom(socket);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Neon Arena running on port ${PORT}`));
