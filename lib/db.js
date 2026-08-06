const mongoose = require("mongoose");

// Vercel functions run as separate lambda invocations that can be reused
// while "warm" — caching the connection on `global` survives across warm
// invocations instead of reconnecting (and leaking connections) every request.
let cached = global.__mongooseConn;
if (!cached) {
  cached = global.__mongooseConn = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    // Drop a dead cached handle so the next request opens a fresh pool.
    if (mongoose.connection.readyState === 1) return cached.conn;
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    const MONGO_URI =
      process.env.MONGO_URI || "mongodb://localhost:27017/quantummeet";
    const maxPool = Number(process.env.MONGO_MAX_POOL || 2);
    cached.promise = mongoose
      .connect(MONGO_URI, {
        // Many concurrent lambdas × large pools exhaust Atlas — keep tiny.
        maxPoolSize: Number.isFinite(maxPool) ? Math.max(1, maxPool) : 2,
        minPoolSize: 0,
        maxIdleTimeMS: 10_000,
        serverSelectionTimeoutMS: 5_000,
        heartbeatFrequencyMS: 10_000,
        bufferCommands: false,
      })
      .then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    cached.conn = null;
    throw err;
  }
}

module.exports = { connectDB };
