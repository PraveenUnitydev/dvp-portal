// In-memory stand-ins for the database models, filled from the real 135-DVP catalog, for tests without MongoDB.
// Requiring this file makes require("../models/X") return the stand-in.
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── in-memory models ────────────────────────────────────────────────────
let nextId = 1;
const oid = () => ({ _bsontype: "ObjectId", id: String(nextId++).padStart(24, "0"), toString() { return this.id; }, equals(o) { return String(o) === this.id; } });
const same = (a, b) => String(a) === String(b);
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === "object" && !cond._bsontype && !Array.isArray(cond)) {
      if ("$ne" in cond) return v !== cond.$ne;
      if ("$in" in cond) return cond.$in.some((x) => same(x, v));
    }
    return same(v, cond);
  });
}
function query(rows, single) {
  let out = rows;
  const q = {
    sort(spec) { const [[k, dir]] = Object.entries(spec); out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); return q; },
    select() { return q; },
    lean() { return Promise.resolve(single ? out[0] || null : out); },
    then(res, rej) { return q.lean().then(res, rej); },
  };
  return q;
}
function model(rows) {
  return {
    rows,
    find: (f) => query(rows.filter((r) => matches(r, f))),
    findOne: (f) => query(rows.filter((r) => matches(r, f)), true),
    findById: (id) => query(rows.filter((r) => same(r._id, id)), true),
    countDocuments: async (f) => rows.filter((r) => matches(r, f)).length,
    create: async (doc) => { const row = { _id: oid(), createdAt: new Date(Date.now() + rows.length), ...doc }; rows.push(row); return row; },
    deleteOne: async (f) => { const i = rows.findIndex((r) => matches(r, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    aggregate: async ([{ $match }]) => {
      const counts = new Map();
      rows.filter((r) => matches(r, $match)).forEach((r) => counts.set(String(r.dvp), { _id: r.dvp, n: (counts.get(String(r.dvp))?.n || 0) + 1 }));
      return [...counts.values()];
    },
  };
}

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "dvp-catalog.json"), "utf8"));
const Dvp = model(seed.catalog.map((d) => ({ _id: oid(), ...d })));
const prog = (code, name, description, active = true) => ({ _id: oid(), code, name, description, active });
const U171 = prog("U171", "U171", "Assessed base program"), S302 = prog("S302", "S302 SUV", ""), OLD = prog("X100", "Old", "", false);
const Program = model([U171, S302, OLD]);
const dvpByCode = (c) => Dvp.rows.find((d) => d.code === c);

// U171: every DVP; colours spread over them. S302: 10 DVPs, one switched off.
const COL = ["Red", "Blue", "Green", null];
const ProgramDvp = model([
  ...Dvp.rows.map((d, i) => ({ _id: oid(), program: U171._id, dvp: d._id, applicable: true, color: COL[i % 4], completedStatus: "Not done", remarks: i % 5 === 0 ? `Remark for ${d.code}` : "", updatedBy: "Naveen S", updatedAt: new Date() })),
  ...Dvp.rows.slice(0, 10).map((d, i) => ({ _id: oid(), program: S302._id, dvp: d._id, applicable: i !== 9, color: i < 3 ? "Red" : i < 5 ? "Green" : null, completedStatus: "Not done", remarks: "" })),
]);
const red171 = ProgramDvp.rows.filter((r) => same(r.program, U171._id) && r.color === "Red").map((r) => r.dvp);
const lop = (program, dvp, seq, details, images = []) => ({ _id: oid(), program, dvp, seq, details, modelDetails: `CAS v${seq}.0 / CAD rev ${seq}`, images, raisedBy: { name: "Naveen S", role: "USER" }, createdAt: new Date(Date.UTC(2026, 9, seq, 10, 30)) });
const LopEntry = model([
  lop(U171._id, red171[0], 1, "Pedal spacing below target: 42 mm measured between brake and accelerator, target 50 mm.", ["aaaaaaaaaaaaaaaaaaaaaaaa-1.png"]),
  lop(U171._id, red171[0], 2, "Re-checked on the new CAS: spacing now 47 mm, still short of target.", []),
  lop(U171._id, red171[0], 3, "Third check after the pedal box change. ".repeat(30), ["bbbbbbbbbbbbbbbbbbbbbbbb-1.png", "bbbbbbbbbbbbbbbbbbbbbbbb-2.png"]),
  lop(U171._id, red171[1], 1, "Mirror blind zone larger than allowed.", []),
  lop(S302._id, Dvp.rows[0]._id, 1, "Same pedal issue on S302.", []),
  lop(S302._id, Dvp.rows[9]._id, 1, "On a DVP that is switched off: must not be counted.", []),
]);
const admin = { _id: oid(), username: "admin", name: "Portal Admin", role: "ADMIN", active: true };
const maya = { _id: oid(), username: "maya", name: "Maya User", role: "USER", active: true };
const User = model([admin, maya]);

const VrReport = model([]);

const stub = { Dvp, Program, ProgramDvp, LopEntry, User, VrReport };
module.exports = { ...stub, U171, S302, OLD, admin, maya, red171, same, dvpByCode };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const m = /models\/(\w+)$/.exec(request);
  if (m && stub[m[1]]) return stub[m[1]];
  return origLoad.apply(this, arguments);
};

