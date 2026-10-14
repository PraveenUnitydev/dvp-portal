/**
 * Admin settings and the VR capability change, with mock data - no MongoDB needed.
 *   npm run test:settings
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "dvp-set-"));
process.env.UPLOAD_DIR = UPLOADS;
delete process.env.OBSERVATION_MAX_IMAGES; delete process.env.VR_REPORT_MAX_MB;
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const express = require("express");
const jwt = require("jsonwebtoken");
const { admin, maya, Dvp, ProgramDvp, Setting, U171, same } = require("./mockDb");
const settings = require("../utils/settings");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };

const app = express();
app.use(express.json());
app.use("/api/programs", require("../routes/programs"));
app.use("/api/admin", require("../routes/admin"));
app.use("/api", require("../routes/lop"));
app.use("/api", require("../routes/observations"));
app.use("/api", require("../routes/vrReports"));
app.use("/api", require("../routes/settings"));
const tokenOf = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_SECRET);
const ADMIN = tokenOf(admin), MAYA = tokenOf(maya);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
const BIGPNG = Buffer.concat([PNG, Buffer.alloc(1.5 * 1024 * 1024)]);
const BIGPDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1.5 * 1024 * 1024, 65)]);

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const call = (method, p, { token, json, files, fields = {}, field = "images" } = {}) => new Promise((resolve, reject) => {
    let body = null;
    const headers = { Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (json !== undefined) { body = Buffer.from(JSON.stringify(json)); Object.assign(headers, { "Content-Type": "application/json", "Content-Length": body.length }); }
    if (files) {
      const b = `----t${crypto.randomBytes(8).toString("hex")}`, parts = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      for (const [buf, name] of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from("\r\n"));
      parts.push(Buffer.from(`--${b}--\r\n`));
      body = Buffer.concat(parts);
      Object.assign(headers, { "Content-Type": `multipart/form-data; boundary=${b}`, "Content-Length": body.length });
    }
    const req = http.request({ host: "127.0.0.1", port, path: p, method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const raw = Buffer.concat(chunks); let j = null; try { j = JSON.parse(raw.toString("utf8")); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve({ status: 0, reset: true }) : reject(e)));
    req.end(body || undefined);
  });
  const put = (values, token = ADMIN) => call("PUT", "/api/admin/settings", { token, json: { values } });

  // DVPs to work on in U171: one Red (for LOP), one Blue
  const rowOf = (color) => ProgramDvp.rows.find((r) => same(r.program, U171._id) && r.color === color && !(r.observations || []).length);
  const red = Dvp.rows.find((d) => same(d._id, rowOf("Red").dvp)).code, blue = Dvp.rows.find((d) => same(d._id, rowOf("Blue").dvp)).code;
  const dvpUrl = (c) => `/api/programs/U171/dvps/${c}`;

  try {
    // ── reading and saving ─────────────────────────────────────────────
    const g = await call("GET", "/api/settings", { token: MAYA });
    check("read: any signed-in user gets values and descriptions", g.status === 200 && g.body.values.usersCanEditDvps === true && g.body.values.observationMaxPerDvp === 12 && g.body.settings.every((x) => x.label && x.group && "default" in x));
    check("read: needs sign-in", (await call("GET", "/api/settings")).status === 401);
    check("save: plain user 403, no sign-in 401", (await put({ lopMaxImages: 2 }, MAYA)).status === 403 && (await call("PUT", "/api/admin/settings", { json: { values: { lopMaxImages: 2 } } })).status === 401);
    const bad = [
      ["unknown setting", { nope: 1 }], ["number too big", { lopMaxImages: 11 }], ["not a whole number", { lopMaxMb: 2.5 }],
      ["text for a number", { vrReportMaxMb: "lots" }], ["text for on/off", { usersCanEditDvps: "no" }], ["nothing", {}],
      ["one bad among good ones (nothing saved)", { lopMaxImages: 2, observationMaxMb: 0 }],
    ];
    for (const [name, v] of bad) { const r = await put(v); check(`save refused: ${name} (400)`, r.status === 400 && r.body.message, `${r.status} ${JSON.stringify(r.body)}`); }
    check("refused saves changed nothing", (await call("GET", "/api/settings", { token: ADMIN })).body.values.lopMaxImages === 4);
    const s1 = await put({ usersCanEditDvps: false, lopMaxImages: "2" });
    check("save: values applied (numbers sent as text accepted), who saved recorded", s1.status === 200 && s1.body.values.usersCanEditDvps === false && s1.body.values.lopMaxImages === 2 && s1.body.updatedBy === "Portal Admin");

    // ── who can do what ────────────────────────────────────────────────
    check("users can't change DVPs when turned off (403)", (await call("PATCH", dvpUrl(blue), { token: MAYA, json: { remarks: "x" } })).status === 403);
    check("admins still can", (await call("PATCH", dvpUrl(blue), { token: ADMIN, json: { remarks: "Checked" } })).status === 200);
    await put({ usersCanEditDvps: true });
    check("turned back on: users can again (no restart)", (await call("PATCH", dvpUrl(blue), { token: MAYA, json: { remarks: "Checked again" } })).status === 200);

    const lop = (token, files = []) => call("POST", `${dvpUrl(red)}/lop`, { token, files, fields: { details: "Gap too small", modelDetails: "CAS v2" } });
    await put({ usersCanRaiseLop: false });
    check("LOP: users can't raise when turned off (403)", (await lop(MAYA)).status === 403);
    check("LOP: admins still can", (await lop(ADMIN)).status === 201);
    await put({ usersCanRaiseLop: true });
    check("LOP: more pictures than the setting (2) refused", (await lop(MAYA, [[PNG, "a.png"], [PNG, "b.png"], [PNG, "c.png"]])).body?.message.includes("at most 2"));
    check("LOP: within the setting accepted", (await lop(MAYA, [[PNG, "a.png"], [PNG, "b.png"]])).status === 201);
    await put({ lopMaxImages: 0 });
    check("LOP: 0 pictures allowed -> clear message", (await lop(MAYA, [[PNG, "a.png"]])).body?.message.includes("can't be added"));
    await put({ lopMaxImages: 10, lopMaxMb: 1 });
    check("LOP: picture over the size setting refused", (await lop(MAYA, [[BIGPNG, "big.png"]])).body?.message.includes("over 1 MB"));
    const ten = await lop(MAYA, Array.from({ length: 10 }, (_, i) => [PNG, `p${i}.png`]));
    check("LOP: 10 pictures when allowed; picture 10 is served", ten.status === 201 && ten.body.images.length === 10 && (await call("GET", ten.body.images[9], { token: MAYA })).status === 200);

    const obs = (token, n, buf = PNG) => call("POST", `${dvpUrl(blue)}/observations`, { token, files: Array.from({ length: n }, (_, i) => [buf, `o${i}.png`]) });
    await put({ observationMaxPerDvp: 2 });
    check("observations: over the per-DVP setting (2) refused", (await obs(MAYA, 3)).status === 409);
    const o2 = await obs(MAYA, 2);
    check("observations: within it accepted", o2.status === 201 && o2.body.observationImages.length === 2);
    await put({ observationMaxPerDvp: 12, observationMaxMb: 1 });
    check("observations: over the size setting refused", (await obs(MAYA, 1, BIGPNG)).body?.message.includes("over 1 MB"));
    await put({ usersCanAddObservations: false });
    check("observations: users can't add when turned off; admins can", (await obs(MAYA, 1)).status === 403 && (await obs(ADMIN, 1)).status === 201);
    await put({ usersCanRemoveOwnObservations: false });
    const own = o2.body.observationImages[0].file;
    check("observations: users can't remove their own when turned off", (await call("DELETE", `${dvpUrl(blue)}/observations/${own}`, { token: MAYA })).status === 403);
    await put({ usersCanRemoveOwnObservations: true });
    check("observations: turned back on: they can", (await call("DELETE", `${dvpUrl(blue)}/observations/${own}`, { token: MAYA })).status === 200);

    await put({ vrReportMaxMb: 1 });
    const vr = await call("POST", "/api/programs/U171/vr-reports", { token: ADMIN, files: [[BIGPDF, "big.pdf"]], field: "file" });
    const leftovers = ["vr-reports", "vr-reports/.incoming"].flatMap((d) => (fs.existsSync(path.join(UPLOADS, d)) ? fs.readdirSync(path.join(UPLOADS, d)).filter((n) => n !== ".incoming") : []));
    check("VR report: over the size setting refused (413), nothing left on disk", vr.status === 413 && vr.body.message.includes("1 MB") && leftovers.length === 0, `${vr.status} ${leftovers}`);

    // ── storage ────────────────────────────────────────────────────────
    const back = await put({ usersCanEditDvps: true, usersCanRaiseLop: true, usersCanAddObservations: true, lopMaxImages: 4, lopMaxMb: 3, observationMaxMb: 5, vrReportMaxMb: 200 });
    check("only values that differ from the default are stored", back.status === 200 && Object.keys(Setting.rows[0].values).length === 0, JSON.stringify(Setting.rows[0].values));
    Setting.rows[0].values = { lopMaxImages: 99, observationMaxMb: 7 }; settings.resetCache();
    const v2 = (await call("GET", "/api/settings", { token: MAYA })).body.values;
    check("a stored value that is out of range is ignored (default used); valid ones kept", v2.lopMaxImages === 4 && v2.observationMaxMb === 7);

    // ── VR capability (admin quick change) ────────────────────────────
    const vrUrl = (c) => `/api/admin/dvps/${c}/vr-capability`;
    const target = Dvp.rows.find((d) => d.vrCapability === "No");
    check("VR capability: plain user 403", (await call("PUT", vrUrl(target.code), { token: MAYA, json: { vrCapability: "Yes" } })).status === 403);
    check("VR capability: bad value 400, unknown DVP 404, bad code 400",
      (await call("PUT", vrUrl(target.code), { token: ADMIN, json: { vrCapability: "Maybe" } })).status === 400 &&
      (await call("PUT", vrUrl("UDVP-999-99"), { token: ADMIN, json: { vrCapability: "Yes" } })).status === 404 &&
      (await call("PUT", vrUrl("xx"), { token: ADMIN, json: { vrCapability: "Yes" } })).status === 400);
    const ch = await call("PUT", vrUrl(target.code), { token: ADMIN, json: { vrCapability: "Partial" } });
    check("VR capability: admin sets Partial; marked as edited so a re-import keeps it", ch.status === 200 && ch.body.vrCapability === "Partial" && target.vrCapability === "Partial" && target.editedBy === "Portal Admin" && target.editedAt instanceof Date);
    const inList = (await call("GET", "/api/programs/U171/dvps", { token: MAYA })).body.dvps.find((d) => d.code === target.code);
    check("VR capability: every program's DVP list shows the change", inList.vrCapability === "Partial");
  } catch (e) {
    fail++; console.log("FAIL exception", e);
  } finally {
    console.log(`\nPassed ${pass} | Failed ${fail}`);
    process.exitCode = fail ? 1 : 0;
    fs.rmSync(UPLOADS, { recursive: true, force: true });
    server.closeAllConnections?.();
    server.close();
  }
})();
