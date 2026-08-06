const express = require("express");
const { publishDueScheduledPosts } = require("./lib/scheduledPosts");

const router = express.Router();

function authorizeCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Local / unset: allow (dev). Production should set CRON_SECRET.
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      return res.status(401).json({ error: "CRON_SECRET not configured" });
    }
    return next();
  }
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = req.query.secret;
  if (bearer === secret || query === secret) return next();
  return res.status(401).json({ error: "Unauthorized cron" });
}

router.get("/scheduled-posts", authorizeCron, async (_req, res) => {
  try {
    const metrics = require("./lib/metrics");
    metrics.inc("cronRuns");
    const result = await publishDueScheduledPosts();
    if (result.count) metrics.inc("cronPublished", result.count);
    require("./lib/log").info("cron_scheduled_posts", { count: result.count });
    res.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    require("./lib/log").error("cron_scheduled_posts_failed", { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post("/scheduled-posts", authorizeCron, async (_req, res) => {
  try {
    const metrics = require("./lib/metrics");
    metrics.inc("cronRuns");
    const result = await publishDueScheduledPosts();
    if (result.count) metrics.inc("cronPublished", result.count);
    require("./lib/log").info("cron_scheduled_posts", { count: result.count });
    res.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    require("./lib/log").error("cron_scheduled_posts_failed", { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

/** Purge recordings older than RECORDING_RETENTION_DAYS (default 30). */
async function runRecordingRetention(_req, res) {
  try {
    const days = Number(process.env.RECORDING_RETENTION_DAYS || 30);
    const cutoff = new Date(Date.now() - days * 86400_000);
    const { Recording } = require("./models/platform");
    const stale = await Recording.find({ createdAt: { $lt: cutoff } }).limit(100);
    let deleted = 0;
    let blobErrors = 0;
    for (const row of stale) {
      if (row.blobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const { del } = require("@vercel/blob");
          await del(row.blobUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch {
          blobErrors += 1;
        }
      }
      await Recording.deleteOne({ _id: row._id });
      deleted += 1;
    }
    require("./lib/metrics").inc("recordingPurges", deleted);
    require("./lib/log").info("cron_recording_retention", {
      deleted,
      blobErrors,
      days,
    });
    res.json({ ok: true, deleted, blobErrors, days, at: new Date().toISOString() });
  } catch (err) {
    require("./lib/log").error("cron_recording_retention_failed", {
      err: err.message,
    });
    res.status(500).json({ error: err.message });
  }
}

router.get("/recordings-retention", authorizeCron, runRecordingRetention);
router.post("/recordings-retention", authorizeCron, runRecordingRetention);

async function runPresenceGc(_req, res) {
  try {
    const { gcStalePresence } = require("./lib/events");
    const result = await gcStalePresence({ limit: 500 });
    require("./lib/log").info("cron_presence_gc", result);
    res.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    require("./lib/log").error("cron_presence_gc_failed", { err: err.message });
    res.status(500).json({ error: err.message });
  }
}

router.get("/presence-gc", authorizeCron, runPresenceGc);
router.post("/presence-gc", authorizeCron, runPresenceGc);

module.exports = router;
