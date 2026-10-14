// Report figures. The summing is plain functions (tested with mock data in tests/report.test.js); the
// database reads are kept small and separate.
const ProgramDvp = require("../models/ProgramDvp");
const LopEntry = require("../models/LopEntry");

const COLORS = ["Red", "Blue", "Green"];
// Rows created before `applicable` existed count as switched on
const isApplicable = { applicable: { $ne: false } };

/** Colour counts and LOP total for a list of DVP rows ({ color, lopCount }). A DVP without a colour is "open". */
function countsOf(rows) {
  const c = { dvps: 0, red: 0, blue: 0, green: 0, open: 0, assessed: 0, lop: 0 };
  for (const r of rows || []) {
    c.dvps++;
    if (r.color === "Red") c.red++;
    else if (r.color === "Blue") c.blue++;
    else if (r.color === "Green") c.green++;
    else c.open++;
    c.lop += Number(r.lopCount) || 0;
  }
  c.assessed = c.dvps - c.open;
  return c;
}

/** The same counts per zone, in zone order: [{ name, order, ...counts }]. */
function zonesOf(rows) {
  const byZone = new Map();
  for (const r of rows || []) {
    const name = r.zone?.name || "Other";
    if (!byZone.has(name)) byZone.set(name, { name, order: r.zone?.order ?? 999, rows: [] });
    byZone.get(name).rows.push(r);
  }
  return [...byZone.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((z) => ({ name: z.name, order: z.order, ...countsOf(z.rows) }));
}

/** Add up programs: { programs, ...counts }. */
function totalsOf(programs) {
  const t = { programs: 0, dvps: 0, red: 0, blue: 0, green: 0, open: 0, assessed: 0, lop: 0 };
  for (const p of programs || []) {
    t.programs++;
    for (const k of ["dvps", "red", "blue", "green", "open", "assessed", "lop"]) t[k] += p.counts?.[k] || 0;
  }
  return t;
}

/** For the program lists: how many DVPs are assessed (have a colour) and how many LOP concerns were raised. */
async function programCounts(programId) {
  const rows = await ProgramDvp.find({ program: programId, ...isApplicable }).select("dvp color").lean();
  const lopCount = rows.length
    ? await LopEntry.countDocuments({ program: programId, dvp: { $in: rows.map((r) => r.dvp) } })
    : 0;
  return { assessedCount: rows.filter((r) => COLORS.includes(r.color)).length, lopCount };
}

module.exports = { countsOf, zonesOf, totalsOf, programCounts, isApplicable, COLORS };
