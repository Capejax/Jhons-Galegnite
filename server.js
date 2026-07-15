const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

const PLAYER_COLORS = [0x00fff2, 0xff5ecb, 0x7cff5e, 0xffb400, 0x5ecbff, 0xff5e5e, 0xc95eff, 0xffffff];
let nextColorIdx = 0;
const players = new Map();

app.get('/api/status', (req, res) => {
  res.json({ count: io.engine.clientsCount });
});

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const name = (typeof data?.name === 'string' ? data.name : 'PLAYER').slice(0, 20) || 'PLAYER';
    const color = PLAYER_COLORS[nextColorIdx % PLAYER_COLORS.length];
    nextColorIdx++;

    const player = { id: socket.id, name, color, x: 0, y: 1, z: 0, yaw: 0, alive: true, kills: 0, deaths: 0 };
    players.set(socket.id, player);

    socket.emit('roster', Array.from(players.values()));
    socket.broadcast.emit('playerJoined', player);
  });

  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.z !== 'number' || typeof data?.yaw !== 'number') return;
    p.x = data.x; p.y = data.y; p.z = data.z; p.yaw = data.yaw;
    if (typeof data.alive === 'boolean') p.alive = data.alive;
    socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, alive: p.alive });
  });

  socket.on('shotHit', (data) => {
    const targetId = data?.targetId;
    const target = players.get(targetId);
    if (!target || !target.alive) return;
    const damage = typeof data.damage === 'number' ? data.damage : 0;
    const headshot = !!data.headshot;
    io.to(targetId).emit('applyDamage', { damage, headshot, fromId: socket.id });
  });

  socket.on('died', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.alive = false;
    p.deaths++;
    const killer = players.get(data?.killerId);
    if (killer) killer.kills++;
    io.emit('killFeed', { victimId: socket.id, victimName: p.name, killerId: killer?.id || null, killerName: killer?.name || null });
    io.emit('scoreUpdate', { id: p.id, kills: p.kills, deaths: p.deaths });
    if (killer) io.emit('scoreUpdate', { id: killer.id, kills: killer.kills, deaths: killer.deaths });
  });

  socket.on('respawned', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.alive = true;
    if (typeof data?.x === 'number') p.x = data.x;
    if (typeof data?.y === 'number') p.y = data.y;
    if (typeof data?.z === 'number') p.z = data.z;
    socket.broadcast.emit('playerRespawned', { id: socket.id, x: p.x, y: p.y, z: p.z });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('playerLeft', { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Neon Arena running on port ${PORT}`));
