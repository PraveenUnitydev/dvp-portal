const express = require("express");
const Program = require("../models/Program");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");

const router = express.Router();
const PROGRAM_CODE = /^[A-Z0-9]{2,12}$/;
const testNumber = (code) => code.replace(/^[UV]DVP-/, "");

// GET /api/programs - active programs with progress counts
router.get("/", async (req, res) => {
  try {
    const programs = await Program.find({ active: true }).sort({ code: 1 }).lean();
    const withCounts = await Promise.all(programs.map(async (p) => ({
      code: p.code,
      name: p.name,
      description: p.description,
      dvpCount:  await ProgramDvp.countDocuments({ program: p._id }),
      doneCount: await ProgramDvp.countDocuments({ program: p._id, completedStatus: "Done" }),
    })));
    res.json(withCounts);
  } catch (err) {
    console.error("GET /programs failed:", err.message);
    res.status(500).json({ message: "Could not load programs." });
  }
});

// GET /api/programs/:code/dvps - only the DVPs that apply to this program
router.get("/:code/dvps", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!PROGRAM_CODE.test(code)) return res.status(400).json({ message: "Invalid program code." });

  try {
    const program = await Program.findOne({ code, active: true }).lean();
    if (!program) return res.status(404).json({ message: `Program ${code} was not found.` });

    const rows = await ProgramDvp.find({ program: program._id }).lean();
    const dvps = await Dvp.find({ _id: { $in: rows.map(r => r.dvp) } }).lean();
    const byId = new Map(dvps.map(d => [String(d._id), d]));

    const list = rows
      .map((r) => {
        const d = byId.get(String(r.dvp));
        if (!d) return null;
        return {
          dvpNumber: `${program.code}-${d.code}`,
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
          procedureAvailable: d.procedureAvailable,
          vrCapability: d.vrCapability,
          referenceImages: (d.referenceImages || []).map((f) => `/dvp-images/${encodeURIComponent(f)}`),
          responsibility: r.responsibility,
          completedStatus: r.completedStatus,
          result: r.result,
          reason: r.reason,
          remarks: r.remarks,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        a.zone.order - b.zone.order ||
        // Order by the test number (102-03), not the full code - otherwise every
        // UDVP sorts before every VDVP and visibility tests fall out of sequence
        testNumber(a.code).localeCompare(testNumber(b.code), "en", { numeric: true }) ||
        a.code.localeCompare(b.code));

    res.json({ program: { code: program.code, name: program.name, description: program.description }, dvps: list });
  } catch (err) {
    console.error(`GET /programs/${code}/dvps failed:`, err.message);
    res.status(500).json({ message: "Could not load DVPs for this program." });
  }
});

module.exports = router;
