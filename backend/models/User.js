const mongoose = require("mongoose");

// Local accounts for now. Designed to be replaced by Azure AD SSO (as in
// VRSP): only `username`, `name` and `role` are used by the rest of the app.
const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ["ADMIN", "USER"], default: "USER" },
  active:       { type: Boolean, default: true },
  failedLogins: { type: Number, default: 0 },
  lockUntil:    { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
