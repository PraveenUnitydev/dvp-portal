const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Program = require("../models/Program");
const VrReport = require("../models/VrReport");
const { requireAuth } = require("../middleware/auth");
const { UPLOAD_VR_REPORT_DIR } = require("../config");
const { cleanText, sniffDocument, DOC_KINDS, FORMULA_START } = require("../utils/validation");
const { findProgram } = require("./programs").helpers;
const settings = require("../utils/settings");

// VR reports: the lab's own report files (PDF / PowerPoint / Word / Excel), uploaded by an admin for each program.
// Everyone signed in can list and download them; only admins upload and delete.
const router = express.Router();
// The largest file is an admin setting (utils/settings.js); the form reader only enforces the upper bound a setting
// can have, and the current setting is checked once the file has arrived.
const HARD_MAX_MB = settings.DEFS.vrReportMaxMb.max;
const INCOMING = path.join(UPLOAD_VR_REPORT_DIR, ".incoming");
const ID = /^[a-f0-9]{24}$/;
const TAIL_BYTES = 4 * 1024 * 1024;           // a zip lists its files at the end; 4 MB covers thousands of entries
const LINK_SECONDS = 60;
// Download links are signed with a key derived from JWT_SECRET, so a link can never be used as a sign-in token
const linkKey = () => crypto.createHmac("sha256", process.env.JWT_SECRET).update("vr-report-download").digest();

// Big files go straight to disk (never held in memory), into a holding folder until they have been checked
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => fs.mkdir(INCOMING, { recursive: true }, (err) => cb(err, INCOMING)),
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(12).toString("hex")}.part`),
  }),
  limits: { fileSize: HARD_MAX_MB * 1024 * 1024, files: 1, fields: 5, fieldSize: 8 * 1024, parts: 8 },
});
const receiveFile = (req, res, next) => upload.single("file")(req, res, (err) => {
  if (!err) return next();
  removeQuietly(req.file?.path);
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
    message: err.code === "LIMIT_FILE_SIZE" ? `The file is larger than ${HARD_MAX_MB} MB.`
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Upload one file at a time."
      : "The upload could not be read. Try again.",
  });
});
function removeQuietly(file) { if (file) fs.unlink(file, () => {}); }
// Uploads cut off by a server restart leave a part file behind: clear old ones when the server starts
fs.readdir(INCOMING, (err, names) => {
  if (err) return;
  for (const n of names) {
    const f = path.join(INCOMING, n);
    fs.stat(f, (e, st) => { if (!e && Date.now() - st.mtimeMs > 60 * 60 * 1000) removeQuietly(f); });
  }
});

// Browsers send file names as UTF-8 but the form reader takes them as Latin-1: undo that when it fits
function uploadName(raw) {
  let name = String(raw || "");
  const utf8 = Buffer.from(name, "latin1").toString("utf8");
  if (!utf8.includes("�")) name = utf8;
  return name.replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
}
const baseName = (n) => n.replace(/\.[A-Za-z0-9]{1,5}$/, "");

function readHeadTail(file, size) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(Math.min(16, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const tailLen = Math.min(TAIL_BYTES, size);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    return { head, tail };
  } finally { fs.closeSync(fd); }
}

const reportJson = (r) => ({
  id: String(r._id),
  title: r.title,
  notes: r.notes || "",
  ext: r.ext,
  kind: DOC_KINDS[r.ext]?.label || r.ext.toUpperCase(),
  size: r.size,
  fileName: downloadName(r),
  uploadedBy: { name: r.uploadedBy?.name || r.uploadedBy?.username || "" },
  createdAt: r.createdAt,
});
const downloadName = (r) => `${baseName(r.originalName || "") || r.title || "VR report"}.${r.ext}`;
const newestFirst = { createdAt: -1 };

// GET /api/vr-reports - every active program with its VR reports (newest first)
router.get("/vr-reports", requireAuth(), async (req, res) => {
  try {
    const programs = await Program.find({ active: true }).sort({ code: 1 }).lean();
    const reports = await VrReport.find({ program: { $in: programs.map((p) => p._id) } }).sort(newestFirst).lean();
    res.json({
      programs: programs.map((p) => ({
        code: p.code, name: p.name,
        reports: reports.filter((r) => String(r.program) === String(p._id)).map(reportJson),
      })),
    });
  } catch (err) {
    console.error("GET /vr-reports failed:", err.message);
    res.status(500).json({ message: "Could not load the VR reports." });
  }
});

// GET /api/programs/:code/vr-reports - one program's VR reports, newest first
router.get("/programs/:code/vr-reports", requireAuth(), async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const reports = await VrReport.find({ program: program._id }).sort(newestFirst).lean();
    res.json({ program: { code: program.code, name: program.name }, reports: reports.map(reportJson) });
  } catch (err) {
    console.error("GET /programs/:code/vr-reports failed:", err.message);
    res.status(500).json({ message: "Could not load the VR reports." });
  }
});

// A report that may be shown: it exists, its program is active, and its file is on disk
async function loadReport(req, res) {
  const id = String(req.params.id || "");
  const r = ID.test(id) && await VrReport.findById(id).lean();
  const program = r && await Program.findOne({ _id: r.program, active: true }).lean();
  const full = r && path.join(UPLOAD_VR_REPORT_DIR, r.file);
  if (!program || !fs.existsSync(full)) { res.status(404).json({ message: "This VR report is no longer available." }); return null; }
  return { report: r, program, full };
}

// GET /api/vr-reports/:id/link - a one-minute download link. The browser's own download (with progress, and no
// need to hold a big file in the page) can't send the sign-in header, so the signed-in page asks for a link first.
router.get("/vr-reports/:id/link", requireAuth(), async (req, res) => {
  try {
    const ctx = await loadReport(req, res);
    if (!ctx) return;
    const t = jwt.sign({ rid: String(ctx.report._id), by: String(req.user._id) }, linkKey(), { expiresIn: LINK_SECONDS, audience: "vr-report" });
    res.json({ url: `/api/vr-reports/${ctx.report._id}/file?t=${encodeURIComponent(t)}`, fileName: downloadName(ctx.report) });
  } catch (err) {
    console.error("GET /vr-reports/:id/link failed:", err.message);
    res.status(500).json({ message: "Could not prepare the download." });
  }
});

// GET /api/vr-reports/:id/file - the file, with a download link (?t=) or the sign-in header
const linkOrSignIn = (req, res, next) => {
  if (!req.query.t) return requireAuth()(req, res, next);
  try {
    const claims = jwt.verify(String(req.query.t), linkKey(), { audience: "vr-report" });
    if (claims.rid !== String(req.params.id)) throw new Error("wrong report");
    next();
  } catch {
    res.status(403).json({ message: "This download link has expired. Go back to Reports and download it again." });
  }
};
router.get("/vr-reports/:id/file", linkOrSignIn, async (req, res) => {
  try {
    const ctx = await loadReport(req, res);
    if (!ctx) return;
    res.set({ "Content-Type": DOC_KINDS[ctx.report.ext].mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.download(ctx.full, downloadName(ctx.report), { headers: { "Content-Type": DOC_KINDS[ctx.report.ext].mime } }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ message: "Could not send the file." });
    });
  } catch (err) {
    console.error("GET /vr-reports/:id/file failed:", err.message);
    if (!res.headersSent) res.status(500).json({ message: "Could not send the file." });
  }
});

// POST /api/programs/:code/vr-reports - admin uploads a report (multipart: file, title, notes)
router.post("/programs/:code/vr-reports", requireAuth(["ADMIN"]), async (req, res, next) => {
  // Check the program before taking a big upload
  try { if (await findProgram(req, res)) next(); } catch (err) { next(err); }
}, receiveFile, async (req, res) => {
  const temp = req.file?.path;
  let stored = null;
  try {
    const program = await findProgram(req, res);
    if (!program) return removeQuietly(temp);
    const fail = (message, status = 400) => { removeQuietly(temp); res.status(status).json({ message }); };
    if (!req.file) return fail("Choose the report file to upload.");

    const maxMb = (await settings.get()).vrReportMaxMb;
    if (req.file.size > maxMb * 1024 * 1024) return fail(`The file is larger than ${maxMb} MB, the most allowed for a VR report (see Settings).`, 413);
    const { head, tail } = readHeadTail(temp, req.file.size);
    const sniff = sniffDocument(head, tail);
    if (sniff.error) return fail(sniff.error);

    const originalName = uploadName(req.file.originalname);
    const typed = cleanText(req.body?.title, { label: "Title", max: 120 });
    if (typed.error) return fail(typed.error);
    const fromName = baseName(originalName).replace(new RegExp(`^${FORMULA_START.source.slice(1)}+`), "").trim().slice(0, 120);
    const title = typed.value || fromName || `${program.code} VR report`;
    const notes = cleanText(req.body?.notes, { label: "Notes", max: 500 });
    if (notes.error) return fail(notes.error);

    const _id = new mongoose.Types.ObjectId();
    const file = `${_id}.${sniff.kind.ext}`;
    fs.renameSync(temp, path.join(UPLOAD_VR_REPORT_DIR, file));
    stored = file;
    const doc = await VrReport.create({
      _id, program: program._id, title, notes: notes.value, file, ext: sniff.kind.ext, originalName, size: req.file.size,
      uploadedBy: { userId: req.user._id, username: req.user.username, name: req.user.name },
    });
    console.log(`VR report "${title}" (${sniff.kind.label}, ${req.file.size} bytes) uploaded for ${program.code} by ${req.user.name}`);
    res.status(201).json(reportJson(doc.toObject ? doc.toObject() : doc));
  } catch (err) {
    removeQuietly(temp);
    if (stored) removeQuietly(path.join(UPLOAD_VR_REPORT_DIR, stored));   // never keep a file without its record
    console.error("POST vr-reports failed:", err.message);
    if (!res.headersSent) res.status(500).json({ message: "Could not save the VR report." });
  }
});

// DELETE /api/vr-reports/:id - admin removes a report and its file
router.delete("/vr-reports/:id", requireAuth(["ADMIN"]), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const r = ID.test(id) && await VrReport.findById(id).lean();
    if (!r) return res.status(404).json({ message: "This VR report was not found." });
    await VrReport.deleteOne({ _id: r._id });
    removeQuietly(path.join(UPLOAD_VR_REPORT_DIR, r.file));
    console.log(`VR report "${r.title}" deleted by ${req.user.name}`);
    res.json({ deleted: String(r._id) });
  } catch (err) {
    console.error("DELETE /vr-reports/:id failed:", err.message);
    res.status(500).json({ message: "Could not delete the VR report." });
  }
});

module.exports = router;
module.exports.helpers = { uploadName, downloadName };
