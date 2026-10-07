const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");
const LopEntry = require("../models/LopEntry");
const { requireAuth } = require("../middleware/auth");
const { UPLOAD_LOP_DIR } = require("../config");
const { cleanFields, sniffImage } = require("../utils/validation");
const { findProgram, dvpNumber, isApplicable, DVP_CODE } = require("./programs").helpers;

// LOP concerns: raised against a DVP that is marked Red in a program, kept as an append-only history.
// Any signed-in person may raise one (and read them); nobody can edit or delete an entry.
const router = express.Router();
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

// Per person, not per address: a whole office can share one address
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.LOP_WRITE_LIMIT) || 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { message: "Too many LOP entries in a short time. Wait a few minutes and try again." },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES, fields: 20, fieldSize: 64 * 1024, parts: 30 } });
const receiveForm = (req, res, next) => upload.array("images", MAX_IMAGES)(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({
    message: err.code === "LIMIT_FILE_SIZE" ? `Each image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `You can add at most ${MAX_IMAGES} images.`
      : "The form could not be read. Check it and try again.",
  });
});
const safeName = (n) => String(n || "file").replace(/[^\w.\- ]/g, "").slice(0, 60) || "file";

const entryJson = (e) => ({
  id: String(e._id), seq: e.seq, details: e.details, casVersion: e.casVersion || "", cadVersion: e.cadVersion || "",
  images: (e.images || []).map((f) => `/api/lop-images/${f}`),
  raisedBy: { name: e.raisedBy?.name || "", username: e.raisedBy?.username || "", role: e.raisedBy?.role || "" },
  createdAt: e.createdAt,
});

async function loadRow(req, res) {
  const program = await findProgram(req, res);
  if (!program) return null;
  const code = String(req.params.dvpCode || "").toUpperCase();
  if (!DVP_CODE.test(code)) { res.status(400).json({ message: "Invalid DVP number." }); return null; }
  const dvp = await Dvp.findOne({ code }).lean();
  const row = dvp && await ProgramDvp.findOne({ program: program._id, dvp: dvp._id, ...isApplicable }).lean();
  if (!row) { res.status(404).json({ message: `${dvpNumber(program.code, code)} is not part of program ${program.code}.` }); return null; }
  return { program, dvp, row, number: dvpNumber(program.code, dvp.code) };
}

// GET /api/programs/:code/dvps/:dvpCode/lop - the whole history, newest first
router.get("/programs/:code/dvps/:dvpCode/lop", requireAuth(), async (req, res) => {
  try {
    const ctx = await loadRow(req, res);
    if (!ctx) return;
    const entries = await LopEntry.find({ program: ctx.program._id, dvp: ctx.dvp._id }).sort({ seq: -1 }).lean();
    res.json({ dvpNumber: ctx.number, color: ctx.row.color || null, enabled: ctx.row.color === "Red", count: entries.length, entries: entries.map(entryJson) });
  } catch (err) {
    console.error("GET lop failed:", err.message);
    res.status(500).json({ message: "Could not load the LOP concerns." });
  }
});

// POST /api/programs/:code/dvps/:dvpCode/lop - add a new entry (multipart: details, casVersion, cadVersion, images)
router.post("/programs/:code/dvps/:dvpCode/lop", requireAuth(), limiter, receiveForm, async (req, res) => {
  const written = [];
  try {
    const ctx = await loadRow(req, res);
    if (!ctx) return;
    const fail = (message, status = 400) => res.status(status).json({ message });
    if (ctx.row.color !== "Red") {
      return fail(`LOP concerns can only be added while ${ctx.number} is marked Red. It is ${ctx.row.color ? `marked ${ctx.row.color}` : "not coloured"} now.`, 409);
    }
    const text = cleanFields(req.body || {}, {
      details:    { label: "Concern details", max: 4000, required: true },
      casVersion: { label: "CAS version", max: 120 },
      cadVersion: { label: "CAD model version", max: 120 },
    });
    if (text.error) return fail(text.error);
    const v = text.values;
    if (!v.casVersion && !v.cadVersion) return fail("Enter the CAS or CAD model version this concern was found on.");

    const files = req.files || [];
    const kinds = [];
    for (const f of files) {
      const kind = sniffImage(f.buffer);
      if (!kind) return fail(`"${safeName(f.originalname)}" is not a PNG, JPEG or WebP image.`);
      kinds.push(kind);
    }

    const _id = new mongoose.Types.ObjectId();
    const names = files.map((f, i) => `${_id}-${i + 1}.${kinds[i].ext}`);
    const raisedBy = { userId: req.user._id, username: req.user.username, name: req.user.name, role: req.user.role };

    // The next number in this DVP's history. If someone adds an entry at the same moment the unique index refuses the
    // duplicate number and we simply take the next one.
    let entry = null;
    for (let attempt = 0; attempt < 8 && !entry; attempt++) {
      const last = await LopEntry.findOne({ program: ctx.program._id, dvp: ctx.dvp._id }).sort({ seq: -1 }).select("seq").lean();
      try {
        entry = await LopEntry.create({ _id, program: ctx.program._id, dvp: ctx.dvp._id, seq: (last ? last.seq : 0) + 1, ...v, images: names, raisedBy });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
    if (!entry) return fail("Several people are adding entries right now. Try again in a moment.", 503);

    try {
      if (files.length) {
        fs.mkdirSync(UPLOAD_LOP_DIR, { recursive: true });
        files.forEach((f, i) => { fs.writeFileSync(path.join(UPLOAD_LOP_DIR, names[i]), f.buffer); written.push(names[i]); });
      }
    } catch (err) {
      written.forEach((n) => { try { fs.unlinkSync(path.join(UPLOAD_LOP_DIR, n)); } catch { /* already gone */ } });
      await LopEntry.deleteOne({ _id }).catch(() => {});      // never leave an entry whose pictures were not saved
      throw err;
    }
    console.log(`LOP #${entry.seq} raised on ${ctx.number} by ${req.user.name}`);
    res.status(201).json(entryJson(entry.toObject()));
  } catch (err) {
    console.error("POST lop failed:", err.message);
    res.status(500).json({ message: "Could not save the LOP concern." });
  }
});

// GET /api/lop-images/:file - signed-in people only
router.get("/lop-images/:file", requireAuth(), (req, res) => {
  const file = String(req.params.file || "");
  if (!/^[a-f0-9]{24}-[1-4]\.(png|jpg|webp)$/.test(file)) return res.status(404).json({ message: "Not found." });
  const full = path.join(UPLOAD_LOP_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ message: "Not found." });
  res.set({ "Content-Type": MIME[file.split(".").pop()], "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" });
  res.sendFile(full);
});

module.exports = router;
