require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
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

// ── Security headers ──────────────────────────────────────────────────────────
// Adds X-Frame-Options, X-XSS-Protection, Content-Security-Policy, etc.
app.use(
  helmet({
    // Allow socket.io's long-polling and WebSocket connections
    contentSecurityPolicy: false,
  }),
);

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

// ── Auth routes (public — no JWT required) ────────────────────────────────────
const authRouter = require("./routes/authRoutes");
app.use("/api/auth", authRouter);

// ── Classroom API (JWT protected — see classroom.js) ─────────────────────────
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

// ─── In-memory state ──────────────────────────────────────────────────────────
// Map: roomId → Map<socketId, { socketId, userId, userName }>
const rooms = new Map();
// Map: socketId → { roomId, userId, userName }
const socketMeta = new Map();
// Map: roomId → hostUserId
const roomHosts = new Map();
// Map: roomId → current host socketId
const roomHostSockets = new Map();
// Map: roomId → Map<socketId, { userId, userName }> (pending knock requests)
const knockQueue = new Map();
// Map: roomId → boolean (isPublic)
const roomPrivacy = new Map();
// Map: roomId → Map<userId, socketId>
const roomUserSockets = new Map();
// Map: roomId → Message[] (in-memory chat — auto-cleared when room empties)
const roomMessages = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// BREAKOUT / POLLS / Q&A state
// ═══════════════════════════════════════════════════════════════════════════
const breakoutSessions = new Map();
const roomPolls = new Map();
const roomQnA = new Map();

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
    const liveCount = rooms.has(req.params.roomId)
      ? rooms.get(req.params.roomId).size
      : 0;
    if (roomData)
      return res.json({ ...roomData.toObject(), participantCount: liveCount });
    if (rooms.has(req.params.roomId)) {
      const isPublic = roomPrivacy.has(req.params.roomId)
        ? roomPrivacy.get(req.params.roomId)
        : false;
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

// List public live rooms
app.get("/api/rooms", async (req, res) => {
  try {
    const liveRoomIds = [...rooms.keys()].filter(
      (id) => rooms.get(id).size > 0,
    );
    let publicRooms = [];
    try {
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

  // ── Join room ────────────────────────────────────────────────────────────────
  socket.on("join-room", ({ roomId, userId, userName, isHost }) => {
    socket.join(roomId);
    socketMeta.set(socket.id, { roomId, userId, userName });

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { socketId: socket.id, userId, userName });

    if (!roomUserSockets.has(roomId)) roomUserSockets.set(roomId, new Map());
    roomUserSockets.get(roomId).set(userId, socket.id);

    const storedHostUserId = roomHosts.get(roomId);
    const resolvedIsHost = isHost || storedHostUserId === userId;
    if (resolvedIsHost) {
      roomHosts.set(roomId, userId);
      roomHostSockets.set(roomId, socket.id);
    }

    socket
      .to(roomId)
      .emit("user-joined", { socketId: socket.id, userId, userName });

    const peers = [];
    rooms.get(roomId).forEach((peer, sid) => {
      if (sid !== socket.id) peers.push(peer);
    });
    socket.emit("existing-peers", peers);

    // Send chat history to the new participant
    socket.emit("chat-history", roomMessages.get(roomId) || []);

    if (resolvedIsHost) {
      socket.emit("host-status-confirmed", { isHost: true });
      const pendingKnocks = knockQueue.get(roomId);
      if (pendingKnocks && pendingKnocks.size > 0) {
        pendingKnocks.forEach(
          ({ socketId: kSid, userId: kUid, userName: kName }) => {
            socket.emit("knock-request", {
              socketId: kSid,
              userId: kUid,
              userName: kName,
            });
          },
        );
      }
    }

    Room.findOneAndUpdate(
      { roomId },
      { participantCount: rooms.get(roomId).size },
    ).catch(() => {});
    console.log(
      `[room:${roomId}] ${userName} joined${resolvedIsHost ? " (host)" : ""}. Total: ${rooms.get(roomId).size}`,
    );
  });

  // ── Rejoin room ──────────────────────────────────────────────────────────────
  socket.on("rejoin-room", ({ roomId, userId, userName }) => {
    socket.join(roomId);
    socketMeta.set(socket.id, { roomId, userId, userName });

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    if (!roomUserSockets.has(roomId)) roomUserSockets.set(roomId, new Map());

    const userSocketMap = roomUserSockets.get(roomId);
    const oldSocketId = userSocketMap.get(userId);

    if (oldSocketId && oldSocketId !== socket.id) {
      if (rooms.get(roomId).has(oldSocketId)) {
        rooms.get(roomId).delete(oldSocketId);
        socketMeta.delete(oldSocketId);
        socket
          .to(roomId)
          .emit("user-left", { socketId: oldSocketId, userName });
        console.log(
          `[room:${roomId}] cleaned stale socket ${oldSocketId} for ${userName}`,
        );
      }
    }

    rooms.get(roomId).set(socket.id, { socketId: socket.id, userId, userName });
    userSocketMap.set(userId, socket.id);

    const storedHostUserId = roomHosts.get(roomId);
    if (storedHostUserId === userId) {
      roomHostSockets.set(roomId, socket.id);
      socket.emit("host-status-confirmed", { isHost: true });
      const pendingKnocks = knockQueue.get(roomId);
      if (pendingKnocks && pendingKnocks.size > 0) {
        pendingKnocks.forEach(
          ({ socketId: kSid, userId: kUid, userName: kName }) => {
            socket.emit("knock-request", {
              socketId: kSid,
              userId: kUid,
              userName: kName,
            });
          },
        );
      }
    }

    socket
      .to(roomId)
      .emit("user-rejoined", { socketId: socket.id, userId, userName });

    const peers = [];
    rooms.get(roomId).forEach((peer, sid) => {
      if (sid !== socket.id) peers.push(peer);
    });
    socket.emit("existing-peers", peers);

    // Send chat history on rejoin too
    socket.emit("chat-history", roomMessages.get(roomId) || []);

    Room.findOneAndUpdate(
      { roomId },
      { participantCount: rooms.get(roomId).size },
    ).catch(() => {});
    console.log(
      `[room:${roomId}] ${userName} rejoined (new sid: ${socket.id}). Total: ${rooms.get(roomId).size}`,
    );
  });

  // ── Knock ────────────────────────────────────────────────────────────────────
  socket.on("knock", ({ roomId, userId, userName }) => {
    if (roomHosts.get(roomId) === userId) {
      socket.emit("knock-accepted", { roomId });
      return;
    }

    if (!knockQueue.has(roomId)) knockQueue.set(roomId, new Map());
    const queue = knockQueue.get(roomId);

    for (const [sid, entry] of queue.entries()) {
      if (entry.userId === userId && sid !== socket.id) {
        queue.delete(sid);
        console.log(
          `[room:${roomId}] replaced stale knock for ${userName} (old sid: ${sid})`,
        );
      }
    }

    queue.set(socket.id, { userId, userName, socketId: socket.id });

    const hostSocketId = roomHostSockets.get(roomId);
    if (hostSocketId) {
      io.to(hostSocketId).emit("knock-request", {
        socketId: socket.id,
        userId,
        userName,
      });
    } else {
      socket.emit("knock-waiting", { roomId });
    }
  });

  // ── Screen share ─────────────────────────────────────────────────────────────
  socket.on("screen-share-stopped", ({ roomId }) => {
    socket.to(roomId).emit("peer-screen-stopped", { socketId: socket.id });
  });

  // ── Admit / reject knock ──────────────────────────────────────────────────────
  socket.on("admit-user", ({ roomId, socketId: targetSocketId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || roomHosts.get(roomId) !== meta.userId) return;

    const queue = knockQueue.get(roomId);
    let resolvedSocketId = targetSocketId;
    let knockEntry = null;

    if (queue) {
      knockEntry = queue.get(targetSocketId);
      if (knockEntry) {
        const userSocketMap = roomUserSockets.get(roomId);
        if (userSocketMap && knockEntry.userId) {
          const currentSid = userSocketMap.get(knockEntry.userId);
          if (currentSid) resolvedSocketId = currentSid;
        }
        queue.delete(targetSocketId);
        if (resolvedSocketId !== targetSocketId) queue.delete(resolvedSocketId);
      }
    }

    io.to(resolvedSocketId).emit("knock-accepted", { roomId });
    console.log(
      `[room:${roomId}] admitted ${knockEntry?.userName || targetSocketId} (sid: ${resolvedSocketId})`,
    );
  });

  socket.on("reject-user", ({ roomId, socketId: targetSocketId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || roomHosts.get(roomId) !== meta.userId) return;

    const queue = knockQueue.get(roomId);
    let resolvedSocketId = targetSocketId;
    if (queue) {
      const entry = queue.get(targetSocketId);
      if (entry) {
        const userSocketMap = roomUserSockets.get(roomId);
        if (userSocketMap && entry.userId) {
          const currentSid = userSocketMap.get(entry.userId);
          if (currentSid) resolvedSocketId = currentSid;
        }
        queue.delete(targetSocketId);
        if (resolvedSocketId !== targetSocketId) queue.delete(resolvedSocketId);
      }
    }
    io.to(resolvedSocketId).emit("knock-rejected", { roomId });
  });

  socket.on("host-joined", ({ roomId }) => {
    const meta = socketMeta.get(socket.id);
    if (meta && roomHosts.get(roomId) === meta.userId) {
      roomHostSockets.set(roomId, socket.id);
    }
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

  // ── Kick ──────────────────────────────────────────────────────────────────────
  socket.on("kick-user", ({ roomId, targetSocketId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    if (roomHosts.get(roomId) !== meta.userId) return;
    io.to(targetSocketId).emit("kicked");
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
        if (roomUserSockets.has(roomId))
          roomUserSockets.get(roomId).delete(tMeta.userId);
        socketMeta.delete(targetSocketId);
      }
    }
  });

  // ── WebRTC signaling ──────────────────────────────────────────────────────────
  socket.on("offer", ({ to, offer, from, userName }) =>
    io.to(to).emit("offer", { from, offer, userName }),
  );
  socket.on("answer", ({ to, answer, from }) =>
    io.to(to).emit("answer", { from, answer }),
  );
  socket.on("ice-candidate", ({ to, candidate, from }) =>
    io.to(to).emit("ice-candidate", { from, candidate }),
  );

  // ── Chat ──────────────────────────────────────────────────────────────────────
  socket.on("chat-message", ({ roomId, message, userName, userId }) => {
    // FIX: message length cap — prevents memory abuse from huge pastes
    if (!message?.trim() || message.length > 2000) return;

    const msg = {
      id: uuidv4(),
      message: message.trim(),
      userName,
      userId,
      timestamp: new Date().toISOString(),
    };

    // Store in-memory, capped at 200 messages per room
    if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
    const history = roomMessages.get(roomId);
    history.push(msg);
    if (history.length > 200) history.shift();

    io.to(roomId).emit("chat-message", msg);
  });

  // ── Media toggles ─────────────────────────────────────────────────────────────
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

  // ── Emoji reactions ───────────────────────────────────────────────────────────
  socket.on("room-reaction", ({ roomId, emoji, x, y }) =>
    socket.to(roomId).emit("peer-reaction", { emoji, x, y }),
  );

  // ── Whiteboard ────────────────────────────────────────────────────────────────
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
  socket.on("wb-drawing-start", (data) =>
    socket.to(data.roomId).emit("wb-drawing-start", data),
  );
  socket.on("wb-drawing-stop", (data) =>
    socket.to(data.roomId).emit("wb-drawing-stop", data),
  );

  // ── Host controls ─────────────────────────────────────────────────────────────
  const isRoomHost = (rId) => {
    const m = socketMeta.get(socket.id);
    return m && roomHosts.get(rId) === m.userId;
  };

  socket.on("host-mute-user", ({ roomId, targetSocketId }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("force-mute");
  });
  socket.on("host-unmute-user", ({ roomId, targetSocketId }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("force-unmute");
  });
  socket.on("host-mute-all", ({ roomId }) => {
    if (!isRoomHost(roomId)) return;
    socket.to(roomId).emit("force-mute");
  });
  socket.on("host-stop-video", ({ roomId, targetSocketId }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("force-stop-video");
  });
  socket.on("host-wb-permission", ({ roomId, targetSocketId, allowed }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("wb-permission", { allowed });
  });
  socket.on("host-lower-all-hands", ({ roomId }) => {
    if (!isRoomHost(roomId)) return;
    socket.to(roomId).emit("lower-hand");
  });
  socket.on("raise-hand", ({ roomId, userName: uName }) =>
    socket
      .to(roomId)
      .emit("peer-hand-raise", { socketId: socket.id, userName: uName }),
  );
  socket.on("lower-hand", ({ roomId }) =>
    socket.to(roomId).emit("peer-hand-lower", { socketId: socket.id }),
  );

  // ── SecretMeet ────────────────────────────────────────────────────────────────
  socket.on("secret-join-queue", ({ userId, userName }) => {
    if (secretQueue.has(socket.id)) return;
    secretQueue.set(socket.id, { userId, userName, socketId: socket.id });

    let partner = null;
    for (const [sid, data] of secretQueue.entries()) {
      if (sid !== socket.id) {
        partner = { sid, ...data };
        break;
      }
    }

    if (partner) {
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

  // ── Transcription ─────────────────────────────────────────────────────────────
  socket.on("transcript-share", ({ roomId, text, speakerName, timestamp }) => {
    socket.to(roomId).emit("transcript-line", { text, speakerName, timestamp });
  });
  socket.on("host-grant-transcribe", ({ roomId, targetSocketId, allowed }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("transcribe-permission", { allowed });
  });

  // ── Breakout Rooms ────────────────────────────────────────────────────────────
  socket.on("breakout-create", ({ roomId, breakoutRooms }) => {
    if (!isRoomHost(roomId)) return;
    breakoutSessions.set(roomId, { rooms: breakoutRooms, active: true });
    io.to(roomId).emit("breakout-started", { breakoutRooms });
  });
  socket.on("breakout-assign", ({ roomId, targetSocketId, breakoutRoomId }) => {
    if (!isRoomHost(roomId)) return;
    io.to(targetSocketId).emit("breakout-assigned", { breakoutRoomId });
  });
  socket.on("breakout-end", ({ roomId }) => {
    if (!isRoomHost(roomId)) return;
    breakoutSessions.delete(roomId);
    io.to(roomId).emit("breakout-ended");
  });
  socket.on("breakout-broadcast", ({ roomId, message }) => {
    if (!isRoomHost(roomId)) return;
    io.to(roomId).emit("breakout-broadcast-msg", { message, from: "Host" });
  });
  socket.on("breakout-call-back", ({ roomId }) => {
    if (!isRoomHost(roomId)) return;
    io.to(roomId).emit("breakout-callback");
  });
  socket.on("breakout-get", ({ roomId }) => {
    socket.emit("breakout-state", breakoutSessions.get(roomId) || null);
  });

  // ── Polls ─────────────────────────────────────────────────────────────────────
  socket.on("poll-create", ({ roomId, question, options }) => {
    if (!isRoomHost(roomId)) return;
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
    poll.options.forEach((o) => {
      o.votes = o.votes.filter((v) => v !== userId);
    });
    if (optionIndex >= 0 && optionIndex < poll.options.length)
      poll.options[optionIndex].votes.push(userId);
    io.to(roomId).emit("poll-updated", poll);
  });
  socket.on("poll-end", ({ roomId, pollId }) => {
    if (!isRoomHost(roomId)) return;
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

  // ── Q&A ───────────────────────────────────────────────────────────────────────
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
    if (!isRoomHost(roomId)) return;
    const qs = roomQnA.get(roomId);
    if (!qs) return;
    const q = qs.find((x) => x.id === questionId);
    if (q) {
      q.answered = !q.answered;
      io.to(roomId).emit("qna-updated", q);
    }
  });
  socket.on("qna-pin", ({ roomId, questionId }) => {
    if (!isRoomHost(roomId)) return;
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
    if (!isRoomHost(roomId)) return;
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

  // ── Disconnect ────────────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    secretQueue.delete(socket.id);
    const meta = socketMeta.get(socket.id);
    if (meta) {
      const { roomId, userId, userName } = meta;
      socket.to(roomId).emit("wb-drawing-stop", { roomId, from: socket.id });
      socket.to(roomId).emit("user-left", { socketId: socket.id, userName });
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          knockQueue.delete(roomId);
          roomPrivacy.delete(roomId);
          roomUserSockets.delete(roomId);
          roomHosts.delete(roomId);
          roomHostSockets.delete(roomId);
          // Chat auto-cleaned — no deletion logic needed
          roomMessages.delete(roomId);
        }
      }
      if (roomHostSockets.get(roomId) === socket.id)
        roomHostSockets.delete(roomId);
      if (roomUserSockets.has(roomId)) {
        const userSocketMap = roomUserSockets.get(roomId);
        if (userSocketMap.get(userId) === socket.id)
          userSocketMap.delete(userId);
      }
      socketMeta.delete(socket.id);
      Room.findOneAndUpdate(
        { roomId },
        { participantCount: rooms.has(roomId) ? rooms.get(roomId).size : 0 },
      ).catch(() => {});
      console.log(`[-] ${userName} (${reason}) left ${roomId}`);
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
