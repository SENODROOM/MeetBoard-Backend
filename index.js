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

// ─── MongoDB Room Model ───────────────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 }, // auto-delete after 24h
  host: { type: String },
  participants: [String],
});
const Room = mongoose.model('Room', roomSchema);

// ─── REST API ─────────────────────────────────────────────────────────────────
// Create room
app.post('/api/rooms', async (req, res) => {
  try {
    const roomId = uuidv4().slice(0, 3) + '-' + uuidv4().slice(0, 4) + '-' + uuidv4().slice(0, 3);
    const room = new Room({ roomId, host: req.body.userId });
    await room.save();
    res.json({ roomId, link: `${process.env.CLIENT_URL || 'http://localhost:3000'}/room/${roomId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room info
app.get('/api/rooms/:roomId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

// ─── Socket.io Signaling ──────────────────────────────────────────────────────
// Map: roomId → Set of { socketId, userId, userName, peerId }
const rooms = new Map();
// Map: socketId → { roomId, userId, userName }
const socketMeta = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // Join room
  socket.on('join-room', ({ roomId, userId, userName }) => {
    socket.join(roomId);
    socketMeta.set(socket.id, { roomId, userId, userName });

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { socketId: socket.id, userId, userName });

    // Tell existing peers about new user
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, userName });

    // Send existing peers to new user
    const peers = [];
    rooms.get(roomId).forEach((peer, sid) => {
      if (sid !== socket.id) peers.push(peer);
    });
    socket.emit('existing-peers', peers);

    console.log(`[room:${roomId}] ${userName} joined. Total: ${rooms.get(roomId).size}`);
  });

  // WebRTC signaling relay
  socket.on('offer', ({ to, offer, from, userName }) => {
    io.to(to).emit('offer', { from, offer, userName });
  });

  socket.on('answer', ({ to, answer, from }) => {
    io.to(to).emit('answer', { from, answer });
  });

  socket.on('ice-candidate', ({ to, candidate, from }) => {
    io.to(to).emit('ice-candidate', { from, candidate });
  });

  // Chat message
  socket.on('chat-message', ({ roomId, message, userName, userId }) => {
    io.to(roomId).emit('chat-message', {
      id: uuidv4(),
      message,
      userName,
      userId,
      timestamp: new Date().toISOString(),
    });
  });

  // Media state changes
  socket.on('toggle-audio', ({ roomId, userId, enabled }) => {
    socket.to(roomId).emit('peer-audio-toggle', { userId, socketId: socket.id, enabled });
  });

  socket.on('toggle-video', ({ roomId, userId, enabled }) => {
    socket.to(roomId).emit('peer-video-toggle', { userId, socketId: socket.id, enabled });
  });

  // ── Whiteboard signaling ─────────────────────────────────────────────────
  socket.on('wb-join', ({ roomId }) => {
    // Ask an existing peer in the room to send their canvas state
    socket.to(roomId).emit('wb-request-canvas', { from: socket.id });
  });

  socket.on('wb-draw', (data) => {
    socket.to(data.roomId).emit('wb-draw', data);
  });

  socket.on('wb-clear', ({ roomId }) => {
    socket.to(roomId).emit('wb-clear');
  });

  socket.on('wb-cursor', (data) => {
    socket.to(data.roomId).emit('wb-cursor', data);
  });

  socket.on('wb-canvas-state', ({ to, dataUrl }) => {
    io.to(to).emit('wb-canvas-state', { dataUrl });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (meta) {
      const { roomId, userName } = meta;
      socket.to(roomId).emit('user-left', { socketId: socket.id, userName });
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) rooms.delete(roomId);
      }
      socketMeta.delete(socket.id);
      console.log(`[-] ${userName} left room ${roomId}`);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/quantummeet';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.warn('⚠️  MongoDB connection failed, running without DB:', err.message);
    server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT} (no DB)`));
  });
