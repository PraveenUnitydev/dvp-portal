const express = require("express");
const Program = require("../models/Program");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");
const LopEntry = require("../models/LopEntry");
const { requireAuth } = require("../middleware/auth");
const { countsOf, zonesOf, totalsOf } = require("../utils/reportData");
const { findProgram, toRow, isApplicable, DVP_CODE, testNumber } = require("./programs").helpers;
const { entryJson } = require("./lop").helpers;

// Reports: the data behind "View summary" and the PowerPoint reports. Three scopes - one DVP, one program, and all
// programs. Read-only, for anyone signed in (the same people who can see the DVPs).
const router = express.Router();

const byNumber = (a, b) => a.zone.order - b.zone.order ||
  testNumber(a.code).localeCompare(testNumber(b.code), "en", { numeric: true }) || a.code.localeCompare(b.code);

/** One program: every DVP switched on (with its LOP history when it has one), colour counts, per-zone counts. */
async function programReport(program) {
  const rows = await ProgramDvp.find({ program: program._id, ...isApplicable }).lean();
  const dvps = await Dvp.find({ _id: { $in: rows.map((r) => r.dvp) } }).lean();
  const byId = new Map(dvps.map((d) => [String(d._id), d]));
  const entries = await LopEntry.find({ program: program._id, dvp: { $in: dvps.map((d) => d._id) } }).sort({ seq: -1 }).lean();
  const lopByDvp = new Map();
  for (const e of entries) {
    const k = String(e.dvp);
    if (!lopByDvp.has(k)) lopByDvp.set(k, []);
    lopByDvp.get(k).push(entryJson(e));
  }
  const list = rows
    .map((r) => {
      const d = byId.get(String(r.dvp));
      if (!d) return null;
      const lop = lopByDvp.get(String(d._id)) || [];
      return { ...toRow(program, d, r, lop.length), lop };
    })
    .filter(Boolean)
    .sort(byNumber);
  return {
    program: { code: program.code, name: program.name || program.code, description: program.description || "" },
    counts: countsOf(list),
    zones: zonesOf(list),
    dvps: list,
  };
}

const stamp = (req) => ({ generatedAt: new Date().toISOString(), generatedBy: req.user.name });

// GET /api/reports/overall - every active program: counts, and its DVPs with LOP concerns (with their history)
router.get("/overall", requireAuth(), async (req, res) => {
  try {
    const programs = await Program.find({ active: true }).sort({ code: 1 }).lean();
    const list = [];
    for (const p of programs) {
      const r = await programReport(p);
      list.push({ ...r.program, counts: r.counts, lopDvps: r.dvps.filter((d) => d.lopCount > 0) });
    }
    res.json({ scope: "overall", ...stamp(req), totals: totalsOf(list), programs: list });
  } catch (err) {
    console.error("GET /reports/overall failed:", err.message);
    res.status(500).json({ message: "Could not build the report." });
  }
});

// GET /api/reports/programs/:code - one program
router.get("/programs/:code", requireAuth(), async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    res.json({ scope: "program", ...stamp(req), ...(await programReport(program)) });
  } catch (err) {
    console.error("GET /reports/programs/:code failed:", err.message);
    res.status(500).json({ message: "Could not build the report." });
  }
});

// GET /api/reports/programs/:code/dvps/:dvpCode - one DVP in one program, with its whole LOP history
router.get("/programs/:code/dvps/:dvpCode", requireAuth(), async (req, res) => {
  try {
    const program = await findProgram(req, res);
    if (!program) return;
    const code = String(req.params.dvpCode || "").toUpperCase();
    if (!DVP_CODE.test(code)) return res.status(400).json({ message: "Invalid DVP number." });
    const d = await Dvp.findOne({ code }).lean();
    const row = d && await ProgramDvp.findOne({ program: program._id, dvp: d._id, ...isApplicable }).lean();
    if (!row) return res.status(404).json({ message: `${program.code}-${code} is not part of program ${program.code}.` });
    const lop = (await LopEntry.find({ program: program._id, dvp: d._id }).sort({ seq: -1 }).lean()).map(entryJson);
    res.json({
      scope: "dvp", ...stamp(req),
      program: { code: program.code, name: program.name || program.code, description: program.description || "" },
      dvp: { ...toRow(program, d, row, lop.length), lop },
    });
  } catch (err) {
    console.error("GET /reports/programs/:code/dvps/:dvpCode failed:", err.message);
    res.status(500).json({ message: "Could not build the report." });
  }
});

module.exports = router;
