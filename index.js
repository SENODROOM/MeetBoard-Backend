require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// ─── MongoDB Models ───────────────────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomId:      { type: String, required: true, unique: true },
  createdAt:   { type: Date, default: Date.now, expires: 86400 },
  host:        { type: String },
  hostName:    { type: String, default: 'Host' },
  isPublic:    { type: Boolean, default: true },
  title:       { type: String, default: '' },
  participants: [String],
  participantCount: { type: Number, default: 0 },
});
const Room = mongoose.model('Room', roomSchema);

// ─── In-memory state ─────────────────────────────────────────────────────────
// Map: roomId → Map<socketId, { socketId, userId, userName }>
const rooms = new Map();
// Map: socketId → { roomId, userId, userName }
const socketMeta = new Map();
// Map: roomId → hostSocketId
const roomHosts = new Map();
// Map: roomId → Map<socketId, { userId, userName }> (pending knock requests)
const knockQueue = new Map();

// ─── REST API ─────────────────────────────────────────────────────────────────
// Create room
app.post('/api/rooms', async (req, res) => {
  try {
    const { userId, hostName, isPublic = true, title = '' } = req.body;
    const roomId = uuidv4().slice(0, 3) + '-' + uuidv4().slice(0, 4) + '-' + uuidv4().slice(0, 3);
    try {
      const room = new Room({ roomId, host: userId, hostName, isPublic, title, participantCount: 0 });
      await room.save();
    } catch (dbErr) {
      // DB unavailable — run without persistence
    }
    res.json({
      roomId,
      isPublic,
      link: `${process.env.CLIENT_URL || 'http://localhost:3000'}/room/${roomId}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room info
app.get('/api/rooms/:roomId', async (req, res) => {
  try {
    let roomData = null;
    try { roomData = await Room.findOne({ roomId: req.params.roomId }); } catch (e) {}
    // Also get live participant count from in-memory
    const liveCount = rooms.has(req.params.roomId) ? rooms.get(req.params.roomId).size : 0;
    if (roomData) return res.json({ ...roomData.toObject(), participantCount: liveCount });
    // Fallback: if DB is down, check in-memory
    if (rooms.has(req.params.roomId)) {
      return res.json({ roomId: req.params.roomId, isPublic: true, participantCount: liveCount });
    }
    res.status(404).json({ error: 'Room not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List public live rooms (Live Streams)
app.get('/api/rooms', async (req, res) => {
  try {
    // Get all rooms that have active participants
    const liveRoomIds = [...rooms.keys()].filter(id => rooms.get(id).size > 0);

    let publicRooms = [];
    try {
      const dbRooms = await Room.find({ roomId: { $in: liveRoomIds }, isPublic: true });
      publicRooms = dbRooms.map(r => ({
        roomId: r.roomId,
        title: r.title || `${r.hostName}'s Meeting`,
        hostName: r.hostName,
        isPublic: r.isPublic,
        participantCount: rooms.has(r.roomId) ? rooms.get(r.roomId).size : 0,
        createdAt: r.createdAt,
      }));
    } catch (e) {
      // DB down — return in-memory public rooms (all treated as public)
      publicRooms = liveRoomIds.map(id => ({
        roomId: id,
        title: `Meeting ${id}`,
        hostName: 'Host',
        isPublic: true,
        participantCount: rooms.get(id).size,
        createdAt: new Date(),
      }));
    }
    res.json(publicRooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Join room (used by public rooms or after host accepts knock) ────────────
  socket.on('join-room', ({ roomId, userId, userName, isHost }) => {
    socket.join(roomId);
    socketMeta.set(socket.id, { roomId, userId, userName });

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { socketId: socket.id, userId, userName });

    if (isHost) roomHosts.set(roomId, socket.id);

    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, userName });

    const peers = [];
    rooms.get(roomId).forEach((peer, sid) => {
      if (sid !== socket.id) peers.push(peer);
    });
    socket.emit('existing-peers', peers);

    // Update DB participant count
    Room.findOneAndUpdate({ roomId }, { participantCount: rooms.get(roomId).size }).catch(() => {});
    console.log(`[room:${roomId}] ${userName} joined. Total: ${rooms.get(roomId).size}`);
  });

  // ── Knock (private room entry request) ────────────────────────────────────
  socket.on('knock', ({ roomId, userId, userName }) => {
    if (!knockQueue.has(roomId)) knockQueue.set(roomId, new Map());
    knockQueue.get(roomId).set(socket.id, { userId, userName, socketId: socket.id });

    // Notify host
    const hostSocketId = roomHosts.get(roomId);
    if (hostSocketId) {
      io.to(hostSocketId).emit('knock-request', { socketId: socket.id, userId, userName });
    } else {
      // No host connected yet — auto-admit
      socket.emit('knock-accepted', { roomId });
    }
  });

  // ── Host accepts knock ────────────────────────────────────────────────────
  socket.on('admit-user', ({ roomId, socketId: targetSocketId }) => {
    io.to(targetSocketId).emit('knock-accepted', { roomId });
    if (knockQueue.has(roomId)) knockQueue.get(roomId).delete(targetSocketId);
  });

  // ── Host rejects knock ────────────────────────────────────────────────────
  socket.on('reject-user', ({ roomId, socketId: targetSocketId }) => {
    io.to(targetSocketId).emit('knock-rejected', { roomId });
    if (knockQueue.has(roomId)) knockQueue.get(roomId).delete(targetSocketId);
  });

  // ── Host kicks a participant ───────────────────────────────────────────────
  socket.on('kick-user', ({ roomId, targetSocketId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    // Only host can kick
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit('kicked');
    // Force disconnect from room
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(roomId);
      const tMeta = socketMeta.get(targetSocketId);
      if (tMeta) {
        socket.to(roomId).emit('user-left', { socketId: targetSocketId, userName: tMeta.userName });
        if (rooms.has(roomId)) rooms.get(roomId).delete(targetSocketId);
        socketMeta.delete(targetSocketId);
      }
    }
  });

  // ── WebRTC signaling ───────────────────────────────────────────────────────
  socket.on('offer',         ({ to, offer, from, userName }) => io.to(to).emit('offer', { from, offer, userName }));
  socket.on('answer',        ({ to, answer, from })          => io.to(to).emit('answer', { from, answer }));
  socket.on('ice-candidate', ({ to, candidate, from })       => io.to(to).emit('ice-candidate', { from, candidate }));

  // ── Chat ────────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message, userName, userId }) => {
    io.to(roomId).emit('chat-message', {
      id: uuidv4(), message, userName, userId, timestamp: new Date().toISOString(),
    });
  });

  // ── Media toggles ──────────────────────────────────────────────────────────
  socket.on('toggle-audio', ({ roomId, userId, enabled }) =>
    socket.to(roomId).emit('peer-audio-toggle', { userId, socketId: socket.id, enabled }));
  socket.on('toggle-video', ({ roomId, userId, enabled }) =>
    socket.to(roomId).emit('peer-video-toggle', { userId, socketId: socket.id, enabled }));

  // ── Whiteboard ─────────────────────────────────────────────────────────────
  socket.on('wb-join', ({ roomId }) => socket.to(roomId).emit('wb-request-canvas', { from: socket.id }));
  socket.on('wb-draw',          (data)            => socket.to(data.roomId).emit('wb-draw', data));
  socket.on('wb-clear',         ({ roomId })      => socket.to(roomId).emit('wb-clear'));
  socket.on('wb-cursor',        (data)            => socket.to(data.roomId).emit('wb-cursor', data));
  socket.on('wb-canvas-state',  ({ to, dataUrl }) => io.to(to).emit('wb-canvas-state', { dataUrl }));
  socket.on('wb-image-drop',    (data)            => socket.to(data.roomId).emit('wb-image-drop', data));
  socket.on('wb-image-move',    (data)            => socket.to(data.roomId).emit('wb-image-move', data));
  socket.on('wb-image-resize',  (data)            => socket.to(data.roomId).emit('wb-image-resize', data));
  socket.on('wb-image-delete',  (data)            => socket.to(data.roomId).emit('wb-image-delete', data));


  // ── Host controls ──────────────────────────────────────────────────────────
  // mute a specific user
  socket.on('host-mute-user', ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit('force-mute');
  });
  // unmute a specific user
  socket.on('host-unmute-user', ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit('force-unmute');
  });
  // mute everyone
  socket.on('host-mute-all', ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    socket.to(roomId).emit('force-mute');
  });
  // stop a user's video
  socket.on('host-stop-video', ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit('force-stop-video');
  });
  // toggle whiteboard permission for a user
  socket.on('host-wb-permission', ({ roomId, targetSocketId, allowed }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit('wb-permission', { allowed });
  });
  // lower all hands
  socket.on('host-lower-all-hands', ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    socket.to(roomId).emit('lower-hand');
  });
  // raise / lower own hand
  socket.on('raise-hand', ({ roomId, userName: uName }) => {
    socket.to(roomId).emit('peer-hand-raise', { socketId: socket.id, userName: uName });
  });
  socket.on('lower-hand', ({ roomId }) => {
    socket.to(roomId).emit('peer-hand-lower', { socketId: socket.id });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (meta) {
      const { roomId, userName } = meta;
      socket.to(roomId).emit('user-left', { socketId: socket.id, userName });
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          knockQueue.delete(roomId);
        }
      }
      if (roomHosts.get(roomId) === socket.id) roomHosts.delete(roomId);
      socketMeta.delete(socket.id);
      Room.findOneAndUpdate({ roomId }, { participantCount: rooms.has(roomId) ? rooms.get(roomId).size : 0 }).catch(() => {});
      console.log(`[-] ${userName} left ${roomId}`);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/quantummeet';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.warn('⚠️  No DB, running in-memory:', err.message);
    server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT} (no DB)`));
  });
