const mongoose = require("mongoose");

// Portal accounts. Two kinds:
//  - Microsoft sign-in (source "sso"): created at the first sign-in through VRSP's Microsoft sign-in; no password.
//    `username` is the person's primary email. A new account waits for an admin (pending) unless the setting lets
//    first-time sign-ins straight in, or the email is in ADMIN_EMAILS.
//  - Local (source "local"): username + password, made with scripts/create-user.js. Kept as a fallback (e.g. a
//    break-glass admin if Microsoft sign-in is unavailable).
// Only `username`, `name` and `role` are used by the rest of the app.
const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, default: null },
  source:       { type: String, enum: ["local", "sso"], default: "local" },
  // Microsoft sign-in: primary email, and every email the person has been seen with (matched at sign-in)
  email:        { type: String, lowercase: true, trim: true, default: "" },
  emails:       { type: [String], default: [], index: true },
  jobTitle:     { type: String, default: "" },
  department:   { type: String, default: "" },
  role:         { type: String, enum: ["ADMIN", "USER"], default: "USER" },
  active:       { type: Boolean, default: true },
  pending:      { type: Boolean, default: false },   // signed in, waiting for an admin to give access
  lastLoginAt:  { type: Date, default: null },
  failedLogins: { type: Number, default: 0 },
  lockUntil:    { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
