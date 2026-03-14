require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// ── User schema ───────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

let User;
try {
  User = mongoose.model("User");
} catch {
  User = mongoose.model("User", userSchema);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    { id: user._id.toString(), name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

const safeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
});

// ── Rate limit — login only (brute force protection) ─────────────────────────
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim())
      return res.status(400).json({ error: "Name is required" });
    if (!email?.trim())
      return res.status(400).json({ error: "Email is required" });
    if (!password)
      return res.status(400).json({ error: "Password is required" });
    if (password.length < 6)
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing)
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
    });

    const token = signToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("[auth] register error:", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", loginLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Generic message — don't reveal whether the email exists
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("[auth] login error:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ── GET /api/auth/me — verify token and return current user ──────────────────
router.get("/me", require("../middleware/auth"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
