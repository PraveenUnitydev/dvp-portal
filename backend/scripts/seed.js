/**
 * Load backend/seed/dvp-catalog.json into MongoDB.
 *   npm run seed
 * Safe to re-run: catalog DVPs are upserted by code and program
 * assignments by (program, DVP), so nothing is duplicated.
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const Program = require("../models/Program");
const Dvp = require("../models/Dvp");
const ProgramDvp = require("../models/ProgramDvp");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dvpPortal";

(async () => {
  const data = require(path.join(__dirname, "..", "seed", "dvp-catalog.json"));
  await mongoose.connect(MONGO_URI);
  console.log(`Seeding from ${data.source}`);

  const idByCode = {};
  for (const d of data.catalog) {
    const doc = await Dvp.findOneAndUpdate({ code: d.code }, d, { upsert: true, new: true, runValidators: true });
    idByCode[d.code] = doc._id;
  }
  console.log(`Catalog: ${data.catalog.length} DVPs`);

  const programIds = {};
  for (const code of data.programs) {
    const p = await Program.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code } }, { upsert: true, new: true });
    programIds[code] = p._id;
  }

  for (const a of data.assignments) {
    const { program, code, ...status } = a;
    await ProgramDvp.findOneAndUpdate(
      { program: programIds[program], dvp: idByCode[code] },
      { program: programIds[program], dvp: idByCode[code], ...status },
      { upsert: true, new: true, runValidators: true });
  }
  for (const code of data.programs) {
    console.log(`Program ${code}: ${await ProgramDvp.countDocuments({ program: programIds[code] })} DVPs assigned`);
  }
  await mongoose.disconnect();
})().catch(async (err) => { console.error("Seed failed:", err.message); await mongoose.disconnect(); process.exit(1); });
