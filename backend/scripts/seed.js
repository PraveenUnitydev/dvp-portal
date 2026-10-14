/**
 * Load backend/seed/dvp-catalog.json into MongoDB.
 *   npm run seed
 *
 * Safe to re-run at any time:
 * - Catalog DVP definitions (criteria, procedure, images...) are refreshed from the sheet,
 *   EXCEPT DVPs an admin has edited in the portal: those are left exactly as the admin saved them.
 * - Program assignments are only CREATED from the sheet. Existing rows are never
 *   touched, so status, colour, remarks and admin on/off choices made in the
 *   portal are preserved.
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const Program = require("../models/Program");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dvpPortal";
// Programs to create even with no DVPs yet; admins assign their DVPs in the portal
const SAMPLE_PROGRAMS = ["U171", "S302", "D101"];
const RESULT_TO_COLOR = { Green: "Green", Red: "Red" };

(async () => {
  const data = require(path.join(__dirname, "..", "seed", "dvp-catalog.json"));
  await mongoose.connect(MONGO_URI);
  console.log(`Seeding from ${data.source}`);

  const idByCode = {};
  const edited = new Set((await Dvp.find({ editedAt: { $ne: null } }).select("code").lean()).map((d) => d.code));
  for (const d of data.catalog) {
    if (edited.has(d.code)) {
      idByCode[d.code] = (await Dvp.findOne({ code: d.code }).select("_id").lean())._id;
      continue;
    }
    const doc = await Dvp.findOneAndUpdate({ code: d.code }, d, { upsert: true, new: true, runValidators: true });
    idByCode[d.code] = doc._id;
  }
  console.log(`Catalog: ${data.catalog.length} DVPs` + (edited.size ? ` (${edited.size} edited in the portal were left as they are)` : ""));

  const programIds = {};
  for (const code of [...new Set([...data.programs, ...SAMPLE_PROGRAMS])]) {
    const p = await Program.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code } }, { upsert: true, new: true });
    programIds[code] = p._id;
  }

  // One-time migration for databases seeded before admin selection existed
  await ProgramDvp.collection.updateMany({ applicable: { $exists: false } }, { $set: { applicable: true } });
  for (const [result, color] of Object.entries(RESULT_TO_COLOR)) {
    await ProgramDvp.collection.updateMany({ result, color: { $exists: false } }, { $set: { color } });
  }
  await ProgramDvp.collection.updateMany({ result: { $exists: true } }, { $unset: { result: "" } });

  let created = 0;
  for (const a of data.assignments) {
    const { program, code, result, ...status } = a;
    const r = await ProgramDvp.updateOne(
      { program: programIds[program], dvp: idByCode[code] },
      { $setOnInsert: { applicable: true, ...status, color: RESULT_TO_COLOR[result] || null, updatedBy: "Master sheet import" } },
      { upsert: true });
    created += r.upsertedCount;
  }
  console.log(`New program assignments created: ${created} (existing ones left unchanged)`);

  for (const [code, id] of Object.entries(programIds)) {
    console.log(`Program ${code}: ${await ProgramDvp.countDocuments({ program: id, applicable: { $ne: false } })} DVPs switched on`);
  }
  await mongoose.disconnect();
})().catch(async (err) => { console.error("Seed failed:", err.message); await mongoose.disconnect(); process.exit(1); });
