const jwt = require("jsonwebtoken");
const User = require("../models/User");

// requireAuth()           any signed-in, active user
// requireAuth(["ADMIN"])  admins only
exports.requireAuth = (roles = []) => async (req, res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Sign in to continue." });
  try {
    const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    // Re-check the account on every request so a deactivated user or a
    // role change takes effect immediately, not when the token expires
    const user = await User.findById(claims.id).select("username name role active").lean();
    if (!user || !user.active) return res.status(401).json({ message: "Your session has ended. Sign in again." });
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ message: "You don't have permission to do this." });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Your session has ended. Sign in again." });
  }
};
