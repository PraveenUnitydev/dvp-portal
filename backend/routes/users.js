const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

// Admin: who can use the portal. People appear here when they first sign in with Microsoft; an admin approves them,
// sets their role, or turns their access off. Changes apply on the person's next request (requireAuth re-reads the
// account every time).
const router = express.Router();
router.use("/admin/users", requireAuth(["ADMIN"]));

const userJson = (u) => ({
  id: String(u._id), username: u.username, name: u.name, email: u.email || "", source: u.source || "local",
  jobTitle: u.jobTitle || "", department: u.department || "",
  role: u.role, active: Boolean(u.active), pending: Boolean(u.pending),
  lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt || null,
});

// GET /api/admin/users - waiting for approval first, then by name
router.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-passwordHash -failedLogins -lockUntil").lean();
    users.sort((a, b) => Number(Boolean(b.pending)) - Number(Boolean(a.pending)) || String(a.name).localeCompare(String(b.name)));
    res.json({ users: users.map(userJson) });
  } catch (err) {
    console.error("GET /admin/users failed:", err.message);
    res.status(500).json({ message: "Could not load the users." });
  }
});

// PATCH /api/admin/users/:id { role?, active? } - approving someone is active: true
router.patch("/admin/users/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "User not found." });
    const body = req.body || {};
    const changes = {};
    if ("role" in body) {
      if (!["ADMIN", "USER"].includes(body.role)) return res.status(400).json({ message: "Role must be Admin or User." });
      changes.role = body.role;
    }
    if ("active" in body) {
      if (typeof body.active !== "boolean") return res.status(400).json({ message: "Access must be on or off." });
      changes.active = body.active;
    }
    if (!Object.keys(changes).length) return res.status(400).json({ message: "Nothing to change." });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found." });
    const self = String(user._id) === String(req.user._id);
    if (self && (changes.role === "USER" || changes.active === false)) {
      return res.status(400).json({ message: "You can't remove your own admin access. Ask another admin." });
    }
    // Never leave the portal without an admin who can get in
    const losingAdmin = user.role === "ADMIN" && user.active && (changes.role === "USER" || changes.active === false);
    if (losingAdmin) {
      const others = await User.countDocuments({ role: "ADMIN", active: true, _id: { $ne: user._id } });
      if (others === 0) return res.status(400).json({ message: "This is the only admin. Make someone else an admin first." });
    }
    Object.assign(user, changes);
    if ("active" in changes) user.pending = false;    // approved, or declined: either way no longer waiting
    await user.save();
    console.log(`User ${user.username}: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ")} by ${req.user.name}`);
    res.json(userJson(user.toObject ? user.toObject() : user));
  } catch (err) {
    console.error("PATCH /admin/users/:id failed:", err.message);
    res.status(500).json({ message: "Could not save the change." });
  }
});

module.exports = router;
