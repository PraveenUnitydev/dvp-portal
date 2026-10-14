const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const sso = require("../utils/sso");
const settings = require("../utils/settings");

const router = express.Router();
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again in 15 minutes." } });
const ssoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again in a few minutes." } });

const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, email: u.email || "", source: u.source || "local" });
const issue = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "8h" });

// ── Local accounts (fallback) ───────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ message: "Enter your username and password." });

  const user = await User.findOne({ username });
  const invalid = () => res.status(401).json({ message: "Username or password is incorrect." });
  // Microsoft sign-in accounts have no password: they can't sign in here
  if (!user || !user.active || !user.passwordHash) return invalid();

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
  user.failedLogins = 0; user.lockUntil = null; user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: issue(user), user: publicUser(user) });
});

// ── Microsoft sign-in through VRSP ──────────────────────────────────────
// GET /api/auth/sso-config - whether to show "Sign in with Microsoft"
router.get("/sso-config", (req, res) => res.json({ enabled: sso.config().enabled }));

// GET /api/auth/sso-start - off to VRSP, which signs the person in with Microsoft and sends them back to /login
router.get("/sso-start", (req, res) => {
  const c = sso.config();
  // relative, so it works at /dvp/ as well as at the site root
  if (!c.enabled) return res.redirect("../../login?error=sso_unavailable");
  res.redirect(c.startUrl);
});

// POST /api/auth/sso-exchange { code } - the code VRSP sent the browser back with: collect the identity from VRSP,
// find or create the account, decide access, and sign in
router.post("/sso-exchange", ssoLimiter, async (req, res) => {
  try {
    const r = await sso.collect(req.body?.code);
    if (r.error) return res.status(r.status).json({ message: r.error });
    const id = r.identity;
    const admins = sso.adminEmails();
    const listedAdmin = id.emails.some((e) => admins.has(e));

    let user = await User.findOne({ $or: [{ emails: { $in: id.emails } }, { username: { $in: id.emails } }] });
    if (!user) {
      const s = await settings.get();
      const open = listedAdmin || s.ssoNewUsersGetAccess;
      user = await User.create({
        username: id.email, name: id.name, source: "sso", email: id.email, emails: id.emails,
        jobTitle: id.jobTitle, department: id.department,
        role: listedAdmin ? "ADMIN" : "USER", active: open, pending: !open,
      });
      console.log(`SSO: new account ${open ? `(${user.role})` : "waiting for approval"}`);
    } else {
      user.name = id.name || user.name;
      user.email = user.email || id.email;
      user.emails = [...new Set([...(user.emails || []), ...id.emails])];
      if (id.jobTitle) user.jobTitle = id.jobTitle;
      if (id.department) user.department = id.department;
      if (user.source !== "local") user.source = "sso";
      // ADMIN_EMAILS is the way in for the first admins (and back in if someone removed them by mistake)
      if (listedAdmin && (user.role !== "ADMIN" || !user.active || user.pending)) {
        user.role = "ADMIN"; user.active = true; user.pending = false;
        console.log("SSO: admin from ADMIN_EMAILS");
      }
    }

    if (user.pending) {
      await user.save();
      return res.status(403).json({ pending: true, message: "Thanks for signing in. Your access to the DVP portal is waiting for an admin's approval. Try again once they have approved you." });
    }
    if (!user.active) {
      await user.save();
      return res.status(403).json({ message: "Your access to the DVP portal has been turned off. Ask a DVP portal admin if you need it back." });
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: issue(user), user: publicUser(user) });
  } catch (err) {
    console.error("SSO exchange failed:", err.message);
    res.status(500).json({ message: "Sign-in failed. Try again." });
  }
});

router.get("/me", requireAuth(), (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
