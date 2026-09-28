const express = require("express");
const Program = require("../models/Program");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const PROGRAM_CODE = /^[A-Z0-9]{2,12}$/;
const DVP_CODE = /^[UV]DVP-\d{3,4}-\d{2}$/;
const STATUSES = ["Done", "Not done"];
const COLORS = ["Red", "Blue", "Green"];
const MAX_REMARKS = 2000;

const testNumber = (code) => code.replace(/^[UV]DVP-/, "");
// Number shown to users: VRC-<program>-<catalog code>, e.g. VRC-S302-UDVP-101-01
const dvpNumber = (programCode, dvpCode) => `VRC-${programCode}-${dvpCode}`;
// Rows created before `applicable` existed count as switched on
const isApplicable = { applicable: { $ne: false } };

async function findProgram(req, res) {
  const code = String(req.params.code || "").toUpperCase();
  if (!PROGRAM_CODE.test(code)) { res.status(400).json({ message: "Invalid program code." }); return null; }
  const program = await Program.findOne({ code, active: true }).lean();
  if (!program) { res.status(404).json({ message: `Program ${code} was not found.` }); return null; }
  return program;
}

function toRow(program, d, r) {
  return {
    dvpNumber: dvpNumber(program.code, d.code),
    code: d.code,
    type: d.type,
    component: d.component,
    evaluationParameter: d.evaluationParameter,
    fullName: d.fullName,
    zone: d.zone,
    ergonomicsArea: d.ergonomicsArea,
    cas: d.cas,
    requirement: d.requirement,
    acceptanceCriteria: d.acceptanceCriteria,
    procedure: d.procedure,
    referenceImages: (d.referenceImages || []).map((f) => `/dvp-images/${encodeURIComponent(f)}`),
    completedStatus: r.completedStatus,
    color: r.color || null,
    remarks: r.remarks || "",
    responsibility: r.responsibility || "",
    updatedBy: r.updatedBy || "",
    updatedAt: r.updatedAt || null,
  };
}

// GET /api/programs - active programs with progress counts
router.get("/", requireAuth(), async (req, res) => {
  try {
    const programs = await Program.find({ active: true }).sort({ code: 1 }).lean();
    res.json(await Promise.all(programs.map(async (p) => ({
      code: p.code,
      name: p.name,
      dvpCount:  await ProgramDvp.countDocuments({ program: p._id, ...isApplicable }),
      doneCount: await ProgramDvp.countDocuments({ program: p._id, ...isApplicable, completedStatus: "Done" }),
    }))));
  } catch (err) {
    console.error("GET /programs failed:", err.message);
    res.status(500).json({ message: "Could not load programs." });
  }
});

// GET /api/programs/:code/dvps - only the DVPs switched on for this program
router.get("/:code/dvps", requireAuth(), async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const rows = await ProgramDvp.find({ program: program._id, ...isApplicable }).lean();
    const dvps = await Dvp.find({ _id: { $in: rows.map((r) => r.dvp) } }).lean();
    const byId = new Map(dvps.map((d) => [String(d._id), d]));
    const list = rows
      .map((r) => { const d = byId.get(String(r.dvp)); return d ? toRow(program, d, r) : null; })
      .filter(Boolean)
      .sort((a, b) => a.zone.order - b.zone.order ||
        testNumber(a.code).localeCompare(testNumber(b.code), "en", { numeric: true }) ||
        a.code.localeCompare(b.code));
    res.json({ program: { code: program.code, name: program.name }, dvps: list });
  } catch (err) {
    console.error("GET /programs/:code/dvps failed:", err.message);
    res.status(500).json({ message: "Could not load DVPs for this program." });
  }
});

// PATCH /api/programs/:code/dvps/:dvpCode - update this program's status,
// colour and remarks for one DVP. Only affects the selected program.
router.patch("/:code/dvps/:dvpCode", requireAuth(["ADMIN", "USER"]), async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const dvpCode = String(req.params.dvpCode || "").toUpperCase();
    if (!DVP_CODE.test(dvpCode)) return res.status(400).json({ message: "Invalid DVP number." });

    const body = req.body || {};
    const update = {};
    if ("completedStatus" in body) {
      if (!STATUSES.includes(body.completedStatus)) return res.status(400).json({ message: "Status must be Done or Not done." });
      update.completedStatus = body.completedStatus;
    }
    if ("color" in body) {
      if (body.color !== null && !COLORS.includes(body.color)) return res.status(400).json({ message: "Colour must be Red, Blue or Green." });
      update.color = body.color;
    }
    if ("remarks" in body) {
      const remarks = String(body.remarks ?? "").trim();
      if (remarks.length > MAX_REMARKS) return res.status(400).json({ message: `Remarks can be at most ${MAX_REMARKS} characters.` });
      // Same rule as VRSP: this text may be exported to a spreadsheet later,
      // where a leading =, +, - or @ is interpreted as a formula
      if (/^[=+\-@＝＋－＠]/.test(remarks)) {
        return res.status(400).json({ message: "Remarks can't start with =, +, - or @ (spreadsheets treat these as formulas)." });
      }
      update.remarks = remarks;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "Nothing to update." });

    const dvp = await Dvp.findOne({ code: dvpCode }).lean();
    if (!dvp) return res.status(404).json({ message: `DVP ${dvpCode} was not found.` });

    update.updatedBy = req.user.name;
    const row = await ProgramDvp.findOneAndUpdate(
      { program: program._id, dvp: dvp._id, ...isApplicable },
      { $set: update },
      { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ message: `${dvpNumber(program.code, dvpCode)} is not part of program ${program.code}.` });

    res.json(toRow(program, dvp, row));
  } catch (err) {
    console.error("PATCH /programs/:code/dvps/:dvpCode failed:", err.message);
    res.status(500).json({ message: "Could not save changes." });
  }
});

module.exports = router;
module.exports.helpers = { findProgram, dvpNumber, testNumber, isApplicable, PROGRAM_CODE, DVP_CODE };
