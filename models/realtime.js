const mongoose = require("mongoose");

// Meeting-room realtime state that used to live only in server memory
// (roomMessages / roomPolls / roomQnA / breakoutSessions Maps). Vercel
// functions don't share memory across instances, so anything that must
// survive a refresh or a request landing on a different instance has to be
// persisted here instead.

const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  message: { type: String, required: true, maxlength: 2000 },
  userName: { type: String, required: true },
  userId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

const pollSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  question: { type: String, required: true },
  active: { type: Boolean, default: true },
  options: [{ text: String, votes: [String] }],
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

const questionSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  text: { type: String, required: true },
  askerId: { type: String, required: true },
  askerName: { type: String, required: true },
  anonymous: { type: Boolean, default: false },
  upvotes: [String],
  answered: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

const breakoutSessionSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  rooms: [mongoose.Schema.Types.Mixed],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

// Random-pairing queue for "SecretMeet". A joiner atomically claims a
// waiting entry (findOneAndDelete) to pair instantly; if none is waiting,
// it inserts itself and waits for another joiner (or leaves) to claim it.
const secretQueueSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 120 },
});

const knockRequestSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

// Ephemeral fan-out bus (signaling, whiteboard, post-write pushes). Short TTL
// — clients poll; stale ICE/offers must not linger.
const roomEventSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  to: { type: String, default: null, index: true },
  from: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 300, index: true },
});
roomEventSchema.index({ roomId: 1, createdAt: 1 });
roomEventSchema.index({ roomId: 1, createdAt: 1, to: 1 });
roomEventSchema.index({ roomId: 1, from: 1, createdAt: 1 });

const secretInboxSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, expires: 120 },
});

const presenceSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  connectionId: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now, index: true },
});
presenceSchema.index({ roomId: 1, userId: 1, connectionId: 1 }, { unique: true });
presenceSchema.index({ roomId: 1, lastSeen: 1 });

/** One-shot fan-out claim so multi-tab leave doesn't double-publish user-left. */
const leaveClaimSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  userId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 },
});
leaveClaimSchema.index({ roomId: 1, userId: 1 }, { unique: true });

function model(name, schema) {
  try {
    return mongoose.model(name);
  } catch {
    return mongoose.model(name, schema);
  }
}

module.exports = {
  Message: model("Message", messageSchema),
  Poll: model("Poll", pollSchema),
  Question: model("Question", questionSchema),
  BreakoutSession: model("BreakoutSession", breakoutSessionSchema),
  SecretQueueEntry: model("SecretQueueEntry", secretQueueSchema),
  KnockRequest: model("KnockRequest", knockRequestSchema),
  RoomEvent: model("RoomEvent", roomEventSchema),
  SecretInbox: model("SecretInbox", secretInboxSchema),
  Presence: model("Presence", presenceSchema),
  LeaveClaim: model("LeaveClaim", leaveClaimSchema),
};
