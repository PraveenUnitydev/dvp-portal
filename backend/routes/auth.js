const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again in 15 minutes." } });

const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role });

router.post("/login", loginLimiter, async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ message: "Enter your username and password." });

  const user = await User.findOne({ username });
  const invalid = () => res.status(401).json({ message: "Username or password is incorrect." });
  if (!user || !user.active) return invalid();

  if (user.lockUntil && user.lockUntil > new Date()) {
    const mins = Math.ceil((user.lockUntil - new Date()) / 60000);
    return res.status(423).json({ message: `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    user.failedLogins += 1;
    if (user.failedLogins >= MAX_FAILED) { user.lockUntil = new Date(Date.now() + LOCK_MS); user.failedLogins = 0; }
    await user.save();
    return invalid();
  }
  user.failedLogins = 0; user.lockUntil = null;
  await user.save();

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth(), (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
