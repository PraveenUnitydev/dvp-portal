require("dotenv").config();
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const PORT = Number(process.env.PORT) || 7100;
// Fail fast rather than run with a missing or guessable signing key (VRSP lesson)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET is missing or shorter than 32 characters. Set it in backend/.env.");
  process.exit(1);
}
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dvpPortal";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind Nginx, same as VRSP

// Security headers (same baseline as VRSP)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'self';");
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (req, res) => res.json({
  status: "ok",
  database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
}));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/programs", require("./routes/programs"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api", (req, res) => res.status(404).json({ message: "Not found." }));

// DVP reference images (from the master sheet). Names change whenever the
// sheet is re-imported, so a day of caching is safe.
app.use("/dvp-images", express.static(path.join(__dirname, "public", "dvp-images"), { maxAge: "1d", fallthrough: false }));

// Serve the built frontend; never cache index.html (lesson from VRSP)
const buildPath = path.join(__dirname, "build");
const noStore = (res) => res.set("Cache-Control", "no-store, no-cache, must-revalidate");
app.use(express.static(buildPath, { setHeaders: (res, f) => { if (f.endsWith(".html")) noStore(res); } }));
app.get(/^(?!\/api).*$/, (req, res) => { noStore(res); res.sendFile(path.join(buildPath, "index.html")); });

console.log(`MongoDB: connecting to ${MONGO_URI.replace(/\/\/.*@/, "//<credentials>@")}`);
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

app.listen(PORT, "0.0.0.0", () => console.log(`DVP Portal running on http://0.0.0.0:${PORT}`));
