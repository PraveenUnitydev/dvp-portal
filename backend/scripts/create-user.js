/**
 * Create or reset a portal account.
 *   node scripts/create-user.js <username> <ADMIN|USER> "<Full name>"
 * The password is read from the PORTAL_PASSWORD environment variable so it
 * never appears in shell history arguments or the process list:
 *   PORTAL_PASSWORD='...' node scripts/create-user.js admin ADMIN "Portal Admin"
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");

(async () => {
  const [username, role, name] = process.argv.slice(2);
  const password = process.env.PORTAL_PASSWORD || "";
  if (!username || !["ADMIN", "USER"].includes(role) || !name) {
    console.error('Usage: PORTAL_PASSWORD=... node scripts/create-user.js <username> <ADMIN|USER> "<Full name>"');
    process.exit(1);
  }
  if (password.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1); }

  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dvpPortal");
  const passwordHash = await bcrypt.hash(password, 12);
  await User.findOneAndUpdate(
    { username: username.toLowerCase() },
    { username: username.toLowerCase(), name, role, passwordHash, active: true, failedLogins: 0, lockUntil: null },
    { upsert: true, runValidators: true });
  console.log(`Saved ${role} account "${username.toLowerCase()}" (${name}).`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error("Failed:", e.message); await mongoose.disconnect(); process.exit(1); });
