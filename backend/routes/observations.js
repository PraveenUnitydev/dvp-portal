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
const { UPLOAD_OBSERVATION_DIR } = require("../config");
const { sniffImage } = require("../utils/validation");
const { findProgram, dvpNumber, isApplicable, toRow, DVP_CODE } = require("./programs").helpers;

// Observation images: supporting pictures for one DVP in one program, added during the assessment. Anyone who can
// update a DVP can add them; a picture can be removed by the person who added it, or by an admin.
const router = express.Router();
const MAX_PER_DVP = Number(process.env.OBSERVATION_MAX_IMAGES) || 12;
const MAX_PER_UPLOAD = 6;
const MAX_IMAGE_MB = 5;
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const FILE = /^[a-f0-9]{24}-\d{1,2}\.(png|jpg|webp)$/;

// Per person, not per address: a whole office can share one address
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.OBSERVATION_WRITE_LIMIT) || 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { message: "Too many image changes in a short time. Wait a few minutes and try again." },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: MAX_PER_UPLOAD, fields: 5, parts: MAX_PER_UPLOAD + 5 } });
const receiveImages = (req, res, next) => upload.array("images", MAX_PER_UPLOAD)(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({
    message: err.code === "LIMIT_FILE_SIZE" ? `Each image can be at most ${MAX_IMAGE_MB} MB.`
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Add at most ${MAX_PER_UPLOAD} images at a time.`
      : "The images could not be read. Try again.",
  });
});
const safeName = (n) => String(n || "file").replace(/[^\w.\- ]/g, "").slice(0, 60) || "file";
const removeQuietly = (names) => names.forEach((n) => { try { fs.unlinkSync(path.join(UPLOAD_OBSERVATION_DIR, n)); } catch { /* already gone */ } });

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
const rowJson = async (ctx, row) => toRow(ctx.program, ctx.dvp, row, await LopEntry.countDocuments({ program: ctx.program._id, dvp: ctx.dvp._id }));

// POST /api/programs/:code/dvps/:dvpCode/observations - add pictures (multipart: images). Returns the updated DVP row.
router.post("/programs/:code/dvps/:dvpCode/observations", requireAuth(["ADMIN", "USER"]), limiter, receiveImages, async (req, res) => {
  let written = [];
  try {
    const ctx = await loadRow(req, res);
    if (!ctx) return;
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ message: "Choose at least one image." });
    const kinds = [];
    for (const f of files) {
      const kind = sniffImage(f.buffer);
      if (!kind) return res.status(400).json({ message: `"${safeName(f.originalname)}" is not a PNG, JPEG or WebP image.` });
      kinds.push(kind);
    }
    const have = (ctx.row.observations || []).length;
    if (have + files.length > MAX_PER_DVP) {
      return res.status(409).json({ message: `A DVP can have at most ${MAX_PER_DVP} observation images. ${ctx.number} has ${have}${have < MAX_PER_DVP ? `, so you can add ${MAX_PER_DVP - have} more` : ""}.` });
    }

    // Files first, then the record. The record is only added while there is still room (checked by the database
    // in the same step, so two people adding at once can't go over the limit); otherwise the files are removed.
    const batch = new mongoose.Types.ObjectId();
    const names = files.map((f, i) => `${batch}-${i + 1}.${kinds[i].ext}`);
    fs.mkdirSync(UPLOAD_OBSERVATION_DIR, { recursive: true });
    files.forEach((f, i) => { fs.writeFileSync(path.join(UPLOAD_OBSERVATION_DIR, names[i]), f.buffer); written.push(names[i]); });

    const by = { userId: req.user._id, username: req.user.username, name: req.user.name };
    const now = new Date();
    const row = await ProgramDvp.findOneAndUpdate(
      { _id: ctx.row._id, ...isApplicable, [`observations.${MAX_PER_DVP - files.length}`]: { $exists: false } },
      { $push: { observations: { $each: names.map((file) => ({ file, uploadedBy: by, uploadedAt: now })) } }, $set: { updatedBy: req.user.name } },
      { new: true }).lean();
    if (!row) {
      removeQuietly(written); written = [];
      return res.status(409).json({ message: `Someone else has just added images: ${ctx.number} now has too many to add ${files.length} more. Reload and try again.` });
    }
    written = [];
    console.log(`${names.length} observation image(s) added to ${ctx.number} by ${req.user.name}`);
    res.status(201).json(await rowJson(ctx, row));
  } catch (err) {
    removeQuietly(written);        // never leave pictures without their record
    console.error("POST observations failed:", err.message);
    res.status(500).json({ message: "Could not save the images." });
  }
});

// DELETE /api/programs/:code/dvps/:dvpCode/observations/:file - remove one picture (its uploader, or an admin)
router.delete("/programs/:code/dvps/:dvpCode/observations/:file", requireAuth(["ADMIN", "USER"]), limiter, async (req, res) => {
  try {
    const ctx = await loadRow(req, res);
    if (!ctx) return;
    const file = String(req.params.file || "");
    const item = FILE.test(file) && (ctx.row.observations || []).find((o) => o.file === file);
    if (!item) return res.status(404).json({ message: "This image was not found. It may have been removed already." });
    if (req.user.role !== "ADMIN" && String(item.uploadedBy?.userId) !== String(req.user._id)) {
      return res.status(403).json({ message: `Only ${item.uploadedBy?.name || "the person who added it"} or an admin can remove this image.` });
    }
    const row = await ProgramDvp.findOneAndUpdate(
      { _id: ctx.row._id, "observations.file": file },
      { $pull: { observations: { file } }, $set: { updatedBy: req.user.name } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ message: "This image was not found. It may have been removed already." });
    removeQuietly([file]);
    console.log(`Observation image ${file} removed from ${ctx.number} by ${req.user.name}`);
    res.json(await rowJson(ctx, row));
  } catch (err) {
    console.error("DELETE observation failed:", err.message);
    res.status(500).json({ message: "Could not remove the image." });
  }
});

// GET /api/observation-images/:file - signed-in people only
router.get("/observation-images/:file", requireAuth(), (req, res) => {
  const file = String(req.params.file || "");
  if (!FILE.test(file)) return res.status(404).json({ message: "Not found." });
  const full = path.join(UPLOAD_OBSERVATION_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ message: "Not found." });
  res.set({ "Content-Type": MIME[file.split(".").pop()], "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" });
  res.sendFile(full);
});

module.exports = router;
module.exports.limits = { MAX_PER_DVP, MAX_PER_UPLOAD, MAX_IMAGE_MB };
