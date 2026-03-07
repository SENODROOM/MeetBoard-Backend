require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "https://meet.quantumlogicslimited.com",
  "https://www.meet.quantumlogicslimited.com",
  "http://localhost:3000",
  "http://localhost:5001",
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS: origin not allowed → " + origin));
      }
    },
    credentials: true,
  }),
);

// Explicitly handle OPTIONS preflight for all routes
app.options("*", cors());

app.use(express.json());
app.use(express.static(require("path").join(__dirname, "uploads")));

// Classroom API
const classroomRouter = require("./classroom");
app.use("/api/classrooms", classroomRouter);

// ─── MongoDB Models ───────────────────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
  host: { type: String },
  hostName: { type: String, default: "Host" },
  isPublic: { type: Boolean, default: true },
  title: { type: String, default: "" },
  participants: [String],
  participantCount: { type: Number, default: 0 },
});
const Room = mongoose.model("Room", roomSchema);

// ─── In-memory state ─────────────────────────────────────────────────────────
// Map: roomId → Map<socketId, { socketId, userId, userName }>
const rooms = new Map();
// Map: socketId → { roomId, userId, userName }
const socketMeta = new Map();
// Map: roomId → hostSocketId
const roomHosts = new Map();
// Map: roomId → Map<socketId, { userId, userName }> (pending knock requests)
const knockQueue = new Map();
// Map: roomId → boolean (isPublic) — in-memory fallback when DB is down
const roomPrivacy = new Map();

// ─── REST API ─────────────────────────────────────────────────────────────────
// Create room
app.post("/api/rooms", async (req, res) => {
  try {
    const { userId, hostName, isPublic = true, title = "" } = req.body;
    const roomId =
      uuidv4().slice(0, 3) +
      "-" +
      uuidv4().slice(0, 4) +
      "-" +
      uuidv4().slice(0, 3);

    // Always store privacy in-memory so the knock handler and live list
    // work correctly even when MongoDB is unavailable.
    roomPrivacy.set(roomId, isPublic === true || isPublic === "true");

    try {
      const room = new Room({
        roomId,
        host: userId,
        hostName,
        isPublic,
        title,
        participantCount: 0,
      });
      await room.save();
    } catch (dbErr) {
      // DB unavailable — run without persistence
    }
    res.json({
      roomId,
      isPublic,
      link: `${process.env.CLIENT_URL || "http://localhost:3000"}/room/${roomId}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room info
app.get("/api/rooms/:roomId", async (req, res) => {
  try {
    let roomData = null;
    try {
      roomData = await Room.findOne({ roomId: req.params.roomId });
    } catch (e) {}
    // Also get live participant count from in-memory
    const liveCount = rooms.has(req.params.roomId)
      ? rooms.get(req.params.roomId).size
      : 0;
    if (roomData)
      return res.json({ ...roomData.toObject(), participantCount: liveCount });
    // Fallback: if DB is down, check in-memory.
    // Use the privacy map so private rooms stay private even without DB.
    if (rooms.has(req.params.roomId)) {
      const isPublic = roomPrivacy.has(req.params.roomId)
        ? roomPrivacy.get(req.params.roomId)
        : false; // default to private (safe) if unknown
      return res.json({
        roomId: req.params.roomId,
        isPublic,
        participantCount: liveCount,
      });
    }
    res.status(404).json({ error: "Room not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List public live rooms (Live tab)
app.get("/api/rooms", async (req, res) => {
  try {
    // Get all rooms that have active participants
    const liveRoomIds = [...rooms.keys()].filter(
      (id) => rooms.get(id).size > 0,
    );

    let publicRooms = [];
    try {
      // DB query already filters by isPublic: true — private rooms are excluded
      const dbRooms = await Room.find({
        roomId: { $in: liveRoomIds },
        isPublic: true,
      });
      publicRooms = dbRooms.map((r) => ({
        roomId: r.roomId,
        title: r.title || `${r.hostName}'s Meeting`,
        hostName: r.hostName,
        isPublic: r.isPublic,
        participantCount: rooms.has(r.roomId) ? rooms.get(r.roomId).size : 0,
        createdAt: r.createdAt,
      }));
    } catch (e) {
      // DB down — use in-memory privacy map to filter; never expose private rooms
      publicRooms = liveRoomIds
        .filter((id) => roomPrivacy.get(id) === true)
        .map((id) => ({
          roomId: id,
          title: `Meeting ${id}`,
          hostName: "Host",
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
app.get("/api/health", (_, res) =>
  res.json({ status: "ok", time: new Date() }),
);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const secretQueue = new Map();

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Join room (used by public rooms or after host accepts knock) ────────────
  socket.on("join-room", ({ roomId, userId, userName, isHost }) => {
    socket.join(roomId);
    socketMeta.set(socket.id, { roomId, userId, userName });

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { socketId: socket.id, userId, userName });

    if (isHost) roomHosts.set(roomId, socket.id);

    socket
      .to(roomId)
      .emit("user-joined", { socketId: socket.id, userId, userName });

    const peers = [];
    rooms.get(roomId).forEach((peer, sid) => {
      if (sid !== socket.id) peers.push(peer);
    });
    socket.emit("existing-peers", peers);

    // Update DB participant count
    Room.findOneAndUpdate(
      { roomId },
      { participantCount: rooms.get(roomId).size },
    ).catch(() => {});
    console.log(
      `[room:${roomId}] ${userName} joined. Total: ${rooms.get(roomId).size}`,
    );
  });

  // ── Knock (private room entry request) ────────────────────────────────────
  socket.on("knock", ({ roomId, userId, userName }) => {
    if (!knockQueue.has(roomId)) knockQueue.set(roomId, new Map());
    knockQueue
      .get(roomId)
      .set(socket.id, { userId, userName, socketId: socket.id });

    // Notify host
    const hostSocketId = roomHosts.get(roomId);
    if (hostSocketId) {
      io.to(hostSocketId).emit("knock-request", {
        socketId: socket.id,
        userId,
        userName,
      });
    } else {
      // No host connected yet — keep the user waiting.
      // Do NOT auto-admit: the host must approve entry for private rooms.
      socket.emit("knock-waiting", { roomId });
    }
  });

  // ── Host accepts knock ────────────────────────────────────────────────────
  socket.on("admit-user", ({ roomId, socketId: targetSocketId }) => {
    io.to(targetSocketId).emit("knock-accepted", { roomId });
    if (knockQueue.has(roomId)) knockQueue.get(roomId).delete(targetSocketId);
  });

  // ── Host rejects knock ────────────────────────────────────────────────────
  socket.on("reject-user", ({ roomId, socketId: targetSocketId }) => {
    io.to(targetSocketId).emit("knock-rejected", { roomId });
    if (knockQueue.has(roomId)) knockQueue.get(roomId).delete(targetSocketId);
  });

  // ── When host joins, notify any pending knockers so they know help arrived ─
  // (knockers are already in the queue; host joining triggers knock-request
  //  delivery for all queued users so the host can admit/reject them)
  socket.on("host-joined", ({ roomId }) => {
    const queue = knockQueue.get(roomId);
    if (!queue) return;
    queue.forEach(({ socketId: kSid, userId: kUid, userName: kName }) => {
      socket.emit("knock-request", {
        socketId: kSid,
        userId: kUid,
        userName: kName,
      });
    });
  });

  // ── Host kicks a participant ───────────────────────────────────────────────
  socket.on("kick-user", ({ roomId, targetSocketId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    // Only host can kick
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("kicked");
    // Force disconnect from room
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(roomId);
      const tMeta = socketMeta.get(targetSocketId);
      if (tMeta) {
        socket
          .to(roomId)
          .emit("user-left", {
            socketId: targetSocketId,
            userName: tMeta.userName,
          });
        if (rooms.has(roomId)) rooms.get(roomId).delete(targetSocketId);
        socketMeta.delete(targetSocketId);
      }
    }
  });

  // ── WebRTC signaling ───────────────────────────────────────────────────────
  socket.on("offer", ({ to, offer, from, userName }) =>
    io.to(to).emit("offer", { from, offer, userName }),
  );
  socket.on("answer", ({ to, answer, from }) =>
    io.to(to).emit("answer", { from, answer }),
  );
  socket.on("ice-candidate", ({ to, candidate, from }) =>
    io.to(to).emit("ice-candidate", { from, candidate }),
  );

  // ── Chat ────────────────────────────────────────────────────────────────
  socket.on("chat-message", ({ roomId, message, userName, userId }) => {
    io.to(roomId).emit("chat-message", {
      id: uuidv4(),
      message,
      userName,
      userId,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Screen share signalling ───────────────────────────────────────────────────
  // Relay to all other participants so they know to clear the screen tile.
  socket.on("screen-share-stopped", ({ roomId }) => {
    socket.to(roomId).emit("peer-screen-stopped", { socketId: socket.id });
  });

  // ── Media toggles ──────────────────────────────────────────────────────────
  socket.on("toggle-audio", ({ roomId, userId, enabled }) =>
    socket
      .to(roomId)
      .emit("peer-audio-toggle", { userId, socketId: socket.id, enabled }),
  );
  socket.on("toggle-video", ({ roomId, userId, enabled }) =>
    socket
      .to(roomId)
      .emit("peer-video-toggle", { userId, socketId: socket.id, enabled }),
  );

  // ── Emoji reactions ──────────────────────────────────────────────────────────
  socket.on("room-reaction", ({ roomId, emoji, x, y }) =>
    socket.to(roomId).emit("peer-reaction", { emoji, x, y }),
  );

  // ── Whiteboard ─────────────────────────────────────────────────────────────
  socket.on("wb-join", ({ roomId }) =>
    socket.to(roomId).emit("wb-request-canvas", { from: socket.id }),
  );
  socket.on("wb-draw", (data) => socket.to(data.roomId).emit("wb-draw", data));
  socket.on("wb-clear", ({ roomId }) => socket.to(roomId).emit("wb-clear"));
  socket.on("wb-cursor", (data) =>
    socket.to(data.roomId).emit("wb-cursor", data),
  );
  socket.on("wb-canvas-state", ({ to, dataUrl }) =>
    io.to(to).emit("wb-canvas-state", { dataUrl }),
  );
  socket.on("wb-image-drop", (data) =>
    socket.to(data.roomId).emit("wb-image-drop", data),
  );
  socket.on("wb-image-move", (data) =>
    socket.to(data.roomId).emit("wb-image-move", data),
  );
  socket.on("wb-image-resize", (data) =>
    socket.to(data.roomId).emit("wb-image-resize", data),
  );
  socket.on("wb-image-delete", (data) =>
    socket.to(data.roomId).emit("wb-image-delete", data),
  );

  // ── Host controls ──────────────────────────────────────────────────────────
  // mute a specific user
  socket.on("host-mute-user", ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("force-mute");
  });
  // unmute a specific user
  socket.on("host-unmute-user", ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("force-unmute");
  });
  // mute everyone
  socket.on("host-mute-all", ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    socket.to(roomId).emit("force-mute");
  });
  // stop a user's video
  socket.on("host-stop-video", ({ roomId, targetSocketId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("force-stop-video");
  });
  // toggle whiteboard permission for a user
  socket.on("host-wb-permission", ({ roomId, targetSocketId, allowed }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("wb-permission", { allowed });
  });
  // lower all hands
  socket.on("host-lower-all-hands", ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    socket.to(roomId).emit("lower-hand");
  });
  // raise / lower own hand
  socket.on("raise-hand", ({ roomId, userName: uName }) => {
    socket
      .to(roomId)
      .emit("peer-hand-raise", { socketId: socket.id, userName: uName });
  });
  socket.on("lower-hand", ({ roomId }) => {
    socket.to(roomId).emit("peer-hand-lower", { socketId: socket.id });
  });

  // ── SecretMeet — random pairing ────────────────────────────────────────────
  socket.on("secret-join-queue", ({ userId, userName }) => {
    // Already in queue? skip
    if (secretQueue.has(socket.id)) return;
    secretQueue.set(socket.id, { userId, userName, socketId: socket.id });

    // Try to find a waiting partner
    let partner = null;
    for (const [sid, data] of secretQueue.entries()) {
      if (sid !== socket.id) {
        partner = { sid, ...data };
        break;
      }
    }

    if (partner) {
      // Pair found — create a room and notify both
      secretQueue.delete(socket.id);
      secretQueue.delete(partner.sid);
      const roomId = "secret-" + require("uuid").v4().slice(0, 8);
      io.to(socket.id).emit("secret-matched", {
        roomId,
        partnerName: partner.userName,
      });
      io.to(partner.sid).emit("secret-matched", {
        roomId,
        partnerName: userName,
      });
    } else {
      socket.emit("secret-waiting");
    }
  });

  socket.on("secret-leave-queue", () => {
    secretQueue.delete(socket.id);
    socket.emit("secret-cancelled");
  });

  // ── Transcription relay ───────────────────────────────────────────────────
  socket.on("transcript-share", ({ roomId, text, speakerName, timestamp }) => {
    socket.to(roomId).emit("transcript-line", { text, speakerName, timestamp });
  });

  // ── Transcription permission ──────────────────────────────────────────────
  socket.on("host-grant-transcribe", ({ roomId, targetSocketId, allowed }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("transcribe-permission", { allowed });
  });

  // ── Breakout Rooms ────────────────────────────────────────────────────────
  socket.on("breakout-create", ({ roomId, breakoutRooms }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    breakoutSessions.set(roomId, { rooms: breakoutRooms, active: true });
    io.to(roomId).emit("breakout-started", { breakoutRooms });
  });
  socket.on("breakout-assign", ({ roomId, targetSocketId, breakoutRoomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(targetSocketId).emit("breakout-assigned", { breakoutRoomId });
  });
  socket.on("breakout-end", ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    breakoutSessions.delete(roomId);
    io.to(roomId).emit("breakout-ended");
  });
  socket.on("breakout-broadcast", ({ roomId, message }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(roomId).emit("breakout-broadcast-msg", { message, from: "Host" });
  });
  socket.on("breakout-call-back", ({ roomId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    io.to(roomId).emit("breakout-callback");
  });
  socket.on("breakout-get", ({ roomId }) => {
    const session = breakoutSessions.get(roomId);
    socket.emit("breakout-state", session || null);
  });

  // ── Polls ─────────────────────────────────────────────────────────────────
  socket.on("poll-create", ({ roomId, question, options }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    if (!roomPolls.has(roomId)) roomPolls.set(roomId, []);
    const poll = {
      id: require("uuid").v4(),
      question,
      active: true,
      options: options.map((text) => ({ text, votes: [] })),
      createdBy: socketMeta.get(socket.id)?.userName,
      createdAt: new Date(),
    };
    roomPolls.get(roomId).push(poll);
    io.to(roomId).emit("poll-new", poll);
  });
  socket.on("poll-vote", ({ roomId, pollId, optionIndex, userId }) => {
    const polls = roomPolls.get(roomId);
    if (!polls) return;
    const poll = polls.find((p) => p.id === pollId);
    if (!poll || !poll.active) return;
    // Remove previous vote
    poll.options.forEach((o) => {
      o.votes = o.votes.filter((v) => v !== userId);
    });
    if (optionIndex >= 0 && optionIndex < poll.options.length)
      poll.options[optionIndex].votes.push(userId);
    io.to(roomId).emit("poll-updated", poll);
  });
  socket.on("poll-end", ({ roomId, pollId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    const polls = roomPolls.get(roomId);
    if (!polls) return;
    const poll = polls.find((p) => p.id === pollId);
    if (poll) {
      poll.active = false;
      io.to(roomId).emit("poll-updated", poll);
    }
  });
  socket.on("poll-get-all", ({ roomId }) => {
    socket.emit("poll-all", roomPolls.get(roomId) || []);
  });

  // ── Q&A ───────────────────────────────────────────────────────────────────
  socket.on("qna-ask", ({ roomId, text, askerName, askerId, anonymous }) => {
    if (!roomQnA.has(roomId)) roomQnA.set(roomId, []);
    const q = {
      id: require("uuid").v4(),
      text,
      askerId,
      askerName: anonymous ? "Anonymous" : askerName,
      upvotes: [],
      answered: false,
      pinned: false,
      createdAt: new Date(),
    };
    roomQnA.get(roomId).push(q);
    io.to(roomId).emit("qna-new", q);
  });
  socket.on("qna-upvote", ({ roomId, questionId, userId }) => {
    const qs = roomQnA.get(roomId);
    if (!qs) return;
    const q = qs.find((x) => x.id === questionId);
    if (!q) return;
    if (q.upvotes.includes(userId))
      q.upvotes = q.upvotes.filter((v) => v !== userId);
    else q.upvotes.push(userId);
    io.to(roomId).emit("qna-updated", q);
  });
  socket.on("qna-mark-answered", ({ roomId, questionId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    const qs = roomQnA.get(roomId);
    if (!qs) return;
    const q = qs.find((x) => x.id === questionId);
    if (q) {
      q.answered = !q.answered;
      io.to(roomId).emit("qna-updated", q);
    }
  });
  socket.on("qna-pin", ({ roomId, questionId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    const qs = roomQnA.get(roomId);
    if (!qs) return;
    qs.forEach((q) => (q.pinned = false));
    const q = qs.find((x) => x.id === questionId);
    if (q) {
      q.pinned = !q.pinned;
      io.to(roomId).emit("qna-all", qs);
    }
  });
  socket.on("qna-dismiss", ({ roomId, questionId }) => {
    if (roomHosts.get(roomId) !== socket.id) return;
    const qs = roomQnA.get(roomId);
    if (!qs) return;
    roomQnA.set(
      roomId,
      qs.filter((q) => q.id !== questionId),
    );
    io.to(roomId).emit("qna-all", roomQnA.get(roomId));
  });
  socket.on("qna-get-all", ({ roomId }) => {
    socket.emit("qna-all", roomQnA.get(roomId) || []);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    secretQueue.delete(socket.id);
    const meta = socketMeta.get(socket.id);
    if (meta) {
      const { roomId, userName } = meta;
      socket.to(roomId).emit("user-left", { socketId: socket.id, userName });
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          knockQueue.delete(roomId);
          roomPrivacy.delete(roomId);
        }
      }
      if (roomHosts.get(roomId) === socket.id) roomHosts.delete(roomId);
      socketMeta.delete(socket.id);
      Room.findOneAndUpdate(
        { roomId },
        { participantCount: rooms.has(roomId) ? rooms.get(roomId).size : 0 },
      ).catch(() => {});
      console.log(`[-] ${userName} left ${roomId}`);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/quantummeet";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () =>
      console.log(`🚀 Server on http://localhost:${PORT}`),
    );
  })
  .catch((err) => {
    console.warn("⚠️  No DB, running in-memory:", err.message);
    server.listen(PORT, () =>
      console.log(`🚀 Server on http://localhost:${PORT} (no DB)`),
    );
  });

// ═══════════════════════════════════════════════════════════════════════════
// BREAKOUT ROOMS
// ═══════════════════════════════════════════════════════════════════════════
// Map: roomId → { rooms: [{id, name, participants:[socketId]}], active: bool }
const breakoutSessions = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// POLLS
// ═══════════════════════════════════════════════════════════════════════════
// Map: roomId → [{ id, question, options:[{text,votes:[userId]}], active, createdBy }]
const roomPolls = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// Q&A
// ═══════════════════════════════════════════════════════════════════════════
// Map: roomId → [{ id, text, askerName, askerId, upvotes:[userId], answered, pinned, createdAt }]
const roomQnA = new Map();
