/**
 * Report API test with mock data - no MongoDB needed.
 *   npm run test:report
 *
 * The real routes (reports, programs, lop) run in a real Express server, with the database models replaced by small
 * in-memory stand-ins filled from the real 135-DVP catalog (seed/dvp-catalog.json). Checks the figures of the three
 * report scopes and the program lists, and writes the reports to tests/out/ (used by the frontend's deck test).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };

const { Dvp, admin, red171, same, dvpByCode } = require("./mockDb");

const app = express();
app.use(express.json());
app.use("/api/programs", require("../routes/programs"));
app.use("/api/admin", require("../routes/admin"));
app.use("/api", require("../routes/lop"));
app.use("/api/reports", require("../routes/reports"));
const token = jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  // Plain node:http with no keep-alive: nothing is left open when the test ends. (fetch keeps pooled sockets open,
  // and exiting while Windows is still closing them crashes Node with "UV_HANDLE_CLOSING ... src\\win\\async.c".)
  const get = (p, auth = true) => new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, agent: false,
      headers: { Connection: "close", ...(auth ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => { let body = null; try { body = JSON.parse(data); } catch { /* not JSON */ } resolve({ status: res.statusCode, body }); });
    });
    req.on("error", reject);
  });
  try {
    const { countsOf, zonesOf, totalsOf } = require("../utils/reportData");
    const c = countsOf([{ color: "Red", lopCount: 2 }, { color: "Blue" }, { color: null, lopCount: 1 }, {}]);
    check("countsOf: colours, open, assessed, LOP", c.dvps === 4 && c.red === 1 && c.blue === 1 && c.green === 0 && c.open === 2 && c.assessed === 2 && c.lop === 3, JSON.stringify(c));
    const z = zonesOf([{ color: "Red", zone: { name: "B", order: 2 } }, { color: "Green", zone: { name: "A", order: 1 } }, { zone: { name: "B", order: 2 } }]);
    check("zonesOf: zone order, counts per zone", z.length === 2 && z[0].name === "A" && z[1].dvps === 2 && z[1].red === 1 && z[1].open === 1);
    check("totalsOf", totalsOf([{ counts: { dvps: 3, red: 1, lop: 2 } }, { counts: { dvps: 2, red: 1, lop: 0 } }]).red === 2);

    check("reports need sign-in", (await get("/api/reports/overall", false)).status === 401);

    const all = await get("/api/reports/overall");
    const n171 = Dvp.rows.length;
    const u = all.body.programs.find((p) => p.code === "U171"), s = all.body.programs.find((p) => p.code === "S302");
    check("overall: active programs only", all.status === 200 && all.body.programs.length === 2 && !all.body.programs.some((p) => p.code === "X100"));
    check("overall: U171 counts", u.counts.dvps === n171 && u.counts.red === Math.ceil(n171 / 4) && u.counts.open === n171 - u.counts.red - u.counts.blue - u.counts.green && u.counts.lop === 4, JSON.stringify(u.counts));
    check("overall: LOP DVPs with history, newest first", u.lopDvps.length === 2 && u.lopDvps.some((d) => d.lopCount === 3 && d.lop[0].seq === 3 && d.lop[0].images[0] === "/api/lop-images/bbbbbbbbbbbbbbbbbbbbbbbb-1.png"));
    check("overall: switched-off DVP and its LOP not counted", s.counts.dvps === 9 && s.counts.lop === 1 && s.counts.red === 3, JSON.stringify(s.counts));
    check("overall: totals", all.body.totals.programs === 2 && all.body.totals.dvps === n171 + 9 && all.body.totals.lop === 5);
    check("overall: who and when", all.body.generatedBy === "Portal Admin" && !Number.isNaN(Date.parse(all.body.generatedAt)));

    const pr = await get("/api/reports/programs/u171");
    check("program: every DVP, sorted by zone", pr.status === 200 && pr.body.dvps.length === n171 && pr.body.dvps.every((d, i, a) => i === 0 || a[i - 1].zone.order <= d.zone.order));
    check("program: zones add up", pr.body.zones.reduce((n, z) => n + z.dvps, 0) === n171 && pr.body.zones.reduce((n, z) => n + z.red, 0) === pr.body.counts.red);
    check("program: unknown program 404", (await get("/api/reports/programs/ZZ99")).status === 404);
    check("program: archived program 404", (await get("/api/reports/programs/X100")).status === 404);

    const code = dvpByCode(Dvp.rows.find((d) => same(d._id, red171[0])).code).code;
    const one = await get(`/api/reports/programs/U171/dvps/${code}`);
    check("dvp: details + full LOP history", one.status === 200 && one.body.dvp.dvpNumber === `U171-${code}` && one.body.dvp.lop.length === 3 && one.body.dvp.color === "Red");
    check("dvp: bad code 400, not in program 404", (await get("/api/reports/programs/U171/dvps/xx")).status === 400 && (await get(`/api/reports/programs/S302/dvps/${Dvp.rows[20].code}`)).status === 404);

    const rows = (await get("/api/programs/U171/dvps")).body.dvps;
    const want = Object.fromEntries(["Yes", "Partial", "No"].map((v) => [v, Dvp.rows.filter((d) => (d.vrCapability || "No") === v).length]));
    check("DVP list: VR capable from the catalog (Yes / Partial / No)", ["Yes", "Partial", "No"].every((v) => rows.filter((d) => d.vrCapability === v).length === want[v]) && want.Yes > 0 && want.Partial > 0, JSON.stringify(want));

    const list = await get("/api/programs");
    const lu = list.body.find((p) => p.code === "U171");
    check("program list: assessed and LOP counts (no 'done')", lu.assessedCount === n171 - u.counts.open && lu.lopCount === 4 && !("doneCount" in lu), JSON.stringify(lu));
    const alist = await get("/api/admin/programs");
    check("admin program list: same counts", alist.body.find((p) => p.code === "S302").lopCount === 1);

    const out = path.join(__dirname, "out");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "report-overall.json"), JSON.stringify(all.body, null, 1));
    fs.writeFileSync(path.join(out, "report-program.json"), JSON.stringify(pr.body, null, 1));
    fs.writeFileSync(path.join(out, "report-dvp.json"), JSON.stringify(one.body, null, 1));
  } catch (e) {
    fail++; console.log("FAIL exception", e);
  } finally {
    console.log(`\nPassed ${pass} | Failed ${fail}`);
    // Let Node finish closing the server and its sockets by itself instead of process.exit() (see `get` above)
    process.exitCode = fail ? 1 : 0;
    server.closeAllConnections?.();
    server.close();
  }
})();
