const express = require("express");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");
const { requireAuth } = require("../middleware/auth");
const { findProgram, testNumber, DVP_CODE } = require("./programs").helpers;

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

module.exports = router;
