const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const Dvp = require("../models/Dvp");
const Program = require("../models/Program");
const ProgramDvp = require("../models/ProgramDvp");
const { requireAuth } = require("../middleware/auth");
const { UPLOAD_IMAGE_DIR } = require("../config");
const { cleanText, cleanFields, sniffImage } = require("../utils/validation");
const { findProgram, testNumber, isApplicable, DVP_CODE, PROGRAM_CODE } = require("./programs").helpers;

const router = express.Router();
router.use(requireAuth(["ADMIN"]));

// GET /api/admin/programs/:code/catalog - every catalog DVP, flagged with
// whether it's switched on for this program
router.get("/programs/:code/catalog", async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const [catalog, rows] = await Promise.all([
      Dvp.find().lean(),
      ProgramDvp.find({ program: program._id }).select("dvp applicable").lean(),
    ]);
    const on = new Set(rows.filter((r) => r.applicable !== false).map((r) => String(r.dvp)));
    const list = catalog
      .map((d) => ({
        code: d.code, component: d.component, evaluationParameter: d.evaluationParameter,
        zone: d.zone, ergonomicsArea: d.ergonomicsArea, applicable: on.has(String(d._id)),
      }))
      .sort((a, b) => a.zone.order - b.zone.order ||
        testNumber(a.code).localeCompare(testNumber(b.code), "en", { numeric: true }) || a.code.localeCompare(b.code));
    res.json({ program: { code: program.code, name: program.name }, dvps: list });
  } catch (err) {
    console.error("GET /admin/programs/:code/catalog failed:", err.message);
    res.status(500).json({ message: "Could not load the DVP catalog." });
  }
});

// PUT /api/admin/programs/:code/applicability  { codes: ["UDVP-101-01", ...] }
// The listed DVPs become this program's full set; all others are switched off.
// Switching off hides a DVP but keeps its status/colour/remarks.
router.put("/programs/:code/applicability", async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const codes = req.body?.codes;
    if (!Array.isArray(codes) || codes.some((c) => typeof c !== "string" || !DVP_CODE.test(c))) {
      return res.status(400).json({ message: "Send the selected DVPs as a list of DVP codes." });
    }
    const wanted = [...new Set(codes)];
    const dvps = await Dvp.find({ code: { $in: wanted } }).select("code").lean();
    if (dvps.length !== wanted.length) {
      const known = new Set(dvps.map((d) => d.code));
      return res.status(400).json({ message: `Unknown DVP codes: ${wanted.filter((c) => !known.has(c)).join(", ")}` });
    }
    const ids = dvps.map((d) => d._id);
    const by = req.user.name;

    await ProgramDvp.updateMany({ program: program._id, dvp: { $nin: ids } }, { $set: { applicable: false, updatedBy: by } });
    await ProgramDvp.updateMany({ program: program._id, dvp: { $in: ids }, applicable: false }, { $set: { applicable: true, updatedBy: by } });
    const existing = new Set((await ProgramDvp.find({ program: program._id, dvp: { $in: ids } }).select("dvp").lean()).map((r) => String(r.dvp)));
    const toCreate = ids.filter((id) => !existing.has(String(id)))
      .map((id) => ({ program: program._id, dvp: id, applicable: true, updatedBy: by }));
    if (toCreate.length) await ProgramDvp.insertMany(toCreate);

    res.json({ program: program.code, applicable: ids.length });
  } catch (err) {
    console.error("PUT /admin/programs/:code/applicability failed:", err.message);
    res.status(500).json({ message: "Could not save the DVP selection." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Base reference catalog, and adding programs / DVPs
// ─────────────────────────────────────────────────────────────────────────────

const TYPES = ["Usability", "Visibility"];
const VR_VALUES = ["Yes", "No", "Partial"];
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// A few creations an hour is normal; this only stops a runaway script
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.ADMIN_WRITE_LIMIT) || 60, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many changes in a short time. Wait a few minutes and try again." },
});

const DVP_TEXT_RULES = {
  component:           { label: "Component", max: 80, required: true },
  evaluationParameter: { label: "Evaluation", max: 120, required: true },
  fullName:            { label: "Full name", max: 160 },
  ergonomicsArea:      { label: "Ergonomic area", max: 60 },
  cas:                 { label: "CAS", max: 60 },
  requirement:         { label: "Requirement", max: 3000 },
  acceptanceCriteria:  { label: "Acceptance criteria", max: 4000 },
  procedure:           { label: "Procedure", max: 8000 },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES, fields: 40, fieldSize: 64 * 1024, parts: 60 },
});
// Accepts the form as multipart (with images) or plain JSON (no images)
const receiveForm = (req, res, next) => upload.array("images", MAX_IMAGES)(req, res, (err) => {
  if (!err) return next();
  const message =
    err.code === "LIMIT_FILE_SIZE" ? `Each image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` :
    err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `You can add at most ${MAX_IMAGES} images.` :
    "The form could not be read. Check it and try again.";
  res.status(400).json({ message });
});

const imageUrl = (f) => `/dvp-images/${encodeURIComponent(f)}`;
const safeName = (n) => String(n || "file").replace(/[^\w.\- ]/g, "").slice(0, 60) || "file";

// One catalog row as the admin screens show it: the plain catalog code, no program in front of it
function catalogRow(d, programCount) {
  return {
    code: d.code, dvpNumber: d.code,        // dvpNumber lets the shared image viewer label it
    type: d.type, component: d.component, evaluationParameter: d.evaluationParameter, fullName: d.fullName,
    zone: d.zone, ergonomicsArea: d.ergonomicsArea, cas: d.cas,
    requirement: d.requirement, acceptanceCriteria: d.acceptanceCriteria, procedure: d.procedure,
    procedureAvailable: Boolean(d.procedureAvailable), vrCapability: d.vrCapability,
    referenceImages: (d.referenceImages || []).map(imageUrl),
    programCount: programCount || 0,
    createdBy: d.createdBy || "", createdAt: d.createdAt || null,
  };
}

const bySeries = (a, b) => a.zone.order - b.zone.order ||
  testNumber(a.code).localeCompare(testNumber(b.code), "en", { numeric: true }) || a.code.localeCompare(b.code);

// GET /api/admin/dvps - the whole base catalog, independent of any program
router.get("/dvps", async (req, res) => {
  try {
    const [dvps, counts] = await Promise.all([
      Dvp.find().lean(),
      ProgramDvp.aggregate([{ $match: isApplicable }, { $group: { _id: "$dvp", n: { $sum: 1 } } }]),
    ]);
    const used = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ dvps: dvps.map((d) => catalogRow(d, used.get(String(d._id)))).sort(bySeries) });
  } catch (err) {
    console.error("GET /admin/dvps failed:", err.message);
    res.status(500).json({ message: "Could not load the DVP catalog." });
  }
});

// The zone is stored on every DVP. A zone number that already exists keeps its name,
// so one zone can never end up with two spellings; a new number needs a name.
async function resolveZone(body) {
  const order = Number(body.zoneOrder);
  if (!Number.isInteger(order) || order < 1 || order > 99) return { error: "Choose a zone." };
  const existing = await Dvp.findOne({ "zone.order": order }).select("zone").lean();
  if (existing) return { zone: { order, name: existing.zone.name } };
  const name = cleanText(body.zoneName, { label: "Zone name", max: 40, required: true });
  if (name.error) return { error: name.error };
  if (name.value.length < 2) return { error: "Zone name must be at least 2 characters." };
  const clash = await Dvp.findOne({ "zone.name": new RegExp(`^${name.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).select("zone").lean();
  if (clash) return { error: `A zone called "${clash.zone.name}" already exists as zone ${clash.zone.order}.` };
  return { zone: { order, name: name.value } };
}

// POST /api/admin/dvps - add a DVP to the base catalog (multipart with up to 6 images, or JSON)
router.post("/dvps", writeLimiter, receiveForm, async (req, res) => {
  const written = []; // image files created by this request, removed again if anything fails
  try {
    const body = req.body || {};
    const fail = (message, status = 400) => res.status(status).json({ message });

    // 1. identity
    const type = String(body.type || "");
    if (!TYPES.includes(type)) return fail("Choose a type: Usability or Visibility.");
    const code = String(body.code || "").trim().toUpperCase();
    if (!DVP_CODE.test(code)) return fail("The DVP code must look like UDVP-101-01 (U or V, then a 3-4 digit series, then 2 digits).");
    if (code[0] !== (type === "Usability" ? "U" : "V")) {
      return fail(`${type} DVPs start with ${type === "Usability" ? "UDVP" : "VDVP"}. Change the type or the code.`);
    }
    if (await Dvp.exists({ code })) return fail(`${code} already exists.`, 409);

    // 2. text
    const text = cleanFields(body, DVP_TEXT_RULES);
    if (text.error) return fail(text.error);
    const v = text.values;
    const vrCapability = body.vrCapability === undefined || body.vrCapability === "" ? "No" : String(body.vrCapability);
    if (!VR_VALUES.includes(vrCapability)) return fail("VR capability must be Yes, No or Partial.");

    // 3. zone
    const z = await resolveZone(body);
    if (z.error) return fail(z.error);

    // 4. programs to switch it on for (optional)
    const wanted = [...new Set([].concat(body.programs ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    if (wanted.some((c) => !PROGRAM_CODE.test(c))) return fail("One of the selected programs is not valid.");
    const programs = wanted.length ? await Program.find({ code: { $in: wanted }, active: true }).select("code").lean() : [];
    if (programs.length !== wanted.length) {
      const known = new Set(programs.map((p) => p.code));
      return fail(`Unknown program(s): ${wanted.filter((c) => !known.has(c)).join(", ")}`);
    }

    // 5. images - judged by their bytes, never by file name or reported type
    const files = req.files || [];
    const kinds = [];
    for (const f of files) {
      const kind = sniffImage(f.buffer);
      if (!kind) return fail(`"${safeName(f.originalname)}" is not a PNG, JPEG or WebP image.`);
      kinds.push(kind);
    }

    // Everything checked: now write. The DVP is inserted FIRST and the image files only after it
    // succeeded, so two admins adding the same code at the same moment can't clobber each other's
    // images: only the request that won the insert ever writes files.
    const names = files.map((f, i) => `${code}-${i + 1}.${kinds[i].ext}`);

    let doc;
    try {
      doc = await Dvp.create({
        code, type, zone: z.zone, vrCapability, referenceImages: names, createdBy: req.user.name,
        component: v.component, evaluationParameter: v.evaluationParameter,
        fullName: v.fullName || `${v.component} ${v.evaluationParameter}`,
        ergonomicsArea: v.ergonomicsArea, cas: v.cas,
        requirement: v.requirement, acceptanceCriteria: v.acceptanceCriteria,
        procedure: v.procedure, procedureAvailable: v.procedure.length > 0,
      });
    } catch (err) {
      if (err.code === 11000) return fail(`${code} already exists.`, 409);
      throw err;
    }

    try {
      if (files.length) {
        fs.mkdirSync(UPLOAD_IMAGE_DIR, { recursive: true });
        files.forEach((f, i) => { fs.writeFileSync(path.join(UPLOAD_IMAGE_DIR, names[i]), f.buffer); written.push(names[i]); });
      }
      if (programs.length) {
        await ProgramDvp.insertMany(programs.map((p) => ({ program: p._id, dvp: doc._id, applicable: true, updatedBy: req.user.name })));
      }
    } catch (err) {
      // Could not finish: undo, so a half-created DVP is never left behind
      written.forEach(removeUpload);
      await ProgramDvp.deleteMany({ dvp: doc._id }).catch(() => {});
      await Dvp.deleteOne({ _id: doc._id }).catch(() => {});
      throw err;
    }
    console.log(`DVP added: ${code} by ${req.user.name} (${names.length} image(s), ${programs.length} program(s))`);
    res.status(201).json(catalogRow(doc.toObject(), programs.length));
  } catch (err) {
    console.error("POST /admin/dvps failed:", err.message);
    res.status(500).json({ message: "Could not add the DVP." });
  }
});

function removeUpload(name) { try { fs.unlinkSync(path.join(UPLOAD_IMAGE_DIR, name)); } catch { /* already gone */ } }

// POST /api/admin/programs  { code, name?, description?, copyFrom? }
// A new program starts with no DVPs, or with the same DVPs switched on as `copyFrom`
// (their status, colour and remarks are NOT copied: a new program starts fresh).
router.post("/programs", writeLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    if (!PROGRAM_CODE.test(code)) return res.status(400).json({ message: "The program code must be 2-12 letters or digits, e.g. S302." });
    const text = cleanFields(body, {
      name: { label: "Program name", max: 60 },
      description: { label: "Description", max: 300 },
    });
    if (text.error) return res.status(400).json({ message: text.error });

    let source = null;
    const copyFrom = String(body.copyFrom || "").trim().toUpperCase();
    if (copyFrom) {
      source = await Program.findOne({ code: copyFrom, active: true }).lean();
      if (!source) return res.status(400).json({ message: `Program ${copyFrom} was not found.` });
    }
    if (await Program.exists({ code })) return res.status(409).json({ message: `Program ${code} already exists.` });

    let program;
    try {
      program = await Program.create({ code, name: text.values.name || code, description: text.values.description, createdBy: req.user.name });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ message: `Program ${code} already exists.` });
      throw err;
    }

    let dvpCount = 0;
    if (source) {
      const rows = await ProgramDvp.find({ program: source._id, ...isApplicable }).select("dvp").lean();
      if (rows.length) {
        await ProgramDvp.insertMany(rows.map((r) => ({ program: program._id, dvp: r.dvp, applicable: true, updatedBy: req.user.name })));
      }
      dvpCount = rows.length;
    }
    console.log(`Program added: ${code} by ${req.user.name}${source ? ` (DVPs copied from ${source.code}: ${dvpCount})` : ""}`);
    res.status(201).json({ code: program.code, name: program.name, description: program.description, dvpCount, doneCount: 0 });
  } catch (err) {
    console.error("POST /admin/programs failed:", err.message);
    res.status(500).json({ message: "Could not add the program." });
  }
});

module.exports = router;
